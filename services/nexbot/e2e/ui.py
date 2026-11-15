"""Comprueba la interfaz en un navegador de verdad. Imprime un JSON en la última línea."""

import json
import sys

from playwright.sync_api import sync_playwright

app, email, password, bot_id, user_id = sys.argv[1:6]
TIMEOUT = 90_000
out: dict[str, object] = {}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.set_default_timeout(TIMEOUT)
    context.request.post(f"{app}/api/auth/login", data={"email": email, "password": password})
    page = context.new_page()

    page.goto(f"{app}/bots/{bot_id}", wait_until="domcontentloaded")
    viewer = page.locator('img[alt="Escritorio del bot en directo"]')
    viewer.wait_for()
    page.wait_for_function(
        "() => document.querySelector('img[alt=\"Escritorio del bot en directo\"]')?.naturalWidth > 0",
        timeout=TIMEOUT,
    )
    out["viewerWidth"] = viewer.evaluate("img => img.naturalWidth")
    page.get_by_text("En directo", exact=True).wait_for()
    out["live"] = True
    page.screenshot(path="/out/bot.png")
    page.get_by_role("tab", name="Tareas").click()
    page.get_by_text("Completada").first.wait_for()
    out["tasksVisible"] = True

    page.get_by_role("tab", name="Configuración").click()
    description = page.locator("#config-description")
    description.fill("Descripción editada en la web")
    page.locator("#config-memory").fill("1792")
    # El estado del bot se refresca cada 3 s: lo que se está escribiendo no debe perderse.
    page.wait_for_timeout(4_000)
    out["configKeepsTyping"] = description.input_value() == "Descripción editada en la web"
    page.get_by_role("button", name="Guardar", exact=True).click()
    page.get_by_text("El contenedor sigue con la configuración anterior", exact=False).wait_for()
    out["configPendingNotice"] = page.get_by_role("button", name="Recrear ahora").is_visible()
    page.get_by_text("Descripción editada en la web", exact=True).first.wait_for()
    page.screenshot(path="/out/config.png", full_page=True)

    page.goto(f"{app}/admin/users", wait_until="domcontentloaded")
    page.locator("tbody tr").first.wait_for()
    out["usersRows"] = page.locator("tbody tr").count()
    page.screenshot(path="/out/users.png")

    page.goto(f"{app}/admin/users/{user_id}", wait_until="domcontentloaded")
    page.get_by_role("tab", name="Sesiones").click()
    page.get_by_role("button", name="Cerrar todas").wait_for()
    out["detailSessions"] = True
    page.screenshot(path="/out/user.png")

    page.goto(f"{app}/settings?seccion=search", wait_until="domcontentloaded")
    page.get_by_text("Búsqueda web", exact=False).first.wait_for()
    page.get_by_role("switch", name="Activar LangSearch").wait_for()
    out["searchProviders"] = page.get_by_role("switch", name="Activar ").count()
    page.screenshot(path="/out/search.png")
    browser.close()

print(json.dumps(out))
