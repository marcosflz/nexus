# Decisiones del MVP (octubre 2026)

Registro de las decisiones tomadas para el esqueleto, con su motivación y alternativas
descartadas. Sirve como ADR ligero.

> **Noviembre 2026 · Hermes retirado.** El motor de agentes es solo nas-adk (sidecar Python en
> `services/agent`). Hermes aportaba únicamente búsqueda web y *skills*, y obligaba a mantener un
> segundo camino (sesiones propias, UI y follow-ups dentro del texto, imagen de varios GB). Las
> secciones que hablan de Hermes se conservan como historia de las decisiones.

## 1. Decisiones de producto (confirmadas por el usuario)

| Tema | Decisión |
|---|---|
| Modelo | Clon open source, sin suscripciones ni niveles; usuarios sencillos para el MVP |
| Despliegue | Self-hosted con Docker Compose |
| Alcance MVP | Búsqueda con citas + follow-ups, hilos persistentes, focus modes, subida de archivos, Research/informes |
| Auth | Email + contraseña (sesión con cookie) |
| Búsqueda | SearXNG autoalojado por defecto |
| Backend | Next.js full-stack (route handlers) |
| Licencia | MIT |
| Modelos LLM | BYO API key por usuario (el servidor no paga inferencia) |

## 2. Hallazgo clave sobre Hermes

El **API server** de Hermes (OpenAI-compatible, `:8642`) **no acepta claves de proveedor por
petición**: sus campos por request son `model`, `provider` y `model_options`. Las credenciales
residen en el perfil/configuración del gateway. El camino documentado multi-usuario son
**profiles** (un `HERMES_HOME` por usuario, con su `.env` y config propios).

Alternativas para BYO keys:

1. **CLI por turno con perfil por usuario** (elegida): `hermes -p <perfil> chat --oneshot
   --format stream-json`, con la clave del usuario en el entorno del subproceso. Cada perfil
   aísla sesiones, memoria y configuración. Sin puertos extra ni orquestación de contenedores.
2. API server + un perfil/puerto por usuario: descartada para el MVP por requerir orquestación
   (arrancar gateways, asignar puertos) y por no resolver la key por petición sin esa
   infraestructura.
3. Embeber `AIAgent` (guía oficial "Hermes as a Python library", admite `api_key` por
   instancia): buena opción de futuro (sin cold start, streaming por callbacks), pero añade un
   sidecar Python al stack elegido. Descartada para el MVP.
4. `docker exec` contra un contenedor Hermes desde el BFF: descartada por requerir montar el
   socket de Docker en la app.

## 3. Arquitectura elegida

- **Un perfil Hermes por usuario** (`nexus-<hash>`; hasta octubre de 2026 se llamaba `plexo-<hash>`, ver «Migrar desde Plexo» en el README), creado en el primer turno con
  `hermes profile create` y personalizado con `SOUL.md` (motor de respuestas con citas `[n]` +
  `## Sources`) y `config.yaml` (`search_backend: searxng`, `extract_backend: firecrawl`).
  Se escriben **solo la primera vez** para no pisar cambios del usuario.
- **Runner**: `lib/hermes/runner.ts` lanza el CLI con `--format stream-json`, parsea JSONL
  (`system`, `text`, `tool_use`, `tool_result`, `result`) y emite `TurnEvent` normalizados.
  El BFF los traduce a SSE propio; la UI usa `ExternalStoreRuntime` de assistant-ui.
- **Citas**: el texto final se parsea (`## Sources`) y los outputs de `web_search`/`web_extract`
  se complementan con `lib/sources.ts`; las fuentes se persisten en `messages.sources` y se
  renderizan como parts `source` (chips numerados).
- **Claves**: cifradas con AES-256-GCM (`APP_ENCRYPTION_KEY`), descifradas solo al lanzar el
  turno y pasadas por entorno; nunca se escriben en disco.
- **Búsqueda**: SearXNG (search, gratis) + Firecrawl keyless (extract, sin clave). El usuario
  puede apuntar a otros backends editando el `config.yaml` de su perfil.
- **Contenedor único de app** basado en `nousresearch/hermes-agent` (Next.js + CLI juntos),
  preservando el entrypoint (inicializa `/opt/data`) e `init: true` en Compose.

## 4. Por qué no AI SDK / data-stream en el frontend

