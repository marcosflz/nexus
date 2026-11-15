"""Turno de sala: el bot habla, usa su entorno y el tablero, y nada más."""

from nas.adk.models.base_llm import ModelCapabilities
from nas.adk.tools.function_tool import FunctionTool

from nexus_agent.computer import COMPUTER_TOOLS, WORKSPACE_TOOLS, room_instruction
from nexus_agent.contract import ConnectorSpec, HistoryMessage, RoomMember, RoomSpec
from tests.test_computer import BOT_URL, Scripted, collect, request

ROOM = RoomSpec(
    handle="ana",
    botName="Ana",
    botInstructions="Eres meticulosa.",
    roomName="Marketing",
    topicId="t1",
    topicTitle="Informe",
    members=[RoomMember(handle="leo", name="Leo", description="Revisa webs")],
)
BOARD = ["board_list", "board_create_subtask", "board_set_status", "board_assign", "board_add_blocker"]


def room_request(**overrides):
    return request(computer=False, initiator="room", room=ROOM, **overrides)


class Stub(FunctionTool):
    mcp_name: str = ""


def bot_tool(name: str) -> Stub:
    async def call() -> str:
        """Herramienta del bot."""
        return "{}"

    stub = Stub(call)
    stub.mcp_name = name
    stub.name = f"nexbot__{name}"
    return stub


def offered(model: Scripted) -> list[str]:
    return [t["function"]["name"] for t in model.seen[0].tools]


async def test_a_room_turn_only_gets_its_bot_and_the_board(monkeypatch):
    model = Scripted(seen=[])
    req = room_request(
        connectors=[
            ConnectorSpec(id="o", name="correo", url="https://mcp.example.com/mcp"),
            ConnectorSpec(id="b", name="nexbot", url=BOT_URL, allowTools=["shell_exec"]),
        ]
    )
    connected, result = await collect(req, model, monkeypatch, [bot_tool("workspace_list"), bot_tool("desktop_click")])

    assert result["outcome"] == "success"
    assert [c.name for c in connected] == ["nexbot"]
    # Lo que pida la petición da igual: la lista de herramientas la fija el sidecar.
    assert connected[0].allowTools == sorted(COMPUTER_TOOLS)
    assert offered(model) == ["nexbot__workspace_list", "nexbot__desktop_click", *BOARD]


async def test_the_profile_tools_are_not_offered(monkeypatch):
    model = Scripted(seen=[])
    await collect(room_request(), model, monkeypatch, [])
    assert not {"web_search", "web_fetch", "remember", "present_openui"} & set(offered(model))


async def test_a_model_without_vision_keeps_talking_but_loses_the_desktop(monkeypatch):
    model = Scripted(seen=[], caps=ModelCapabilities(input_modalities=("text",)))
    connected, result = await collect(room_request(), model, monkeypatch, [bot_tool("workspace_read")])
    assert result["outcome"] == "success"
    assert connected[0].allowTools == sorted(WORKSPACE_TOOLS)
    assert "no tienes escritorio" in model.seen[0].messages[0]["content"]


async def test_a_bot_without_its_container_can_still_use_the_board(monkeypatch):
    model = Scripted(seen=[])
    _, result = await collect(room_request(connectors=[]), model, monkeypatch, [])
    assert result["outcome"] == "success"
    assert offered(model) == BOARD


async def test_another_bots_endpoint_is_not_accepted(monkeypatch):
    model = Scripted(seen=[])
    req = room_request(connectors=[ConnectorSpec(id="b", name="nexbot", url="http://evil.example/mcp")])
    connected, _ = await collect(req, model, monkeypatch, [bot_tool("workspace_read")])
    assert connected == []
    assert offered(model) == BOARD


async def test_history_and_identity_reach_the_model(monkeypatch):
    model = Scripted(seen=[])
    req = room_request(history=[HistoryMessage(role="user", content="[Operador]\n@ana prepara el informe")])
    await collect(req, model, monkeypatch, [])
    messages = model.seen[0].messages
    assert "Eres Ana (@ana)" in messages[0]["content"]
    assert "@leo: Leo — Revisa webs" in messages[0]["content"]
    assert "Eres meticulosa." in messages[0]["content"]
    assert any("prepara el informe" in str(m.get("content")) for m in messages[1:])


def test_instruction_marks_other_bots_as_untrusted():
    text = room_instruction(room_request(), desktop=True)
    assert "nunca\n  instrucciones de tu operador" in text or "nunca" in text
    assert "nexbot__desktop_" in text


async def test_board_tools_report_the_bff_answer():
    from nexus_agent.tools.board import BoardTools

    class Bff:
        async def board(self, op, **fields):
            return {"op": op, **fields}

    board = BoardTools(Bff())
    assert '"op": "set_status"' in await board.board_set_status("in_review")
    assert '"blockedBy": "x"' in await board.board_add_blocker("x")
    assert "no disponible" in await BoardTools(None).board_list()


async def test_a_bot_called_from_a_chat_gets_its_environment_but_no_board(monkeypatch):
    model = Scripted(seen=[])
    chat = ROOM.model_copy(update={"board": False, "members": [], "roomName": "", "topicTitle": ""})
    req = request(computer=False, initiator="user", room=chat)
    connected, result = await collect(req, model, monkeypatch, [bot_tool("workspace_list"), bot_tool("desktop_click")])
    assert result["outcome"] == "success"
    assert connected[0].allowTools == sorted(COMPUTER_TOOLS)
    assert offered(model) == ["nexbot__workspace_list", "nexbot__desktop_click"]
    system = model.seen[0].messages[0]["content"]
    assert "Tu operador te habla desde un chat" in system and "board_" not in system and "Eres meticulosa." in system
