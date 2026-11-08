from nas.adk.models.errors import (
    LlmAuthError,
    LlmBillingModeError,
    LlmQuotaError,
    LlmRefusalError,
    LlmTruncatedError,
)

from nexus_agent.errors import ErrorCapture, describe_model_error


def test_model_errors_get_a_spanish_explanation():
    assert "credencial" in describe_model_error(LlmAuthError("401"))
    assert "ANTHROPIC_" in describe_model_error(LlmBillingModeError("api key presente"))
    assert "cuota" in describe_model_error(LlmQuotaError("limit"))
    assert "cortó" in describe_model_error(LlmTruncatedError("max_tokens"))
    assert "negó" in describe_model_error(LlmRefusalError("refusal"))
    assert describe_model_error(RuntimeError("otra cosa")) is None
    assert describe_model_error(None) is None


async def test_the_capture_keeps_only_model_errors():
    capture = ErrorCapture()
    await capture.on_error(RuntimeError("memoria"))
    assert capture.error is None
    await capture.on_error(LlmQuotaError("limit"))
    assert isinstance(capture.error, LlmQuotaError)