Se eligió `ExternalStoreRuntime` con SSE propio para no acoplarse al vaivén de versiones de
`@assistant-ui/ai-sdk` (requiere `ai@^7`) y porque el protocolo de Hermes (JSONL) no es
UI Message Stream. El coste es mantener la conversión de parts, que ya está aislada en
`components/chat/chat-app.tsx`.

## 5. Seguridad (MVP)

- `--yolo` en el runner (no hay TTY para approvals) pero los toolsets están limitados a
  `web,skills`: el agente no puede ejecutar shell ni tocar ficheros fuera de su workspace.
- Workspace por usuario en `HERMES_HOME/workspaces/<perfil>` como `cwd`, evitando fugas de
  `AGENTS.md`/contexto de otros proyectos.
- Sesiones con token aleatorio (se guarda solo SHA-256), cookies httpOnly y `sameSite=lax`.
- `APP_ENCRYPTION_KEY` obligatoria: sin ella la app falla al guardar claves.

## 6. Deuda técnica consciente

- Reconciliación tras recarga y cancelación más fina (`/v1/runs` si se migra a API server).
- Cuotas/coste por usuario (los tokens se persisten, pero no hay panel ni límites).
- Compartir hilos por enlace, búsqueda en historial e índices de embeddings para adjuntos grandes.
- Evaluar el sidecar con `AIAgent` embebido para eliminar el cold start por turno.

## 7. Iteración 2 (focus, adjuntos, Research, trazas)

Decisiones de la segunda iteración:

- **Adjuntos**: la extracción se hace en el BFF (`unpdf` para PDF, `mammoth` para DOCX, texto plano
  para TXT/MD/CSV/JSON) y el texto se inyecta en el prompt; **no** se habilita el toolset `file`
  de Hermes porque incluye `write_file`/`patch` (riesgo de prompt injection desde web). Los
  adjuntos se persisten como metadatos en `messages.attachments` (el texto no se guarda en la
  BD, solo viaja en la petición).
- **Focus modes**: se implementan como instrucción de prompt (`lib/focus.ts`); en el futuro pueden
  mapearse a categorías/dominios de SearXNG si su backend lo expone.
- **Research**: `mode: "research"` eleva `--max-turns` a 40 y añade una instrucción de informe
  estructurado. No hay bucle de aclaraciones ni sandbox (fases posteriores).
- **Trazas y uso**: `messages.tools` y `messages.usage` persisten el ciclo de las herramientas
  (id, nombre, input, estado, duración) y los tokens; el GET del hilo los devuelve y la UI los
  reconstruye en el historial.
- **Tests**: `vitest` con pruebas unitarias de fuentes (`lib/sources.test.ts`), cifrado
  (`lib/crypto.test.ts`) y del runner usando un binario falso de Hermes
  (`lib/hermes/runner.test.ts`) que emite JSONL real del contrato.

## 8. Iteración 3 (runs duraderos y AG-UI)

Primera fase del plan de evolución (`AgentBackend`, agentes autónomos, Intelligent UI v2):

- **Protocolo único**: los turnos emiten eventos AG-UI (`@ag-ui/core`); las extensiones van como `CUSTOM nexus.*`
  (`nexus.sources`, `nexus.session`, `nexus.message`). El reducer de `lib/agui/reducer.ts` es el mismo para el
  streaming en vivo, la reconstrucción tras recargar y el guardado final.
- **Run desacoplado de la petición**: `POST /api/chat` crea el run y lo lanza en segundo plano. Antes, cerrar la
  pestaña abortaba el turno; ahora el turno sigue y se puede volver a seguir. La cancelación es explícita.
- **Persistir y luego publicar**: cada evento se guarda en `run_events` antes de pasar por el bus en proceso. El
  seguimiento se suscribe al bus *antes* de leer el backlog y deduplica por `seq`, así que no hay hueco posible.
  Los deltas de texto se agrupan en ventanas de ~75 ms para no escribir una fila por token, y `runs.last_seq` solo
  se actualiza en el heartbeat y al cerrar.
- **Estados**: `awaiting_input` (pausa deliberada, p. ej. una aprobación) se distingue de `interrupted` (el proceso
  murió). Al arrancar, todo run `running` se marca `interrupted` sin esperar al lease, porque el ejecutor es de un
  solo proceso y su registro empieza vacío.
- **Orden real del mensaje**: `messages.parts` guarda texto y herramientas en su orden. Solo se persiste si el texto
  en streaming coincide con el texto final del motor; si no, la UI usa el orden clásico (herramientas, luego texto).
