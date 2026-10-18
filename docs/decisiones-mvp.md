# Decisiones del MVP (octubre 2026)

Registro de las decisiones tomadas para el esqueleto, con su motivación y alternativas
descartadas. Sirve como ADR ligero.

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

- **Un perfil Hermes por usuario** (`plexo-<hash>`), creado en el primer turno con
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
