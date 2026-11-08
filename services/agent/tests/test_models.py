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
        ("anthropic", "https://api.anthropic.com/v1"),
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
