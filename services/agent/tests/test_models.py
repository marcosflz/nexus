import pytest

from nexus_agent.contract import ModelSpec
from nexus_agent.models import UnsupportedProvider, build_model


def spec(provider, **extra):
    return ModelSpec(provider=provider, model="m", apiKey="sk-x", **extra)


def test_openrouter_and_opencode_use_native_providers():
    assert build_model(spec("openrouter")).provider == "openrouter"
    assert build_model(spec("opencode-go")).provider == "opencode"


def test_opencode_base_url_can_be_overridden_from_settings():
    default = build_model(spec("opencode-go"))._get_backend().base_url
    custom = build_model(spec("opencode-go", baseUrl="https://gw.example.com/go/"))._get_backend().base_url
    assert custom == "https://gw.example.com/go"
    assert default != custom


@pytest.mark.parametrize(
    ("provider", "base"),
    [
        ("openai-api", "https://api.openai.com/v1"),
        ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
        ("deepseek", "https://api.deepseek.com/v1"),
    ],
)
def test_hosted_providers_map_to_their_openai_compatible_endpoint(provider, base):
    backend = build_model(spec(provider))._get_backend()
    assert backend.provider == "openai-compatible" and backend.base_url == base


def test_local_providers_need_a_base_url_and_take_it_from_settings():
    with pytest.raises(UnsupportedProvider):
        build_model(spec("lmstudio"))
    assert build_model(spec("lmstudio", baseUrl="http://host:1234/v1"))._get_backend().base_url == "http://host:1234/v1"


def test_a_custom_base_url_beats_the_default_for_hosted_providers():
    assert build_model(spec("openai-api", baseUrl="https://proxy.example.com/v1"))._get_backend().base_url == "https://proxy.example.com/v1"


def test_unknown_providers_are_rejected_by_name():
    with pytest.raises(UnsupportedProvider, match="inventado"):
        build_model(spec("inventado"))


def test_anthropic_uses_the_native_messages_api():
    backend = build_model(spec("anthropic"))._get_backend()
    assert backend.provider == "anthropic"
    assert backend.model == "m"


def test_anthropic_base_url_is_the_sdk_root_with_or_without_v1():
    for url in ("https://proxy.example.com/v1", "https://proxy.example.com/v1/", "https://proxy.example.com"):
        backend = build_model(spec("anthropic", baseUrl=url))._get_backend()
        assert backend.base_url == "https://proxy.example.com"


def test_claude_code_uses_the_instance_subscription_not_a_user_key():
    model = build_model(ModelSpec(provider="claude-code", model="sonnet"))
    assert model.provider == "claude-code" and model.model == "sonnet"


def test_claude_code_default_lets_the_cli_choose_the_model(monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_MODEL", raising=False)
    assert build_model(ModelSpec(provider="claude-code", model="default")).model == ""


async def test_claude_code_slots_are_shared_between_runs(monkeypatch):
    import asyncio

    from nas.adk.models.base_llm import LlmRequest, LlmResponse
    from nas.adk.models.claude_code.llm import ClaudeCodeLlm

    from nexus_agent import models

    active = peak = 0

    async def fake_generate(self, request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return LlmResponse(content="ok")

    monkeypatch.setattr(ClaudeCodeLlm, "generate_content_async", fake_generate)
    monkeypatch.setattr(models, "_claude_code_slots", None)
    monkeypatch.setenv("CLAUDE_CODE_MAX_CONCURRENCY", "2")

    runs = [build_model(ModelSpec(provider="claude-code", model="default")) for _ in range(5)]
    request = LlmRequest(model="default", messages=[{"role": "user", "content": "hola"}])
    await asyncio.gather(*(run.generate_content_async(request) for run in runs))
    assert peak == 2
