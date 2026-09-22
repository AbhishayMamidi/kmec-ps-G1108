from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Protocol

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass
class ProviderResult:
    provider: str
    message: str


class ProviderUnavailableError(RuntimeError):
    pass


class ScoutProvider(Protocol):
    name: str

    async def generate(self, system_prompt: str, user_message: str) -> ProviderResult:
        ...


def _extract_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts).strip()
    return ""


class GeminiScoutProvider:
    name = "gemini"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.api_key = settings.resolved_gemini_api_key
        self.timeout = min(20.0, settings.backend_timeout_seconds)

    async def generate(self, system_prompt: str, user_message: str) -> ProviderResult:
        if not self.api_key:
            raise ProviderUnavailableError("Gemini API key is not configured.")
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_message}]}],
            "generationConfig": {
                "temperature": 0.3,
                "topP": 0.9,
                "maxOutputTokens": 2048,
            },
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.settings.gemini_api_base}/models/{self.settings.gemini_model}:generateContent",
                params={"key": self.api_key},
                json=payload,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ProviderUnavailableError(f"Gemini HTTP {response.status_code}: {response.text[:200]}") from exc
        data = response.json()
        candidates = data.get("candidates") or []
        if not candidates:
            raise ProviderUnavailableError("Gemini returned no candidates.")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
        if not text:
            raise ProviderUnavailableError("Gemini returned an empty response.")
        return ProviderResult(provider=self.name, message=text)


class GroqScoutProvider:
    name = "groq"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.api_key = settings.groq_api_key
        self.timeout = min(20.0, settings.backend_timeout_seconds)

    async def generate(self, system_prompt: str, user_message: str) -> ProviderResult:
        if not self.api_key:
            raise ProviderUnavailableError("Groq API key is not configured.")

        payload = {
            "model": self.settings.groq_model,
            "temperature": 0.3,
            "max_tokens": 2048,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.settings.groq_api_base}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ProviderUnavailableError(f"Groq HTTP {response.status_code}: {response.text[:200]}") from exc

        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise ProviderUnavailableError("Groq returned no choices.")

        text = _extract_text(choices[0].get("message", {}).get("content"))
        if not text:
            raise ProviderUnavailableError("Groq returned an empty response.")

        return ProviderResult(provider=self.name, message=text)


class HuggingFaceScoutProvider:
    name = "huggingface"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.api_key = settings.huggingface_api_key
        self.timeout = min(20.0, settings.backend_timeout_seconds)

    async def generate(self, system_prompt: str, user_message: str) -> ProviderResult:
        if not self.api_key:
            raise ProviderUnavailableError("Hugging Face API key is not configured.")

        prompt = f"{system_prompt}\n\nUser: {user_message}\nAssistant:"
        payload = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": 1536,
                "temperature": 0.3,
                "return_full_text": False,
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.settings.huggingface_api_base}/{self.settings.huggingface_model}",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise ProviderUnavailableError(f"Hugging Face HTTP {response.status_code}: {response.text[:200]}") from exc

        data = response.json()
        if isinstance(data, list) and data:
            generated = data[0].get("generated_text")
            text = generated.replace(prompt, "").strip() if isinstance(generated, str) else _extract_text(generated)
        elif isinstance(data, dict):
            if isinstance(data.get("error"), str):
                raise ProviderUnavailableError(data["error"])
            text = _extract_text(data.get("generated_text") if isinstance(data, dict) else "")
        else:
            text = ""

        if not text:
            raise ProviderUnavailableError("Hugging Face returned an empty response.")

        return ProviderResult(provider=self.name, message=text)
