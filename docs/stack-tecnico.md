# Stack técnico para un "Perplexity opensource"

> Investigación de frontend (assistant-ui) y de backends de agente candidatos (opencode, Hermes Agent, Pi) para construir un clon de Perplexity.
> Estado: octubre 2026. Versiones y estrellas cambian rápido: reverificar antes de fijar dependencias.

---

## 1. Frontend: assistant-ui

**Veredicto rápido:** es el mejor punto de partida del ecosistema React en 2026 para este vertical. MIT, ~12,4k★, respaldado por Y Combinator. Cubre de forma casi nativa lo más difícil de un clon: **citas, fuentes, informes de research y trazas de agente**. Coste: framework pre-1.0 (`@assistant-ui/react` 0.15.x) con cambios rompientes, acoplado a Tailwind/shadcn, y las citas inline requieren mapeo propio.

- Repo: <https://github.com/assistant-ui/assistant-ui> · Docs: <https://www.assistant-ui.com/docs> · Licencia MIT.
- Paquetes: `@assistant-ui/react` (primitivas + runtimes), `@assistant-ui/ai-sdk` (adaptador AI SDK v7; el antiguo `@assistant-ui/react-ai-sdk` es legacy), `@assistant-ui/react-markdown`, `assistant-stream` (protocolo TS y **también Python en PyPI**), `@assistant-ui/react-langgraph`, `@assistant-ui/react-ag-ui`, `@assistant-ui/react-a2a`, `@assistant-ui/react-opencode` (experimental), `@assistant-ui/react-generative-ui`, `assistant-cloud`. `@assistant-ui/styles` está **deprecado**; `@assistant-ui/ui` no existe como paquete: el kit se distribuye por **registry de shadcn** (`npx shadcn@latest add @assistant-ui/thread`).
- Docs para agentes: cada página tiene `.md`, hay `llms.txt`, `llms-full.txt` y endpoint MCP.

### 1.1 Arquitectura

Tres capas: **componentes** (primitivas headless + kit shadcn) → **runtime** (estado: mensajes, hilos, branching, edición, runs) → **Assistant Cloud** (opcional).

Runtimes core:

| | `LocalRuntime` | `ExternalStoreRuntime` |
|---|---|---|
| Dueño del estado | El runtime | Tú (Zustand, Redux, TanStack…) |
| Complejidad | Baja | Media |
| Ideal para | API simple/greenfield | Apps con store propio y streaming manual |

Sobre ellos se apoyan protocolos (`DataStream`, `AssistantTransport`) y adaptadores (AI SDK, LangGraph, AG-UI, A2A, Google ADK, OpenCode, Eve…). Provider raíz: `AssistantRuntimeProvider`.

### 1.2 Modelo de mensajes y parts

Parts relevantes: `text`, `reasoning`, **`source`** (`{ sourceType: "url"|"document", id, url?, title? }` — citas de primera clase), **`tool-call`** (`toolCallId`, `toolName`, `args`, `argsText`, `result?`, `approval?`), `data-<name>` (UI generativa), imagen, attachments. Estados: `running | complete | incomplete | requires-action`.

Regla de streaming a tener en cuenta: *"only the last part streams"*; en `LocalRuntime` cada `yield` reemplaza el contenido acumulado.

### 1.3 Integración con backend

**Vía AI SDK v7** (recomendada si usas `ai`): backend con `streamText` + `createUIMessageStreamResponse`; frontend con `useChatRuntime({ transport: new AssistantChatTransport({ api: "/api/chat" }) })`.

**Vía backend propio** con `useExternalStoreRuntime` (funciona con cualquier REST/SSE):

```tsx
const runtime = useExternalStoreRuntime({
  isRunning,
  messages,                    // tu estado
  convertMessage: (m) => ({ role: m.role, content: [{ type: "text", text: m.content }], id: m.id }),
  onNew: async (message) => { /* fetch a tu API y muta el mensaje in-place mientras llega el stream */ },
  onEdit: async () => {},      // habilita edición
  onReload: async () => {},    // habilita regenerar
  onCancel: async () => {},
  onAddToolResult: () => {},   // tool results / HITL
});
```

