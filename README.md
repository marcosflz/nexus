# Nexus

> Buscador con IA open source, autoalojado y *bring your own key*: pregunta, busca en la web y obtén respuestas con citas verificables. Con interfaces generativas interactivas y agentes autónomos que trabajan por su cuenta.

## Qué hace

**Búsqueda y respuesta**

- Respuestas con citas `[n]` interactivas (tarjeta de fuente al pasar el ratón), panel de fuentes y preguntas relacionadas.
- *Focus modes* (Web, Académico, Reddit, Finanzas, Noticias), modo **Research** y subida de archivos (PDF, DOCX, TXT, MD, CSV, JSON).
- Editar un mensaje, regenerar una respuesta, valorarla, renombrar, buscar y borrar chats, y **compartir un chat por enlace** público de solo lectura.
- Tema claro/oscuro. Los turnos siguen en el servidor aunque cierres la pestaña y se reanudan al recargar.

**Intelligent UI**

- El modelo puede responder con tarjetas, tablas, gráficos o mapas (OpenUI) y **pedirte datos con un formulario**: el turno se pausa, tú lo rellenas y continúa con tus valores.

**Agentes personalizados y autónomos**

- Cada agente tiene nombre, instrucciones, herramientas, modelo, conocimiento (tus documentos, con búsqueda de texto completo y citas), memoria y límites de gasto. Se versionan: cada cambio es una versión nueva y las ejecuciones fijan la suya.
- `@nombre` en un mensaje o el selector del chat los activan. Los públicos aparecen en una galería compartida.
- **Trabajan solos**: tareas programadas (cron con zona horaria), webhooks entrantes, vigilancia de feeds RSS y de páginas, y encadenado (un agente arranca cuando otro termina). Lo que hacen aparece en la **bandeja**; toda acción con efectos pide tu **aprobación**.
- Conectores **MCP** (con secretos cifrados) y, opcionalmente, un **navegador aislado por agente**.

## Estado

| | |
|---|---|
| Búsqueda, citas, hilos, adjuntos, Research, compartir, edición, valoración | ✅ |
| Runs duraderos y reanudables (AG-UI), pausa/reanudación, cancelación | ✅ |
| Motor nas-adk (sidecar) con herramientas propias de la app | ✅ |
| Agentes: versiones, conocimiento, memoria, galería, `@mención`, presupuestos | ✅ |
| Autonomía: cron, webhook, RSS, vigilancia, encadenado, bandeja, aprobaciones | ✅ |
| Conectores MCP | 🟡 alta, validación de URL y cifrado probados de extremo a extremo; la conexión MCP con cabeceras está probada con *mocks* en nas-adk, **no** contra un servidor MCP real |
| Ordenador por agente (navegador aislado) | 🟡 desplegable con `--profile computer`; la especificación del contenedor está validada contra Docker real, **no** se ha probado con la imagen de Playwright ni hay vista en vivo |
| Embeddings / pgvector, Model Council, ramas de conversación | ❌ no implementados |

## Arquitectura

```
┌────────────── Navegador ──────────────┐
│ Next.js · assistant-ui · shadcn ·     │
│ prompt-kit · OpenUI                   │
└──────────────────┬────────────────────┘
                   │ SSE AG-UI  (/api/chat · /api/runs/:id/events?after=seq)
┌──────────────────▼────────────────────┐        ┌──────────────┐
│ BFF Next.js                           │  SQL   │ PostgreSQL   │
│  auth · runs durables · worker (cola) │◄──────►│ runs, eventos│
│  política · auditoría · aprobaciones  │        │ agentes, …   │
└──────────────────┬────────────────────┘        └──────────────┘
                   │ HTTP firmado (secreto + HMAC)
        ┌──────────▼───────────┐  MCP  ┌────────────────────┐
        │ Sidecar de agentes   │──────►│ Conectores MCP     │
        │ (nas-adk · FastAPI)  │──────►│ Navegador del      │
        └──────────┬───────────┘       │ agente (opcional)  │
            ┌──────▼──────┐            └────────────────────┘
            │  SearXNG    │
            └─────────────┘
```

- **Un motor**: el sidecar **nas-adk** (Python, sin estado, en `services/agent/`), detrás del contrato `lib/agents/backend.ts`. Busca con SearXNG, lee páginas, usa conectores MCP, conocimiento y memoria, y entrega interfaces OpenUI como llamadas a herramienta.
- **Un protocolo**: AG-UI. Cada evento se numera (`seq`), se **guarda y después se publica**; cualquiera puede engancharse con `GET /api/runs/:id/events?after=<seq>` y recibe el backlog más el directo sin huecos ni duplicados.
- **El sidecar no tiene base de datos ni estado**: recibe el agente, la credencial y el historial en cada petición y llama al BFF (con un token de run firmado, de corta vida) para la política, el conocimiento, la memoria y la validación de OpenUI. Al pausarse devuelve un *checkpoint* que el BFF guarda.
- **Política fail-closed** (`deny > ask > allow`) evaluada *antes* de cada herramienta, con auditoría previa al efecto. Las rutinas (sin nadie delante) piden aprobación para cualquier acción con efectos.

