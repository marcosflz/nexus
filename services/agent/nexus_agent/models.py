"""Traduce el proveedor elegido en Nexus a un ``ModelRouter`` de nas-adk."""

from __future__ import annotations

from nas.adk.models import ModelRouter

from .contract import ModelSpec

# Endpoints OpenAI-compatibles de los proveedores que nas-adk no trae de serie.
_OPENAI_COMPATIBLE_BASES = {
    "openai-api": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "deepseek": "https://api.deepseek.com/v1",
}


class UnsupportedProvider(ValueError):
    pass


def build_model(spec: ModelSpec, *, session_id: str | None = None) -> ModelRouter:
    api_key = spec.apiKey.get_secret_value() if spec.apiKey else ""

    if spec.provider == "openrouter":
        return ModelRouter(provider="openrouter", model=spec.model, api_key=api_key)

    if spec.provider == "opencode-go":
        # nas-adk usa su URL por defecto; el campo «URL base» de Ajustes la sustituye si hace falta.
        extra = {"base_url": spec.baseUrl} if spec.baseUrl else {}
        return ModelRouter(
            provider="opencode", model=spec.model, api_key=api_key, session_id=session_id, **extra
        )

    if spec.provider in _OPENAI_COMPATIBLE_BASES:
        return ModelRouter(
            provider="openai-compatible",
            model=spec.model,
            api_key=api_key,
            base_url=spec.baseUrl or _OPENAI_COMPATIBLE_BASES[spec.provider],
        )

    if spec.provider == "lmstudio":
        if not spec.baseUrl:
            raise UnsupportedProvider("LM Studio / local necesita una URL base")
        return ModelRouter(
            provider="openai-compatible",
            model=spec.model,
            api_key=api_key,
            base_url=spec.baseUrl,
        )

    raise UnsupportedProvider(f"Proveedor no soportado por el sidecar: {spec.provider}")
