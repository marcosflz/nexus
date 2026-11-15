"""Pasos de una tarea determinista. Es un formato cerrado: lo que no esté aquí se rechaza."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Step(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Goto(_Step):
    action: Literal["goto"]
    url: str = Field(max_length=4000)


class Fill(_Step):
    action: Literal["fill"]
    selector: str = Field(max_length=500)
    value: str = Field(max_length=20_000)
    # El valor no se escribe nunca en el journal ni en los logs.
    secret: bool = False


class Click(_Step):
    action: Literal["click"]
    selector: str = Field(max_length=500)


class Press(_Step):
    action: Literal["press"]
    key: str = Field(max_length=40)
    selector: str | None = Field(default=None, max_length=500)


class Scroll(_Step):
    action: Literal["scroll"]
    dy: int = Field(default=600, ge=-20_000, le=20_000)


class WaitFor(_Step):
    action: Literal["wait_for"]
    selector: str = Field(max_length=500)
    timeout_ms: int = Field(default=15_000, ge=100, le=120_000)


class Extract(_Step):
    action: Literal["extract"]
    selector: str = Field(max_length=500)
    save_as: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")
    attribute: str | None = Field(default=None, max_length=80)


class Screenshot(_Step):
    action: Literal["screenshot"]
    path: str = Field(max_length=500)
    full_page: bool = False


class WriteFile(_Step):
    action: Literal["write_file"]
    path: str = Field(max_length=500)
    content: str = Field(max_length=2_000_000)


class Download(_Step):
    action: Literal["download"]
    selector: str = Field(max_length=500)
    path: str = Field(max_length=500)


class Upload(_Step):
    action: Literal["upload"]
    selector: str = Field(max_length=500)
    path: str = Field(max_length=500)


class Shell(_Step):
    action: Literal["shell"]
    command: str = Field(max_length=20_000)
    timeout_s: int = Field(default=120, ge=1, le=3600)
    allow_failure: bool = False


class Approve(_Step):
    """Pausa la tarea hasta que una persona la autorice."""

    action: Literal["approve"]
    message: str = Field(max_length=2000)


class DesktopClick(_Step):
    """Clic en una coordenada de la pantalla, no en un elemento de una página."""

    action: Literal["desktop_click"]
    x: int = Field(ge=0, le=10_000)
    y: int = Field(ge=0, le=10_000)
    button: Literal[1, 2, 3] = 1
    double: bool = False


class DesktopType(_Step):
    action: Literal["desktop_type"]
    text: str = Field(max_length=20_000)
    secret: bool = False


class DesktopKey(_Step):
    action: Literal["desktop_key"]
    key: str = Field(max_length=60)


class DesktopScroll(_Step):
    action: Literal["desktop_scroll"]
    dy: int = Field(default=600, ge=-20_000, le=20_000)


class DesktopScreenshot(_Step):
    action: Literal["desktop_screenshot"]
    path: str = Field(max_length=500)


DESKTOP_STEPS = (DesktopClick, DesktopType, DesktopKey, DesktopScroll, DesktopScreenshot)

Step = Annotated[
    Goto | Fill | Click | Press | Scroll | WaitFor | Extract | Screenshot | WriteFile | Download
    | Upload | Shell | Approve | DesktopClick | DesktopType | DesktopKey | DesktopScroll
    | DesktopScreenshot,
    Field(discriminator="action"),
]
STEPS = TypeAdapter(list[Step])


def public_step(step: BaseModel) -> dict:
    """El paso tal y como se puede guardar: sin el valor de los campos secretos."""
    data = step.model_dump(exclude_defaults=False)
    if isinstance(step, Fill) and step.secret:
        data["value"] = "***"
    if isinstance(step, DesktopType) and step.secret:
        data["text"] = "***"
    return data