## Quickstart (Docker)

```bash
# 1. Secretos
cp .env.example .env
echo "APP_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env   # cifra las API keys y los secretos de conectores
echo "NEXUS_AGENT_SECRET=$(openssl rand -hex 32)" >> .env   # app ⇄ sidecar de agentes

# 2. nas-adk vive en su propio repositorio (hermano de este) y se monta al construir el sidecar
git clone <url-de-nas-adk> ../nas-adk        # o define NAS_ADK_PATH en .env

# 3. Levanta todo (app + sidecar + Postgres + SearXNG)
docker compose up -d --build

# 4. Abre http://localhost:3000, crea la cuenta de administrador y guarda tu API key en Ajustes
```

Puertos por defecto: app `3000` (`APP_PORT=3010 docker compose up -d` para cambiarlo, o ponlo en `.env`), Postgres `127.0.0.1:5433`, SearXNG `127.0.0.1:8888`. El sidecar solo es accesible desde la red de Compose.

La imagen de la app es solo Node (Next.js); el motor de agentes va en su propio contenedor.

### Ordenador por agente (opcional)

```bash
docker pull mcr.microsoft.com/playwright/mcp:latest      # sandboxd no descarga imágenes
echo "NEXUS_SANDBOXD_URL=http://sandboxd:8095" >> .env
docker compose --profile computer up -d --build
```

Arranca `sandboxd` y un proxy del socket de Docker que **solo** permite rutas de contenedores y volúmenes (sandboxd nunca monta `docker.sock`). Cada agente con «Ordenador» activado tiene su contenedor y su volumen: sin puertos publicados, sin capacidades, sistema de ficheros de solo lectura, límites de memoria/CPU/procesos y en su propia red. Leer páginas es libre; pulsar, escribir o enviar pide aprobación; el agente puede **soltar el control** a una persona.

> ⚠️ El navegador **no** filtra su tráfico de salida a nivel de red: `--blocked-origins` ayuda pero Playwright lo documenta como *no* una barrera de seguridad, y un contenedor Docker puede alcanzar tu LAN por NAT. Si el agente va a navegar páginas no confiables, añade reglas en la cadena `DOCKER-USER` de iptables que bloqueen desde la red `nexus-sandbox` los rangos privados y `169.254.169.254`.

## Desarrollo local

Requisitos: Node 20+, Docker, `uv` y el repositorio de nas-adk (para el sidecar, obligatorio).

```bash
docker compose up -d db searxng           # Postgres en :5433, SearXNG en :8888
npm install
export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
export DATABASE_URL=postgres://plexo:plexo@localhost:5433/plexo
npm run migrate
npm run dev                               # http://localhost:3000

# Sidecar de agentes (obligatorio: ejecuta todos los turnos)
cd services/agent && uv sync --extra dev
NEXUS_AGENT_SECRET=dev SEARXNG_URL=http://localhost:8888 \
  .venv/bin/uvicorn nexus_agent.app:app_factory --factory --port 8090
# y en la app:  NEXUS_AGENT_URL=http://127.0.0.1:8090 NEXUS_AGENT_SECRET=dev NEXUS_INTERNAL_URL=http://127.0.0.1:3000
```

Tests: `npm test` · `npm run typecheck` · `npm run build` · `cd services/agent && .venv/bin/python -m pytest` · `cd services/sandboxd && .venv/bin/python -m pytest`.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `APP_ENCRYPTION_KEY` | **Obligatoria.** Cifra API keys y secretos de conectores (AES-256-GCM). |
| `NEXUS_AGENT_SECRET` | **Obligatoria.** Secreto compartido app ⇄ sidecar. Sin él no se pueden ejecutar turnos. |
| `NEXUS_AGENT_URL` / `NEXUS_INTERNAL_URL` | URL del sidecar / URL con la que el sidecar vuelve al BFF. |
| `NEXUS_AGENT_CONTEXT_TOKENS` | Contexto máximo por llamada al modelo en el sidecar (64000). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Activa el proveedor «Claude Code (suscripción)»; se genera con `claude setup-token`. Los admins deciden quién puede usarlo. |
| `NEXUS_ADMIN_EMAILS` | Correos que son admin en cada arranque (recuperación de acceso). |
| `NEXUS_MAX_CONCURRENT_RUNS` | Runs simultáneos (4). Los trabajos sobrantes esperan en cola. |
| `NEXUS_WORKER` | `off` desactiva el planificador (cron, RSS, cola de trabajos). |
| `NEXUS_ALLOW_PRIVATE_CONNECTORS` | Permite conectores MCP en red privada o `http`. **Desactivado por defecto** (evita SSRF). |
| `NEXUS_SANDBOXD_URL` | Activa el ordenador por agente (perfil `computer`). |
| `NEXUS_OPENUI`, `NEXUS_OPENUI_FOCUS`, `NEXUS_APPROVALS` | Interruptores de interfaz generativa y aprobaciones. |
| `APP_URL` | URL pública (enlaces compartidos, webhooks). |