Hay además `LocalRuntime` con un `ChatModelAdapter.run` async-generator, protocolo **DataStream** (`useDataStreamRuntime` + `assistant-stream` en TS/Python), y **AssistantTransport** (snapshots de estado del agente con operaciones `set`/`append-text`).

### 1.4 Tool calls y generative UI

La API moderna es `defineToolkit` + `Tools({ toolkit })`. Un tool backend-only solo necesita `render`:

```tsx
export const WebSearchToolUI: ToolCallMessagePartComponent<
  { query: string },
  { results: SearchResult[] }
> = ({ args, status, result }) => (
  <div>
    <SearchIcon /> Search: "{args.query}"
    {status.type === "running" && <LoadingSpinner />}
    {result?.results.map((r, i) => <ResultCard key={i} item={r} />)}
  </div>
);
```

El mismo patrón sirve para un visor de screenshots de computer-use. Existe `@assistant-ui/react-generative-ui` (tool `present` + vocabulario de ~29 componentes) y `makeAssistantDataUI` para componentes montados con datos finales.

### 1.5 Piezas ya pensadas para "Perplexity"

- **`Sources`**: chips/tarjetas de fuentes con favicon, título y enlace seguro; renderer del part `source` o variante estática desplegable con snippet/fecha.
- **`InlineCitation`**: marcador numerado en prosa con preview. ⚠️ No infiere offsets: hay que mapear cada `source` a su posición en el texto.
- **`ResearchReport`**: outline que se rellena sección a sección (`pending | writing | done`) con contador de fuentes; encaja con un tool `write_report` que va enviando `args`.
- **`ConfidenceMarker`**: `grounded | inferred | uncertain`; no hay concepto nativo de confianza por claim (se construye con un tool propio).
- **Reasoning / Chain of Thought**: part `reasoning` + `GroupedParts`/`groupPartByType` → acordeón de "pensando".
- **`TaskGroup` / `TaskCard`**: subagentes representados como conversaciones anidadas bajo el tool call que los lanzó.

### 1.6 Ejemplo "Perplexity Clone" y brecha real

URL: <https://www.assistant-ui.com/examples/perplexity>. Es un **clon visual**: composer pegajoso, dropdowns Search/Research/Labs y Best/Sonar/Claude/GPT/Gemini, paleta crema/espresso, footer con gradiente. **No incluye** backend de búsqueda ni streaming de fuentes. Para un clon funcional falta: (1) backend de búsqueda/scrape, (2) tool `web_search`, (3) mapeo de resultados a source parts/citas, (4) trazas por steps.

Mapeo UI Perplexity → assistant-ui:

| UI Perplexity | Pieza assistant-ui |
|---|---|
| Tarjetas/pills de fuentes | `SourceMessagePart` + `Sources` |
| Citas `[1]` en el texto | `InlineCitation` (mapeo manual) |
| Modo Research con informe | tool `write_report` + `ResearchReport` |
| Panel de razonamiento | parts `reasoning` + ChainOfThought |
| Tarjetas de resultados de búsqueda | Tool UI custom |
| Trazas de agente/subagentes | Tool UI + `TaskGroup` |
| Historial de hilos | Cloud o `RemoteThreadListAdapter` propio |

### 1.7 Limitaciones

Pre-1.0 con APIs `unstable_*` y renombrados (`react-ai-sdk` → `ai-sdk`); exige `ai@^7` para el adaptador actual; dependencia de Tailwind+shadcn (el modo sin Tailwind está deprecado); citas y confianza no automáticas; reglas sutiles de streaming; HITL no soportado en data-stream; persistencia real requiere Cloud (de pago, no open source salvo SDK cliente) o adapters propios; React 18/19.

---

## 2. Backends de agente candidatos

### 2.1 opencode (MIT) — servidor headless "agent as a service"

Repo: <https://github.com/anomalyco/opencode> (~208k★). Hay **dos superficies**: V1 estable (`opencode.ai/docs`, servidor en `:4096`, SSE `/event`, SDK `@opencode-ai/sdk`) y V2 beta 2.0.6 (`opencode.ai/v2/docs`, API `/api/*`, OpenAPI con 141 operaciones, `websearch` multi-proveedor, `browser`/`execute`).

