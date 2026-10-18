# Plexo

> _Nombre provisional._ Buscador con IA open source, autoalojado y *bring your own key*: pregunta, busca en la web y obtén respuestas con citas verificables.

- **Frontend**: Next.js 16 + React 19 + [assistant-ui](https://www.assistant-ui.com/) (primitivas de chat, parts de herramientas y fuentes).
- **Agente**: [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT) embebido por CLI: un perfil aislado por usuario, `web_search`/`web_extract` y un `SOUL.md` con formato de citas estilo Perplexity.
- **Búsqueda**: [SearXNG](https://github.com/searxng/searxng) autoalojado (gratis, privado) + extracción de páginas sin clave (Firecrawl keyless).
- **Datos**: PostgreSQL + Drizzle ORM. Autenticación propia email/contraseña (sesiones con cookie).
- **Claves**: cada usuario trae su API key; se cifra en el servidor con AES-256-GCM.
- **Licencia**: MIT. Sin planes, sin cuotas, sin telemetría.

## Estado

Esqueleto funcional del MVP (octubre 2026):

- [x] Registro/login, sesiones y Ajustes con proveedor + modelo + API key cifrada.
- [x] Hilos persistentes con historial y barra lateral.
- [x] Streaming SSE de respuestas con tarjetas de herramientas (`web_search`, `web_extract`) y chips de fuentes.
- [x] Por usuario: perfil Hermes aislado (sesiones, memoria y configuración propias).
- [x] Focus modes (Web, Académico, Reddit, Finanzas, Noticias) y modo Research (informe multi-búsqueda).
- [x] Subida de archivos (PDF, DOCX, TXT, MD, CSV, JSON): el BFF extrae el texto y se inyecta como contexto; sin dar acceso a ficheros al agente.
- [x] Trazas de herramientas y uso de tokens persistidos por mensaje.
- [ ] Compartir hilos por enlace, cuotas/coste por usuario, cancelación fina, índices de embeddings.

Ver [`docs/decisiones-mvp.md`](docs/decisiones-mvp.md) para las decisiones de arquitectura, [`docs/proximos-pasos.md`](docs/proximos-pasos.md) para el backlog y [`docs/stack-tecnico.md`](docs/stack-tecnico.md) / [`docs/perplexity-funcionalidades.md`](docs/perplexity-funcionalidades.md) para la investigación completa.

## Arquitectura

```
┌────────────── Navegador ──────────────┐
│  Next.js + assistant-ui (Thread,      │
│  tool UIs, fuentes, composer)         │
└──────────────────┬────────────────────┘
                   │ SSE (/api/chat)
┌──────────────────▼────────────────────┐
│  BFF Next.js (route handlers)         │
│  auth · hilos · ajustes · cifrado     │
│  traduce JSONL de Hermes → SSE        │
└───────┬───────────────────────┬───────┘
        │ spawn hermes CLI       │ SQL
┌───────▼───────────────┐  ┌────▼────────┐
│  Hermes Agent          │  │ PostgreSQL  │
│  perfil por usuario    │  └─────────────┘
│  web_search / extract  │
└───────┬────────────────┘
        │
┌───────▼────────┐
│  SearXNG       │
└────────────────┘
```

En el contenedor de la app conviven Next.js y el CLI de Hermes (la imagen se basa en `nousresearch/hermes-agent`). Cada turno se ejecuta como:

```
hermes -p plexo-<userId> chat --oneshot --query-file - --format stream-json \
  --toolsets web,skills --source tool --model <modelo> [--provider <proveedor>]
```

con la clave del usuario inyectada en el entorno del proceso. El BFF traduce los eventos JSONL (`system`/`text`/`tool_use`/`tool_result`/`result`) al contrato SSE que consume la UI, y persiste texto + fuentes.

## Quickstart (Docker)

```bash
# 1. Genera el secreto de cifrado
cp .env.example .env
echo "APP_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 2. Levanta todo (app + Postgres + SearXNG)
docker compose up -d --build

# 3. Abre http://localhost:3000, crea una cuenta y configura tu API key
#    en Ajustes (p. ej. OpenRouter).
```

Puertos por defecto: app `3000` (`APP_PORT=3010 docker compose up -d` para cambiarlo),
Postgres `127.0.0.1:5433`, SearXNG `127.0.0.1:8888`.

> La imagen de la app hereda la imagen oficial de Hermes (incluye Chromium y Python), por lo que el primer build tarda y pesa varios GB.

## Desarrollo local

Requisitos: Node 20+, Docker, y el CLI de Hermes instalado en el host
(`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`).

```bash
docker compose up -d db searxng      # Postgres en :5432, SearXNG en :8888
npm install
export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
export DATABASE_URL=postgres://plexo:plexo@localhost:5432/plexo
export SEARXNG_URL=http://localhost:8888
npm run migrate
npm run dev                          # http://localhost:3000
```

En local, Hermes usa `./.hermes-data` como `HERMES_HOME` (ignorado por git) y crea
un perfil por usuario. Para usar tu instalación existente: `HERMES_HOME=~/.hermes`.

Scripts: `npm run dev` · `npm run build` · `npm run start` · `npm run migrate` · `npm run typecheck` · `npm test`

## Estructura

```
app/                    # páginas (chat, login, register, settings) y API routes
  api/auth/*            # registro, login, logout
  api/chat              # SSE: spawn de Hermes + traducción de eventos + persistencia
  api/settings          # proveedor/modelo/api key cifrada
  api/threads/*         # CRUD de hilos e historial
components/chat/        # UI (assistant-ui): thread, tool UIs, fuentes, sidebar, ajustes
lib/hermes/             # perfiles y runner del CLI de Hermes
lib/db/                 # esquema Drizzle y cliente Postgres
lib/auth.ts             # sesiones con cookie (scrypt + SHA-256)
lib/crypto.ts           # AES-256-GCM para API keys
lib/sources.ts          # extracción de fuentes y parseo del bloque `## Sources`
scripts/migrate.mjs     # DDL idempotente
docker/                 # Dockerfile y script de arranque
searxng/settings.yml    # SearXNG con API JSON habilitada
docs/                   # investigación de Perplexity, stack y decisiones
```

## Limitaciones conocidas (MVP)

- El CLI de Hermes arranca en frío en cada turno (varios segundos); la sesión se reanuda con `--resume`.
- SSE sin replay: si se recarga a mitad de respuesta, se pierde el parcial (el historial persistido sí queda).
- Los adjuntos se extraen a texto (recortado a ~100 000 caracteres) y se inyectan en el prompt: los PDF escaneados sin capa de texto no funcionan todavía.
- `--yolo` está activo porque el agente corre sin TTY, pero los toolsets están limitados a `web,skills` (sin terminal ni acceso a ficheros).
- Sin multi-nodo/colas: pensado para una instancia self-hosted.

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