Las variables `PLEXO_*` (nombre anterior) siguen funcionando como alias.

## Estructura

```
app/                    # páginas (chat, agentes, bandeja, uso, ajustes, /s/<enlace>) y API routes
  api/chat              # crea el run (o lo reanuda) y devuelve su SSE
  api/runs/[id]/*       # eventos reanudables por seq y cancelación
  api/agents/*          # CRUD, versiones, conocimiento, disparadores, ejecutar ahora
  api/internal/*        # callbacks del sidecar (política, conocimiento, memoria, OpenUI)
  api/hooks/*           # webhooks públicos
components/             # chat (assistant-ui), agentes, bandeja, ui/ (shadcn + prompt-kit)
lib/agents/             # interfaz AgentBackend, motores, spec, versiones, presupuestos
lib/agui/               # eventos AG-UI, reducer puro y cliente SSE con reconexión
lib/runs/               # ejecutor, bus, tail SSE, store, rutinas
lib/worker/ lib/triggers/  # cola de trabajos (SKIP LOCKED), cron, RSS, vigilancia, webhooks
lib/policy/ lib/audit/  # motor de políticas, gateway y auditoría
lib/knowledge/ lib/memory/ lib/connectors/ lib/sandbox/
services/agent/         # sidecar Python (nas-adk)
services/sandboxd/      # gestor de navegadores aislados
scripts/migrate.mjs     # DDL idempotente
```

## Seguridad

- Sin registro libre: la primera cuenta nace admin y los admins gestionan el resto en Ajustes → Usuarios. Desactivar una cuenta cierra sus sesiones y detiene sus rutinas.
- Contraseñas con scrypt; sesiones con token aleatorio (solo se guarda su SHA-256) y cookie `httpOnly`.
- API keys y secretos de conectores cifrados en reposo; el sidecar los recibe por petición firmada y no los registra.
- Las rutas `/api/internal/*` solo aceptan el token de run firmado, atado a run y usuario, y solo mientras el run sigue en marcha.
- Toda URL que el servidor o el agente consultan pasa una guardia SSRF (resolución DNS y rechazo de redes privadas en cada redirección).
- El contenido externo (webhooks, feeds, páginas vigiladas) se marca como **dato no confiable** para el modelo.
- Los enlaces compartidos solo exponen texto y fuentes, llevan `noindex` y se pueden retirar.

## Limitaciones conocidas

- **Una sola instancia de la app**: el bus de eventos y el ejecutor son de un solo proceso (haría falta LISTEN/NOTIFY).
- Con Claude Code (suscripción) las respuestas llegan de golpe, sin streaming, y hay una sola suscripción para toda la instancia.
- Los adjuntos y el conocimiento se extraen como texto: los PDF escaneados (sin capa de texto) no funcionan.
- La búsqueda en el conocimiento es de **texto completo** (palabras), no semántica.
- El texto de un agente público incluye su conocimiento: quien lo use puede consultarlo (no descargar los ficheros).
- Para OpenCode Go, si la URL base por defecto no acepta tu clave, indica la correcta en el campo «URL base» de Ajustes.

## Migrar desde Plexo

El proyecto se llamaba Plexo. Al actualizar no se pierde nada:

- **Volúmenes**: `docker-compose.yml` fija `plexo_db-data` como nombre de volumen. El usuario y la base de datos de Postgres siguen llamándose `plexo`. El volumen `plexo_hermes-data` del motor retirado ya no se usa (`docker volume rm plexo_hermes-data` si quieres liberarlo).
- **Contenedores**: ahora son `nexus-*`. Si tienes los antiguos, `docker compose -p plexo down` (sin `-v`) y luego `docker compose up -d --build`.
- **Motor Hermes retirado**: los hilos que lo usaban pasan a nas-adk al migrar; la columna `threads.hermes_session_id` queda sin uso.
- **Sesión**: la cookie pasa a `nexus_session`; `plexo_session` se sigue aceptando hasta que caduque.

## Documentación

[`docs/decisiones-mvp.md`](docs/decisiones-mvp.md) (decisiones y su porqué) · [`docs/proximos-pasos.md`](docs/proximos-pasos.md) (backlog) · [`docs/stack-tecnico.md`](docs/stack-tecnico.md) y [`docs/perplexity-funcionalidades.md`](docs/perplexity-funcionalidades.md) (investigación).

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
