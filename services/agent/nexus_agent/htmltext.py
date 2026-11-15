"""Extracción de texto legible de HTML con la librería estándar."""

from __future__ import annotations

import re
from html.parser import HTMLParser

_SKIP = {"script", "style", "noscript", "template", "svg", "iframe", "canvas"}
# Bloques que separan párrafos (salto antes y después) …
_BLOCK = {
    "p", "div", "section", "article", "main", "header", "footer", "ul", "ol",
    "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "pre",
}
# … y los que solo cierran una línea (elementos de lista, filas, saltos).
_LINE = {"li", "br", "tr"}


class _Extractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "br":
            self.parts.append("\n")
        elif tag in _BLOCK:
            self.parts.append("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False
        elif tag in _BLOCK:
            self.parts.append("\n\n")
        elif tag in _LINE:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._in_title:
            self.title += data
        else:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    """Devuelve ``(título, texto)`` sin scripts, estilos ni marcado."""
    extractor = _Extractor()
    extractor.feed(html)
    extractor.close()
    text = "".join(extractor.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return re.sub(r"\s+", " ", extractor.title).strip(), text
