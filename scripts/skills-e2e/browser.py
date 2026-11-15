"""Browser smoke checks; run in the Nexbot image on nexus-skills-e2e_default."""
from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1365, "height": 1000})
    response = context.request.post("http://nexus-skills-e2e-app-1:3000/api/auth/login", data={"email": "skills-owner@example.test", "password": "skills-test-password"})
    assert response.ok, response.text()
    page = context.new_page()
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    page.goto("http://nexus-skills-e2e-app-1:3000/skills")
    expect(page.get_by_role("heading", name="Skills", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Crear con ayuda", exact=True)).to_be_visible()
    expect(page.get_by_role("link", name="weekly-report", exact=True)).to_be_visible()
    Path("/artifacts").mkdir(exist_ok=True)
    page.screenshot(path="/artifacts/skills-library.png", full_page=True)
    bots = context.request.get("http://nexus-skills-e2e-app-1:3000/api/bots").json()["bots"]
    bot = next(item for item in bots if item["name"] == "Skills analyst")
    page.goto(f"http://nexus-skills-e2e-app-1:3000/bots/{bot['id']}")
    expect(page.get_by_text("Sin ordenador", exact=True).first).to_be_visible()
    page.get_by_role("tab", name="Ejecución", exact=True).click()
    expect(page.get_by_label("Rol", exact=True)).to_have_value("Analyst")
    expect(page.get_by_label("Modelo", exact=True)).to_be_visible()
    page.get_by_role("tab", name="Skills", exact=True).click()
    expect(page.get_by_text("weekly-report", exact=True)).to_be_visible()
    page.get_by_role("tab", name="Rutinas", exact=True).click()
    expect(page.get_by_text("Programado (cron)", exact=True).first).to_be_visible()
    page.goto("http://nexus-skills-e2e-app-1:3000/skills")
    page.get_by_role("button", name="Crear con ayuda", exact=True).click()
    expect(page.get_by_role("heading", name="Creador de skills", exact=True)).to_be_visible()
    page.get_by_label("Mensaje al creador").fill("Crea una skill de informes semanales con riesgos y acciones")
    page.get_by_role("button", name="Enviar", exact=True).click()
    expect(page.get_by_text("Borrador preparado con referencias.", exact=False).first).to_be_visible(timeout=60000)
    expect(page.get_by_role("button", name="Publicar versión", exact=True)).to_be_enabled(timeout=15000)
    page.get_by_role("button", name="Archivos", exact=True).click()
    expect(page.get_by_label("Contenido del archivo")).to_have_value(re.compile("creator-report"))
    page.screenshot(path="/artifacts/skills-creator.png", full_page=True)
    assert not failures, failures
    browser.close()
    print("PASS: browser navigation, lightweight Nexbot settings, assignments, routines and creator streaming")
