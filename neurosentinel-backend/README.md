---
title: NeuroSentinel Backend
emoji: 🧠
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
app_port: 7860
---

# NeuroSentinel AI — FastAPI Backend

FastAPI inference server for NeuroSentinel AI — production EEG seizure detection.

**Live Space:** [huggingface.co/spaces/Manikondaadwith/neurosentinel-backend](https://huggingface.co/spaces/Manikondaadwith/neurosentinel-backend)

---

## Model

**MultiRepEEGModel V4**
- Architecture: CNN + Transformer (raw EEG branch) + Spectrogram CNN + Band Power MLP
- Parameters: 409,154
- Window-level Macro F1: **0.979** | ROC-AUC: **0.980**
- Event Sensitivity (CHB-MIT): **73.3%** | FP/hour: **0.98**
- Zero-shot Siena Sensitivity: **80.0%**

Model weights are stored in Supabase Storage (`ml-models` bucket) and downloaded at startup — **not committed to git**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI |
| Language | Python 3.11 |
| ML | PyTorch (CPU) |
| EEG | MNE-Python |
| DSP | SciPy, NumPy |
| PDF | ReportLab |
| AI (SCOUT) | Google Gemini |
| Storage | Supabase |
| Container | Docker (HF Spaces) |

---

## Getting Started

```bash
# Create virtual environment
python -m venv .venv && source .venv/bin/activate

# Install (with dev extras)
pip install -r requirements.txt
# or: pip install -e ".[dev]"

# Run server
uvicorn app.main:app --reload --port 7860
```

### Docker

```bash
docker build -t neurosentinel-backend .
docker run -p 7860:7860 --env-file .env neurosentinel-backend
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/analyze` | Submit EDF file for analysis |
| `GET` | `/api/v1/job/{job_id}` | Poll job status / retrieve results |
| `POST` | `/api/v1/job/cancel` | Cancel a running job |
| `POST` | `/api/v1/scout/chat` | SCOUT AI streaming chat |
| `GET` | `/health` | Health check |

---

## Project Structure

```
neurosentinel-backend/
├── app/
│   ├── pipeline/
│   │   ├── preprocessing.py   # EDF → 22ch bipolar, bandpass, windowing
│   │   ├── model.py           # MultiRepEEGModel V4 definition
│   │   ├── inference.py       # Chunked inference + domain-adaptive PP
│   │   ├── reporting.py       # Diagnostic state machine (DETECTED/SUSPICIOUS/CLEAR)
│   │   └── explainability.py  # GradCAM + attention maps
│   ├── services/
│   │   ├── analysis_service.py # Job orchestration
│   │   ├── pdf.py              # PDF report generation
│   │   ├── email.py            # Email delivery
│   │   └── scout/              # SCOUT AI (Gemini-powered)
│   ├── api/schemas.py          # Pydantic request/response models
│   ├── config.py               # Settings (pydantic-settings)
│   └── main.py                 # FastAPI app, routes, startup
├── tests/                      # Pytest test suite
├── requirements.txt            # pip-installable deps
├── Dockerfile                  # HF Spaces container
└── pyproject.toml              # Dependencies
```

---

## Testing

```bash
pytest tests/ -v
```

---

## For More Details

See the full technical documentation: **[docs/technical_guide.md](../docs/technical_guide.md)**