- **Tool ids de Hermes**: el JSONL no trae id, así que `tool_result` se empareja con `tool_use` por cola FIFO por
  nombre. Es una mitigación (resultados fuera de orden de la misma herramienta se cruzarían), no una solución.
- **Rebranding a Nexus**: ver «Migrar desde Plexo» en el README. Los volúmenes, el usuario y la base de datos de
  Postgres conservan el nombre `plexo` para no perder datos.

## 9. Iteraciones 4 a 8 (agentes, Intelligent UI v2, autonomía)

- **Dos motores tras `AgentBackend`**: Hermes sigue siendo el buscador (CLI, solo lectura, auditado a posteriori);
  nas-adk entra como sidecar Python **sin estado** (`services/agent/`). Para eso se amplió nas-adk de forma genérica:
  `ToolInterrupt`, `ToolDecision`, `run_async(resume=…)`, presupuesto de tokens, MCP con cabeceras y filtros, y un
  proveedor `openai-compatible`. La política se evalúa *antes* de cada herramienta en el sidecar.
- **Pausar = devolver un checkpoint**: el sidecar serializa la sesión al interrumpirse y el BFF la guarda en
  `runs.checkpoint`. Reanudar usa **la misma fila y el mismo log** (`seq` continuo), así un replay completo cruza la
  pausa y el mensaje final incluye lo anterior a ella. La transición `awaiting_input → running` es atómica.
- **Intelligent UI**: con nas-adk, `present_openui` y `prompt_openui` son llamadas reales a herramientas (el
  formulario pausa el run). Con Hermes se mantiene el bloque cercado como alternativa. La especificación de OpenUI se
  ofrece por **perfiles** (`minimal`, `data`, `forms`, `lists`, `full`): ~21k caracteres frente a ~53k.
  `@openuidev/react-ui` lleva `"use client"`: en servidor se importa de `/genui-lib` y se declara en
  `serverExternalPackages`.
- **Agentes versionados e inmutables** (`agent_versions`): un run fija su versión. Un spec nuevo es una versión nueva.
  Los borradores generados por un modelo se *sanean* (sin conectores, ordenador ni políticas).
- **Presupuestos por usuario**: cada ejecución la paga con su clave quien la lanza, así que el límite de un agente
  se mide por persona y un agente público no agota el cupo de su autor.
- **Autonomía**: cola de trabajos en Postgres (`FOR UPDATE SKIP LOCKED`), planificador que avanza `next_run_at` con
  un UPDATE condicionado (comparación a milisegundos), cada etapa del ciclo aislada (un disparador roto no bloquea
  la cola), reintentos con backoff, y concurrencia limitada. Las rutinas corren con `initiator: routine`.
- **Aprobaciones**: `ask` crea una fila `approvals` con la `tool_call_id`, pausa el run y notifica; decidir
  (`POST /api/approvals/:id`) reanuda la llamada concreta. Una llamada aprobada no vuelve a consultar la política.
- **Conectores**: URL validada (sin red privada ni `http` por defecto), secreto cifrado, solo del usuario que ejecuta
  el run (un agente público no hereda los conectores de su autor).
- **Ordenador**: `sandboxd` gestiona un contenedor por agente a través de un proxy del socket de Docker. Las
  herramientas llegan como `browser__browser_*` y se mapean a las reglas de navegador existentes.
- **No hecho, a propósito**: pgvector/embeddings (la búsqueda es de texto completo), Model Council, ramas de
  conversación (`messages.parent_id` ya existe) y vista en vivo del navegador. El filtrado de tráfico de salida del
  navegador depende de reglas del host (ver README).


## Rework de la UI (estilo Perplexity)

Plan completo en `docs/rework-ui-perplexity.md`.

- **Shell compartido** en `app/(app)/layout.tsx` + `components/shell/*`: barra lateral, buscador (Ctrl+K), diálogos y ajustes comparten estado vía `useShell()`.
- **Fijados y proyectos**: tabla `projects` y columnas `threads.pinned_at` / `threads.project_id` (migración en `scripts/migrate.mjs`). Borrar un proyecto conserva sus chats (`ON DELETE SET NULL`). API: `/api/projects`, y `PATCH /api/threads/:id` acepta `pinned` y `projectId`.
- **Ajustes** en modal con hash `#settings/<sección>` y también a pantalla completa en `/settings`.
- **Preferencias de búsqueda** (fuente, modo, interfaz generativa) en `localStorage["nexus.prefs"]` (`lib/prefs.ts`).
