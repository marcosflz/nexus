from nas.adk.core.events.event import Event

from nexus_agent.agui import AgUiMapper
from nexus_agent.sources import SourceRegistry


def stream(text):
    return Event(type="stream", role="assistant", content=text)


def assistant(text="", calls=()):
    return Event(role="assistant", content=text, tool_calls=list(calls))


def call(call_id, name, args="{}"):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}


def types(events):
    return [e["type"] for e in events]


def test_streamed_text_is_not_repeated_by_the_consolidated_message():
    mapper = AgUiMapper("m")
    out = mapper.feed(stream("Hola ")) + mapper.feed(stream("mundo"))
    out += mapper.feed(assistant("Hola mundo"))

    assert types(out) == [
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
    ]
    assert "".join(e.get("delta", "") for e in out) == "Hola mundo"


def test_non_streamed_text_is_emitted_once_from_the_consolidated_message():
    out = AgUiMapper("m").feed(assistant("Respuesta completa"))

    assert types(out) == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
    assert out[1]["delta"] == "Respuesta completa"


def test_tool_calls_open_after_closing_text_and_next_text_gets_a_new_id():
    mapper = AgUiMapper("m")
    out = mapper.feed(stream("Busco. "))
    out += mapper.feed(assistant("Busco. ", [call("c1", "web_search", '{"query":"x"}')]))
    out += mapper.feed(stream("Listo"))
    out += mapper.feed(assistant("Listo"))

    assert types(out) == [
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
    ]
    ids = [e["messageId"] for e in out if e["type"] == "TEXT_MESSAGE_START"]
    assert ids == ["m-0", "m-1"]
    assert out[3]["toolCallName"] == "web_search"
    assert out[4]["delta"] == '{"query":"x"}'


def test_tool_results_carry_duration_and_error_flag():
    mapper = AgUiMapper("m")
    ok = mapper.feed(
        Event(role="tool", tool_call_id="c1", content="fine", metrics={"tool_seconds": 0.25})
    )[0]
    bad = mapper.feed(Event(role="tool", tool_call_id="c2", content='{"error":"boom"}'))[0]
    data = mapper.feed(Event(role="tool", tool_call_id="c3", content='{"error":"x","other":1}'))[0]

    assert ok["metadata"] == {"isError": False, "durationMs": 250}
    assert bad["metadata"]["isError"] is True
    assert data["metadata"]["isError"] is False  # un JSON con más campos no es un error


def test_long_tool_results_are_truncated_and_status_events_ignored():
    mapper = AgUiMapper("m")
    out = mapper.feed(Event(role="tool", tool_call_id="c1", content="x" * 5000))
    assert len(out[0]["content"]) == 2000
    assert mapper.feed(Event(type="status", status="completed", final=True)) == []
    assert mapper.feed(Event(role="user", content="hola")) == []


def test_finish_closes_a_dangling_text_message():
    mapper = AgUiMapper("m")
    mapper.feed(stream("corta"))
    assert types(mapper.finish()) == ["TEXT_MESSAGE_END"]
    assert mapper.finish() == []


def test_source_registry_numbers_urls_stably():
    registry = SourceRegistry()
    a = registry.add("https://www.example.com/a", "A")
    b = registry.add("https://other.org/b")
    again = registry.add("https://www.example.com/a", "otro título")

    assert (a.id, b.id, again.id) == (1, 2, 1)
    assert registry.as_dicts()[0] == {
        "id": 1, "url": "https://www.example.com/a", "domain": "example.com", "title": "A",
    }
    assert len(registry) == 2
