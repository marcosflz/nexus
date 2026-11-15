"""Traduce el proveedor elegido en Nexus a un ``ModelRouter`` de nas-adk."""

from __future__ import annotations

import asyncio
import hashlib

from nas.adk.models import ModelRouter
from nas.adk.models.base_llm import BaseLlm, LlmRequest, LlmResponse
from nas.adk.models.chatgpt import ChatGptPlanLlm
from nas.adk.models.claude_code.llm import ClaudeCodeLlm

from .contract import ModelSpec

# Endpoints OpenAI-compatibles de los proveedores que nas-adk no trae de serie.
_OPENAI_COMPATIBLE_BASES = {
    "openai-api": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "deepseek": "https://api.deepseek.com/v1",
}


class UnsupportedProvider(ValueError):
    pass


def _anthropic_root(url: str) -> str:
    """El SDK de Anthropic añade /v1 por su cuenta; se acepta la URL con o sin él."""
    url = url.rstrip("/")
    return url.removesuffix("/v1")


# Una cola por cuenta de Anthropic (hash del token): cada suscripción tiene sus propios
# límites y los runs de una persona no deben bloquear los de otra.
_claude_code_slots: dict[str, tuple[int, asyncio.Semaphore]] = {}


def _account_slots(token: str, limit: int) -> asyncio.Semaphore:
    key = hashlib.sha256(token.encode()).hexdigest()
    current = _claude_code_slots.get(key)
    if current is None or current[0] != limit:
        current = (limit, asyncio.Semaphore(limit))
        _claude_code_slots[key] = current
    return current[1]


class SharedClaudeCodeLlm(ClaudeCodeLlm):
    """Claude Code con un límite de concurrencia común a todos los runs de la misma cuenta.

    Cada run crea su propio modelo, así que el semáforo interno de ``ClaudeCodeLlm``
    no limitaría nada entre runs.
    """

    async def generate_content_async(self, request: LlmRequest) -> LlmResponse:
        assert self.oauth_token is not None
        async with _account_slots(self.oauth_token.get_secret_value(), self.max_concurrency):
            return await super().generate_content_async(request)


class MissingAccount(UnsupportedProvider):
    pass


def build_model(spec: ModelSpec, *, session_id: str | None = None) -> BaseLlm:
    if spec.provider == "claude-code":
        # Cada persona usa su propia suscripción: el token llega en la petición y solo se
        # pasa al proceso del CLI de este run. Nunca hay un token común ni se lee del entorno.
        if spec.apiKey is None or not spec.apiKey.get_secret_value():
            raise MissingAccount("Vincula tu cuenta de Anthropic en Ajustes para usar Claude Code.")
        options: dict[str, object] = {"oauth_token": spec.apiKey}
        if spec.model != "default":
            options["model"] = spec.model
        if spec.timeoutS is not None:
            options["timeout"] = spec.timeoutS
        if spec.maxConcurrency is not None:
            options["max_concurrency"] = spec.maxConcurrency
        return SharedClaudeCodeLlm(**options)

    if spec.provider == "chatgpt":
        # Plan de ChatGPT del usuario: el BFF manda un token de acceso vigente (lo refresca él).
        if spec.apiKey is None or not spec.apiKey.get_secret_value():
            raise MissingAccount("Vincula tu cuenta de ChatGPT en Ajustes para usar ese modelo.")
        return ChatGptPlanLlm(model=spec.model, access_token=spec.apiKey.get_secret_value(), session_id=session_id)

    api_key = spec.apiKey.get_secret_value() if spec.apiKey else ""

    if spec.provider == "openrouter":
        return ModelRouter(provider="openrouter", model=spec.model, api_key=api_key)

    if spec.provider == "anthropic":
        # API nativa (Messages): herramientas nativas y bloques de razonamiento que se
        # conservan entre turnos. La URL base, si se cambia, es la raíz del SDK (sin /v1).
        extra = {"base_url": _anthropic_root(spec.baseUrl)} if spec.baseUrl else {}
        return ModelRouter(provider="anthropic", model=spec.model, api_key=api_key, **extra)

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
