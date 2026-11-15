"""Mensajes comprensibles para los fallos del modelo.

El Runner de nas-adk solo deja ``str(error)`` en el evento final; el tipo de error
se captura con el callback ``on_error`` para poder explicar qué pasó en español.
"""

from __future__ import annotations

from nas.adk.core.callbacks import BaseCallback
from nas.adk.models.errors import (
    LlmAuthError,
    LlmBillingModeError,
    LlmError,
    LlmIsolationError,
    LlmModelError,
    LlmProcessError,
    LlmProtocolError,
    LlmQuotaError,
    LlmRateLimitError,
    LlmRefusalError,
    LlmTimeoutError,
    LlmTruncatedError,
)


class ErrorCapture(BaseCallback):
    """Guarda el último error del modelo para describirlo al terminar el run."""

    def __init__(self) -> None:
        self.error: Exception | None = None

    async def on_error(self, error: Exception) -> None:
        if isinstance(error, LlmError):
            self.error = error


def describe_model_error(error: Exception | None) -> str | None:
    """Mensaje para la persona, o None si el error no es del modelo."""
    if error is None:
        return None
    # El orden importa: las subclases van antes que sus bases.
    if isinstance(error, LlmBillingModeError):
        return (
            "Claude Code está configurado de forma que facturaría por API: quita las variables "
            "ANTHROPIC_* del sidecar."
        )
    if isinstance(error, LlmAuthError):
        return "El proveedor rechazó la credencial: revisa la clave o vuelve a vincular tu cuenta de Anthropic."
    if isinstance(error, LlmQuotaError):
        return "Se agotó la cuota o el límite de uso del proveedor. Prueba más tarde."
    if isinstance(error, LlmRateLimitError):
        return "El proveedor está limitando las peticiones. Espera un momento y reinténtalo."
    if isinstance(error, LlmTruncatedError):
        return "La respuesta del modelo se cortó por el límite de tokens."
    if isinstance(error, LlmRefusalError):
        return "El modelo se negó a responder a esta petición."
    if isinstance(error, LlmTimeoutError):
        return "El modelo tardó demasiado en responder."
    if isinstance(error, (LlmProcessError, LlmIsolationError)):
        return f"No se pudo ejecutar Claude Code en el servidor: {error}"
    if isinstance(error, LlmProtocolError):
        return "El modelo devolvió una respuesta con un formato no válido."
    if isinstance(error, LlmModelError):
        return f"El proveedor no acepta este modelo o petición: {error}"
    return None
