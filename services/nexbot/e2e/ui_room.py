"""Comprueba la sala en un navegador de verdad. Imprime un JSON en la última línea."""

import json
import sys

from playwright.sync_api import sync_playwright

app, email, password, room_id, topic_id, card_id = sys.argv[1:7]
TIMEOUT = 90_000
out: dict[str, object] = {}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1600, "height": 1000})
    context.set_default_timeout(TIMEOUT)
    context.request.post(f"{app}/api/auth/login", data={"email": email, "password": password})
    page = context.new_page()

    idle_bot = sys.argv[7]
    page.goto(f"{app}/bots/{idle_bot}", wait_until="domcontentloaded")
    page.get_by_text("El escritorio está vacío", exact=False).wait_for()
    out["idleHint"] = True

    page.goto(f"{app}/bots", wait_until="domcontentloaded")
    page.get_by_role("heading", name="Salas").wait_for()
    out["roomListed"] = page.get_by_role("link", name="Equipo").count() >= 1

    # Las salas están en la barra lateral, junto a los chats, en su propia sección.
    page.goto(f"{app}/", wait_until="domcontentloaded")
    sidebar_room = page.locator('[data-sidebar="sidebar"]').get_by_role("link", name="Equipo")
    sidebar_room.wait_for()
    out["sidebarSection"] = page.locator('[data-sidebar="sidebar"]').get_by_text("Salas", exact=True).count() == 1
    sidebar_room.click()
    page.wait_for_url(f"**/bots/salas/{room_id}")
    out["sidebarOpensRoom"] = True

    page.goto(f"{app}/bots/salas/{room_id}?hilo={topic_id}", wait_until="domcontentloaded")
    page.get_by_text("Aquí están: 42").first.wait_for()
    out["authors"] = page.locator("article").filter(has_text="@ana").count() >= 1 and page.locator("article").filter(has_text="@leo").count() >= 1

    box = page.get_by_role("textbox", name="Mensaje para la sala")
    box.click()
    box.press_sequentially("hola @l")
    options = page.get_by_role("listbox", name="Bots de la sala")
    options.wait_for()
    out["mentionOptions"] = options.get_by_role("option").count()
    box.press("Enter")
    out["mentionInserted"] = box.input_value()
    out["hint"] = page.get_by_text("Sin @mención", exact=False).first.inner_text()

    page.get_by_role("button", name="Abrir el panel de Ana").first.click()
    panel = page.get_by_role("complementary", name="Panel de Ana")
    panel.wait_for()
    viewer = panel.locator('img[alt="Escritorio del bot en directo"]')
    viewer.wait_for()
    page.wait_for_function(
        "() => document.querySelector('aside img[alt=\"Escritorio del bot en directo\"]')?.naturalWidth > 0", timeout=TIMEOUT
    )
    out["panelDesktop"] = viewer.evaluate("img => img.naturalWidth")
    panel.get_by_role("tab", name="Actividad").click()
    panel.get_by_text("con su razonamiento cuando el modelo lo publica", exact=False).wait_for()
    out["reasoningShown"] = panel.get_by_text("pienso en el hilo", exact=False).count() >= 1
    out["panelActivity"] = panel.locator("article").count()
    # En una pantalla de portátil el panel acoplado no debe aplastar la conversación ni cortarse.
    page.set_viewport_size({"width": 1366, "height": 800})
    page.wait_for_timeout(600)
    out["narrow"] = page.evaluate(
        """() => {
          const aside = document.querySelector('aside[aria-label^="Panel de"]');
          const box = document.querySelector('textarea[aria-label="Mensaje para la sala"]').getBoundingClientRect();
          return {
            composer: Math.round(box.width),
            panelOverflow: aside.scrollWidth - aside.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            wide: [...aside.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > aside.getBoundingClientRect().right + 1 && !el.closest('[role="tablist"]')).slice(0, 3).map((el) => el.tagName + '.' + String(el.className).slice(0, 60)),
            listHidden: document.querySelector('nav[aria-label="Hilos"]').getBoundingClientRect().width === 0,
          };
        }"""
    )
    separator = page.get_by_role("separator", name="Ancho del panel")
    before = int(separator.get_attribute("aria-valuenow"))
    separator.focus()
    separator.press("ArrowLeft")
    out["resized"] = int(separator.get_attribute("aria-valuenow")) > before
    separator.press("ArrowRight")
    page.set_viewport_size({"width": 1600, "height": 1000})
    page.wait_for_timeout(400)
    panel.get_by_role("tab", name="Configuración").click()
    out["panelConfig"] = panel.locator("#config-name").input_value()
    page.screenshot(path="/out/sala.png")

    page.get_by_role("tab", name="Tablero").click()
    board = page.get_by_label("Tablero de la sala")
    board.wait_for()
    out["columns"] = board.locator("section").count()
    card = board.locator("li", has=page.get_by_label("Mover «Arrastrable» a"))
    card.wait_for()
    target = board.locator('section[data-status="in_review"]')
    # Con el panel abierto el tablero se desplaza en horizontal: la columna de destino se trae
    # a la vista antes de pulsar, como haría una persona (no se desplaza con el botón pulsado).
    target.scroll_into_view_if_needed()
    card.drag_to(target)
    board.locator('section[data-status="in_review"] li', has_text="Arrastrable").wait_for()
    out["dragged"] = True
    page.get_by_label("Mover «Arrastrable» a").select_option("blocked")
    board.locator('section[data-status="blocked"] li', has_text="Arrastrable").wait_for()
    out["movedWithSelect"] = True
    page.screenshot(path="/out/tablero.png")
    browser.close()

print(json.dumps(out))
