import math
import os

import torch
import torch.nn as nn

BUCKET_NAME = "ml-models"
MODEL_FILENAME = "multirep_best_model_v4.pt"
LOCAL_MODEL_PATH = f"/tmp/{MODEL_FILENAME}"  # IMPORTANT: only safe writable path on Render free tier


def download_model_if_needed() -> str:
    """Download the model weights from Supabase Storage if not already cached locally.

    Uses streaming HTTP download to avoid buffering the entire model file in RAM.
    """
    if os.path.exists(LOCAL_MODEL_PATH):
        print("✅ Model already exists locally")
        return LOCAL_MODEL_PATH

    print("⬇️ Downloading model from Supabase (streaming)...")

    import requests

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to download the model.")

    # Build the direct storage URL and stream download chunk-by-chunk
    download_url = f"{supabase_url}/storage/v1/object/{BUCKET_NAME}/{MODEL_FILENAME}"
    headers = {
        "Authorization": f"Bearer {supabase_key}",
        "apikey": supabase_key,
    }

    response = requests.get(download_url, headers=headers, stream=True, timeout=300)
    response.raise_for_status()

    with open(LOCAL_MODEL_PATH, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    print("✅ Model downloaded successfully (streamed to disk)")

    return LOCAL_MODEL_PATH


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, dropout: float = 0.1, max_len: int = 300) -> None:
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.pe[:, : x.size(1)]
        return self.dropout(x)


class EEGNetCNN(nn.Module):
    def __init__(self, n_channels: int = 22, f1: int = 64, depth_multiplier: int = 4, dropout: float = 0.4, embed_dim: int = 64) -> None:
        super().__init__()
        f2 = f1 * depth_multiplier
        self.conv_temporal = nn.Conv2d(1, f1, (1, 64), padding="same", bias=False)
        self.bn1 = nn.BatchNorm2d(f1)
        self.conv_spatial = nn.Conv2d(f1, f2, (n_channels, 1), groups=f1, bias=False)
        self.bn2 = nn.BatchNorm2d(f2)
        self.elu1 = nn.ELU()
        self.pool1 = nn.AvgPool2d((1, 4))
        self.drop1 = nn.Dropout(dropout)
        self.conv_sep_dw = nn.Conv2d(f2, f2, (1, 16), padding="same", groups=f2, bias=False)
        self.conv_sep_pw = nn.Conv2d(f2, f2, (1, 1), bias=False)
        self.bn3 = nn.BatchNorm2d(f2)
        self.elu2 = nn.ELU()
        self.pool2 = nn.AvgPool2d((1, 4))
        self.drop2 = nn.Dropout(dropout)
        self.proj = nn.Linear(f2, embed_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.unsqueeze(1)
        x = self.bn1(self.conv_temporal(x))
        x = self.conv_spatial(x)
        x = self.drop1(self.pool1(self.elu1(self.bn2(x))))
        x = self.conv_sep_pw(self.conv_sep_dw(x))
        x = self.drop2(self.pool2(self.elu2(self.bn3(x))))
        x = x.squeeze(2).permute(0, 2, 1)
        return self.proj(x)


class SpectrogramBranch(nn.Module):
    def __init__(self, n_channels: int = 22, n_fft: int = 128, hop_length: int = 32, out_features: int = 128, dropout: float = 0.3) -> None:
        super().__init__()
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.register_buffer("window", torch.hann_window(n_fft))
        self.cnn = nn.Sequential(
            nn.Conv2d(n_channels, 32, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 4 * 4, out_features),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch, channels, samples = x.shape
        x_flat = x.reshape(batch * channels, samples).float()
        spec = torch.stft(
            x_flat,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.n_fft,
            window=self.window,
            center=False,
            return_complex=True,
        )
        spec_power = torch.log1p(spec.abs().pow(2))
        freq_bins, time_bins = spec_power.shape[1], spec_power.shape[2]
        spec_power = spec_power.reshape(batch, channels, freq_bins, time_bins).to(x.dtype)
        return self.head(self.cnn(spec_power))


class BandPowerBranch(nn.Module):
    BANDS = [(0.5, 4.0), (4.0, 8.0), (8.0, 13.0), (13.0, 30.0), (30.0, 40.0)]

    def __init__(self, n_channels: int = 22, fs: int = 256, n_samples: int = 1024, out_features: int = 64, dropout: float = 0.3) -> None:
        super().__init__()
        self.n_bands = len(self.BANDS)
        freqs = torch.fft.rfftfreq(n_samples, d=1.0 / fs)
        masks = [((freqs >= low) & (freqs < high)) for low, high in self.BANDS]
        self.register_buffer("band_masks", torch.stack(masks))
        self.mlp = nn.Sequential(
            nn.Linear(n_channels * self.n_bands, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(128, out_features),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        spectrum = torch.fft.rfft(x.float(), dim=-1)
        power = spectrum.abs().pow(2)
        band_powers = [power[:, :, mask].mean(dim=-1) for mask in self.band_masks]
        band_powers = torch.log1p(torch.stack(band_powers, dim=-1))
        band_powers = band_powers.reshape(x.shape[0], -1).to(x.dtype)
        return self.mlp(band_powers)


class MultiRepEEGModel(nn.Module):
    def __init__(
        self,
        n_classes: int = 2,
        n_channels: int = 22,
        fs: int = 256,
        n_samples: int = 1024,
        f1: int = 64,
        depth_multiplier: int = 4,
        cnn_dropout: float = 0.4,
        nhead: int = 4,
        num_layers: int = 2,
        dim_feedforward: int = 256,
        trans_dropout: float = 0.2,
        embed_dim: int = 64,
    ) -> None:
        super().__init__()
        self.raw_cnn = EEGNetCNN(n_channels, f1, depth_multiplier, cnn_dropout, embed_dim=embed_dim)
        self.d_model = embed_dim
        self.cls_token = nn.Parameter(torch.zeros(1, 1, self.d_model))
        nn.init.trunc_normal_(self.cls_token, std=0.02)
        self.pos_encoder = PositionalEncoding(self.d_model, trans_dropout, max_len=300)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=self.d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=trans_dropout,
            activation="gelu",
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.raw_norm = nn.LayerNorm(self.d_model)
        self.raw_drop = nn.Dropout(0.3)
        self.spec_branch = SpectrogramBranch(n_channels=n_channels, n_fft=128, hop_length=32, out_features=128, dropout=0.3)
        self.band_branch = BandPowerBranch(n_channels=n_channels, fs=fs, n_samples=n_samples, out_features=64, dropout=0.3)
        fused_dim = self.d_model + 128 + 64
        self.classifier = nn.Sequential(
            nn.Linear(fused_dim, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.size(0)
        features = self.raw_cnn(x)
        cls = self.cls_token.expand(batch_size, -1, -1)
        features = torch.cat([cls, features], dim=1)
        features = features * math.sqrt(self.d_model)
        features = self.pos_encoder(features)
        encoded = self.transformer(features)
        raw_feat = self.raw_drop(self.raw_norm(encoded[:, 0, :]))
        spec_feat = self.spec_branch(x)
        band_feat = self.band_branch(x)
        fused = torch.cat([raw_feat, spec_feat, band_feat], dim=1)
        return self.classifier(fused)


def build_model() -> MultiRepEEGModel:
    return MultiRepEEGModel(
        n_classes=2,
        n_channels=22,
        fs=256,
        n_samples=1024,
        f1=64,
        depth_multiplier=4,
        cnn_dropout=0.4,
        nhead=4,
        num_layers=2,
        dim_feedforward=256,
        trans_dropout=0.2,
        embed_dim=64,
    )


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())