**Lo que ya funciona hoy a favor:**

- `opencode serve` expone REST + SSE + OpenAPI 3.1 (`/doc`), con SDKs TS/Go/Python generados. Basic Auth opcional (`OPENCODE_SERVER_PASSWORD`) y `--cors`.
- **Búsqueda web built-in**: V1 `websearch` (Exa/Parallel, sin API key con Zen/Go o flags) + `webfetch` (URL → markdown/text/html). V2 añade 5 proveedores (Exa, Firecrawl, Parallel, Tavily, TinyFish), failover ante 429 y `POST /api/websearch`.
- **Subagentes**: V1 `task` con `general`/`explore`/`scout`; V2 `subagent` con `background: true` y reanudación por `sessionID`.
- **Streaming mapeable a UI**: `message.part.updated` con `delta` para texto y `ToolPart.state` (`pending → running → completed/error` con `input`/`output`/`title`) para tarjetas de herramientas; `session.idle` cierra el turno; `permission.*` para approvals.
- **Custom tools**: `.opencode/tools/*.ts` (`tool({ description, args, execute })`) y plugins; MCP local/remoto con OAuth; agentes primarios custom (markdown + frontmatter, `agent`/`model` por mensaje o `POST /api/session/{id}/agent` en V2).
- 75+ providers (Anthropic, OpenAI, Google, OpenRouter, Groq, Ollama…), salida estructurada por JSON Schema y licencia MIT.

Flujo recomendado (V1):

```
POST /session → ses_x
GET /event (SSE, abrir ANTES del prompt; no hay replay)
POST /session/:id/prompt_async { agent, model, system, parts }
  → text+delta → tokens
  → tool/state → "Buscando…", "Leyendo URL…" + resultados
  → step-finish → coste/tokens
  → session.idle → fin
Fallback: GET /session/:id/message (reconciliación canónica)
```

**Lo que hay que construir/ajustar:**

1. **Sesgo de coding agent**: system prompt orientado a código y carga de `AGENTS.md`. Solución: agente primario propio (`perplexity`) con system propio, permisos restrictivos (deny `edit`/`bash`; allow `webfetch`/`websearch`), steps acotado, workspace vacío dedicado.
2. **Citas nativas**: no hay campo "sources"; parsear `ToolPart.state.output/metadata` de websearch/webfetch, o forzar JSON schema, o registrar provider propio de websearch (V2: `ctx.websearch.transform`).
3. **`browse_page` para páginas JS-pesadas**: `webfetch` es GET simple → tool custom o MCP (Firecrawl/Tavily/Playwright).
4. **SSE sin replay** → persistir en DB propia y reconciliar al reconectar.
5. **Permisos en no-interactivo** → configurar explícitos o `--auto`.
6. **Multi-tenancy**: modelo local/single-user → BFF + instancias/workspaces aislados por usuario.
7. **Coste**: medir `AssistantMessage.tokens/cost`, usar `steps`, `small_model`, compaction.

**Riesgos**: V2 experimental (141 ops "Experimental HttpApi"); computer-use real solo vía `browser` de la desktop app (server-side → MCP Playwright); dependencia de la salud del proyecto.

### 2.2 Hermes Agent (Nous Research, MIT) — el candidato que mejor encaja

Repo: <https://github.com/NousResearch/hermes-agent> · Docs: <https://hermes-agent.nousresearch.com/docs/>. Agente autónomo **generalista** (no solo coding), Python, MIT, actividad diaria. Es, de los tres, el único con **búsqueda + citas verificables de fábrica**:

- **`web_search` + `web_extract` multi-backend intercambiable**: Firecrawl, SearXNG (autoalojado, gratis), Tavily, **Perplexity**, Exa, Parallel, Brave, DDGS, xAI, OpenAI Native; configuración por capacidad, keyless free-tier ring y failover.
- **Skill `grounded-citations`**: citas numeradas inline + lista `Sources:` *"Perplexity-style"*, con ledger `url → [n]` y verificación de citas con evidencia textual.
- **Modo headless/API**: `hermes serve` (puerto 9119) y **API server compatible con OpenAI** (`/v1/chat/completions`, `/v1/responses`, `/api/jobs`, puerto 8642); one-shot `hermes -z` y ACP/MCP.
- Memoria persistente, skills auto-generadas, subagentes, cron, ~40–100 herramientas, backends de terminal (local, Docker, SSH, Modal…), MCP.
- ~300+ modelos vía Nous Portal, OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, Ollama…

