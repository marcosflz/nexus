"""El razonamiento del modelo llega a la interfaz como eventos aparte, agrupados."""

from nas.adk.core.events.event import Event
from nas.adk.models.base_llm import LlmRequest, LlmResponse

from nexus_agent import run as run_module
from nexus_agent.agui import MAX_REASONING_CHARS, NEXUS_REASONING, AgUiMapper
from nexus_agent.settings import Settings
from tests.test_computer import Scripted, request


def reasoning(text):
    return Event(author="a", role="assistant", content=text, type="reasoning")


def deltas(events):
    return [e["value"]["delta"] for e in events if e.get("name") == NEXUS_REASONING]


def test_small_fragments_are_grouped_and_flushed_before_what_follows():
    mapper = AgUiMapper("m")
    assert mapper.feed(reasoning("pienso ")) == []
    assert mapper.feed(reasoning("un poco")) == []
    out = mapper.feed(Event(author="a", role="assistant", content="hola", type="stream"))
    assert deltas(out) == ["pienso un poco"]
    assert out[0]["name"] == NEXUS_REASONING and out[-1]["type"] == "TEXT_MESSAGE_CONTENT"


def test_a_long_thought_is_sent_in_chunks_and_capped():
    mapper = AgUiMapper("m")
    sent = "".join(d for _ in range(200) for d in deltas(mapper.feed(reasoning("x" * 300))))
    sent += "".join(deltas(mapper.finish()))
    assert len(sent) == MAX_REASONING_CHARS


def test_reasoning_never_becomes_answer_text():
    mapper = AgUiMapper("m")
    out = mapper.feed(reasoning("secreto")) + mapper.finish()
    assert not [e for e in out if e["type"].startswith("TEXT_MESSAGE")]


class Thinker(Scripted):
    supports_streaming = True

    async def generate_stream_async(self, req: LlmRequest):
        self.seen.append(req)
        yield LlmResponse(reasoning="primero miro la pantalla", type="delta")
        yield LlmResponse(content="hecho", type="delta")
        yield LlmResponse(content="hecho")


async def test_a_run_asks_for_the_summary_and_streams_it():
    model = Thinker(seen=[])
    req = request(computer=False, connectors=[])
    events = [e async for e in run_module.run_stream(req, Settings(), model_factory=lambda *a, **k: model)]
    assert model.seen[0].reasoning_summary is True
    assert deltas(events) == ["primero miro la pantalla"]
    assert events[-1]["value"]["finalText"] == "hecho"