**Encaje:** alto. Tu UI (Next.js/assistant-ui) puede hablar con su API OpenAI-compatible sin adaptadores exóticos, y la skill de citas ahorra el trabajo más tedioso. **Riesgos:** proyecto v0.x con muchísimo churn (releases semanales y decenas de miles de issues abiertos), auth del API server a configurar (`API_SERVER_KEY`), rate limits de las capas keyless, y que conviene fijar versión + aislar el runtime.

### 2.3 Pi (earendil-works, MIT) — interesante para embeber, no para este caso

Repo: <https://github.com/earendil-works/pi> (antes `badlogic/pi-mono`). *Minimal agent harness* coding-first en TypeScript, con modos interactivo/print-JSON/**RPC**/**SDK** (embebible). `pi-ai` da API unificada multi-proveedor; `pi-agent-core` es el runtime embebible. **Por diseño no trae web search ni MCP**: solo 4 tools (`read/write/edit/bash`) y todo lo demás por extensiones (`pi-web-access`, `pi-search-boost`, `pi-mcp-adapter`); el fork `oh-my-pi` sí añade `web_search`/browser/computer-use. Para un clon de Perplexity es más trabajo que Hermes; encaja si el equipo es TS y quiere control total del bucle.

> Nota de desambiguación: "Hermes" = Hermes Agent (no los modelos Hermes 3/4 de Nous, que son LLMs y de hecho Nous no recomienda usar dentro del agente). "Pi" = earendil-works/pi (no Inflection Pi ni Pi Labs, ambos cerrados/irrelevantes). "opencode" = el agente de coding MIT.

---

## 3. Comparativa de backends

| Criterio | opencode (V1) | Hermes Agent | Pi |
|---|---|---|---|
| Licencia | MIT | MIT | MIT |
| Lenguaje | TS/Bun (+SDKs Go/Python) | Python | TypeScript |
| Servidor headless | ✅ `serve` + OpenAPI + SSE | ✅ `serve` + API OpenAI-compatible | RPC/SDK (embebible) |
| Web search | ✅ Exa/Parallel + 5 providers en V2 | ✅ 10+ backends configurables | ❌ de fábrica (extensiones) |
| Extracción de páginas | ✅ `webfetch` | ✅ `web_extract` | ❌ (extensión) |
| Citas verificables | ❌ construir | ✅ skill `grounded-citations` | ❌ construir |
| Subagentes background | ✅ (V2) | ✅ | ❌ |
| Custom tools / MCP | ✅ ambos | ✅ ambos | ✅ extensiones (MCP no nativo) |
| Computer-use | Solo desktop app (V2 `browser`) | No nativo (vía herramientas/terminal) | Fork `oh-my-pi` |
| Madurez | Alta pero en transición V1→V2 beta | v0.x, churn alto | Harness estable, ecosistema |
| Encaje como backend | Alto | **Muy alto** | Medio |

---

## 4. Arquitectura propuesta

```
┌──────────────────────────── UI (Next.js + assistant-ui) ────────────────────────────┐
│  Composer (Search / Research / Sources…)   Thread   Sources / InlineCitation        │
│  Tool UIs (web_search cards, browse, screenshots)   Reasoning   ResearchReport      │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │ SSE/WebSocket (BFF propio)
┌──────────────────────────────────────▼───────────────────────────────────────────────┐
│  BFF (Node/Fastify o Next route handlers)                                            │
│   - Traduce stream del agente → parts de assistant-ui (text/source/tool-call)        │
│   - Persiste hilos/mensajes en DB propia (Postgres) + reconciliación                 │
│   - Auth, multi-tenancy, cuotas y medición de coste                                  │
└───────────────┬──────────────────────────────────────────┬───────────────────────────┘
                │                                          │
       ┌────────▼─────────┐                      ┌─────────▼──────────┐
       │ Hermes Agent      │  (alternativa)       │ opencode serve      │
       │ serve + API OpenAI│                      │ REST + /event SSE   │
       │ web_search/extract│                      │ websearch/webfetch  │
       │ grounded-citations│                      │ tools custom + MCP  │
       └────────┬──────────┘                      └─────────┬──────────┘
                │                                          │
     ┌──────────▼──────────────┐               ┌───────────▼────────────┐
     │ SearXNG / Tavily / Exa  │               │ Exa/Parallel/Tavily +  │
     │ + reranker (opcional)   │               │ MCP Firecrawl/Playwright│
     └─────────────────────────┘               └────────────────────────┘
```

**Decisión de backend — recomendación:** empezar con **Hermes Agent** detrás de un BFF propio (menos trabajo en búsqueda y citas; API estándar). Mantener **opencode** como alternativa/segundo backend si se quiere un runtime más maduro y control granular de sesiones/permisos, asumiendo que hay que construir la capa de citas y neutralizar el sesgo de coding. **Pi** solo si se decide embeber el bucle en TypeScript y construir búsqueda/extracción a medida.

En el frontend, conectar por **`ExternalStoreRuntime`** o protocolo **DataStream/assistant-stream** (hay implementación Python, útil si el BFF es Python) en vez de depender del adaptador AI SDK v7, para no acoplarse al vaivén de versiones.

---

## 5. Fases sugeridas

1. **Fase 0 — vertical slice**: UI assistant-ui + BFF + Hermes con `web_search` (SearXNG) + `grounded-citations` + Sources/InlineCitation. Sin cuentas ni persistencia compleja.
2. **Fase 1 — producto**: persistencia de hilos, streaming robusto con reconexión, related questions, focus modes, selector de modelo, feedback.
3. **Fase 2 — Research**: descomposición → subconsultas → informe por secciones (`ResearchReport`) + export; opcional sandbox para gráficos/datos.
4. **Fase 3 — conocimiento**: Projects con archivos, conectores MCP (Drive/Notion/Slack), memoria por proyecto.
5. **Fase 4 — agentes**: tareas programadas, background, computer-use vía Playwright MCP, y multi-modelo tipo Council.

---

## 6. Riesgos y decisiones abiertas

- **Backend en beta permanente**: ambos agentes (Hermes v0.x, opencode V2 experimental). Mitigación: BFF que aísle el protocolo + pin de versiones + tests de contrato.
- **Citas**: es el corazón del producto. Decidir contrato (JSON schema vs parseo de tool output vs skill) y verificarlo en CI.
- **SSE sin replay**: persistencia y reconciliación propias obligatorias.
- **Coste por query**: instrumentar tokens/costes y presets (tipo Perplexity: fast/low/medium/high).
- **Multi-tenancy**: aislar workspace/sesión por usuario desde el inicio (scratch dirs).
- **Licencias**: todo el stack propuesto es MIT (Hermes, opencode, Pi, assistant-ui); Assistant Cloud es opcional de pago.

---

## 7. Primeras impresiones (resumen)

1. **El proyecto es viable y el stack encaja**; el trabajo duro no es el chat, es la capa de búsqueda→citas→UI.
2. **assistant-ui fue una gran elección**: `Sources`, `InlineCitation`, `ResearchReport` y `ToolFallback` son exactamente las piezas que un clon necesita, y el ejemplo visual de Perplexity acelera el diseño. A cambio, hay que asumir pre-1.0 y mapear las citas a mano.
3. **Tu intuición sobre Hermes era correcta**: es el único candidato con `web_search`/`web_extract` multi-backend, API OpenAI-compatible y una skill de citas verificables "Perplexity-style". opencode es más maduro como servidor, pero hay que des-sesgarlo de coding y construirle las citas.
4. **La brecha frente a Perplexity que jamás conviene intentar cerrar al principio**: índice/crawler propio, reranker afinado y sandbox multi-agente. Se puede empezar con SearXNG/Tavily + cross-encoder open source y sustituir piezas cuando la escala lo justifique.
5. **Diferenciación realista para un open source**: privacidad/auto-hospedaje, conectores MCP abiertos, BYO-modelo y API compatible — no competir en latencia ni en frescura del índice.
