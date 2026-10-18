# Perplexity AI — Funcionalidades completas (estado: octubre 2026)

> Documento de referencia para diseñar un clon open source tipo Perplexity.
> Fuentes: help center y blog oficial de Perplexity, `docs.perplexity.ai`, prensa tecnológica y análisis de terceros (enlazados a lo largo del texto).
> ⚠️ Cuotas, precios y modelos cambian con frecuencia: verificar contra las fuentes oficiales antes de tomar decisiones de producto.

---

## 1. Resumen ejecutivo

Perplexity nació como *answer engine* con citas, pero en 2025–2026 se transformó en una **plataforma de agentes** con cinco frentes:

1. **Búsqueda / respuesta** con citas, modos (Best, Pro Search, Reasoning, Research) y selector de modelos.
2. **Computer**: un "digital worker" multi-modelo con subagentes, memoria persistente, sandbox y cientos de conectores.
3. **Comet**: navegador agéntico (Chromium) en Mac/Windows/Android/iOS con "tabs as context".
4. **Verticales**: Finance, Shopping, Viajes, Discover.
5. **API Platform**: Agent API (sucesora de Sonar Chat Completions), Router, Search API, Embeddings y Decisions.

**Conclusión clave para un clon:** el foso competitivo **no son los LLM** (Perplexity usa modelos de terceros) sino la **recuperación, el ranking, el enlace de citas y la orquestación de agentes**. Ver [§9](#9-arquitectura-técnica-lo-que-se-sabe-públicamente).

Referencias: [cómo funciona](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work) · [blog Photon](https://www.perplexity.ai/hub/blog/photon) · [blog CobbleDB](https://www.perplexity.ai/hub/blog/cobbledb) · [docs.perplexity.ai](https://docs.perplexity.ai/llms.txt)

---

## 2. Experiencia de búsqueda núcleo

### 2.1 Flujo del *answer engine*

1. El LLM interpreta y reescribe la pregunta.
2. Se busca en web en tiempo real (índice propio + fuentes externas).
3. Se rankean y leen las fuentes relevantes.
4. Se sintetiza una respuesta conversacional con **citas numeradas inline** enlazadas a las fuentes.
5. Se mantiene contexto para preguntas de seguimiento.

Puede usarse sin registro; las búsquedas básicas del plan Free son "prácticamente ilimitadas".
Fuente: [How does Perplexity work](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work) · [What is an answer engine](https://www.perplexity.ai/help-center/en/articles/10354917-what-is-an-answer-engine-and-how-does-perplexity-work-as-one)

### 2.2 Citas, tarjetas de fuentes y etiquetas

- Cada afirmación lleva **citas inline**; la UI muestra tarjetas de fuente (título, dominio, fecha) y panel "Sources".
- Pro promete **10× más citas por respuesta** que Free.
- **Etiquetas de fuente (source labels)** con icono de escudo:
  - `Government` (ej. nasa.gov), `Academic` (ej. science.org), `Trusted` (ej. reuters.com).
  - Se asignan a **nivel de dominio completo**, con opción "Rate this source".
- Fuente: [Pro Search](https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search) · [source labels](https://www.perplexity.ai/help-center/en/articles/20260806-understanding-source-labels)

### 2.3 Modos de la barra de entrada

| Modo | Qué hace | Disponibilidad |
|---|---|---|
| **Best** (por defecto) | Elige automáticamente el mejor modelo; sin cuota | Todos |
| **Pro Search** | Búsqueda multi-paso, docenas de fuentes, intérprete de código, elección de modelo | Free limitado / Pro extendido |
| **Reasoning** | Modelos de razonamiento (Sonnet Thinking, o3-Pro/Opus en Max) | Pro / Max |
| **Research** (ex Deep Research) | Informe autónomo en 2–4 min | Free 1/mes; Pro/Max por cuota |
| **Create files and apps** (ex Labs) | Informes, hojas, dashboards, mini-apps | Pro/Max con cuota |
| **Computer** | Agente general multi-paso (consume créditos) | Pro/Max/Enterprise |
| **Learn step by step** | Tutoría guiada | Pro/Education |

Fuente: [¿Qué es Pro?](https://www.perplexity.ai/help-center/en/articles/10352901-what-is-perplexity-pro) · [changelog feb-2026](https://www.perplexity.ai/changelog/what-we-shipped---february-6th-2026)

### 2.4 Selector de modelos

Disponible para suscriptores. En la página Pro de 2026 aparecen (nombres de la época): **Sonar 2** (propio), **GPT-5.6 Terra/Sol**, **Gemini 3.8 Flash**, **Claude Sonnet 5 / 5.5**, **Claude Opus 5.5 (Max)**, **Kimi K3**, **GLM 5.3**, **Grok 4.7**. Free no tiene selector de modelo ni generación de imagen.
Fuente: [perplexity.ai/pro](https://www.perplexity.ai/pro) · [perplexity.ai/max](https://www.perplexity.ai/max)

### 2.5 Focus, fuentes y seguimiento

- **Choose sources / Focus**: Web, Academic, Finance, Files; en Enterprise: Web / Org Files / Web+Org Files / None.
- Preguntas de seguimiento con memoria de contexto, **related questions** generadas automáticamente y respuestas compartibles por enlace.
- **Discover** (feed comunitario) y **Library** (biblioteca personal).
- El bucle de herramientas real (estilo Copilot) está en Pro Search/Computer: el system prompt filtrado de la Agent API exige "llamar al menos una herramienta antes de responder" y limita a ~3 tool calls por turno en el preset por defecto, con citas inline estilo `[web:1]`.
- Fuentes: [IKS](https://www.perplexity.ai/help-center/en/articles/10352914-what-is-internal-knowledge-search) · [OpenAI compatibility (prompt filtrado)](https://docs.perplexity.ai/docs/agent-api/openai-compatibility)

---

## 3. Investigación, creación y automatización

### 3.1 Deep Research → Advanced Deep Research

- Lanzado el **14-feb-2025**: "docenas de búsquedas, cientos de fuentes", informe en **2–4 minutos**. Inicialmente Free 5/día y Pro 500/día ([blog](https://perplexity.ai/hub/blog/introducing-perplexity-deep-research)).
- **Advanced Deep Research** (2026): preguntas de aclaración previas, preguntas añadibles durante la investigación, progreso en vivo, informe que se transmite a un archivo editable y compartible, sandbox de datos y procesamiento de documentos subidos. Max usa Opus 4.6 Thinking; Pro, 4.5 Thinking gradualmente ([help](https://www.perplexity.ai/help-center/en/articles/13600190-what-s-new-in-advanced-deep-research)).
- Cuotas actuales oficiales: Free **1/mes**, Pro "límites mensuales (uso medio)", Enterprise Pro **50/mes**, Enterprise Max **500/mes** ([planes](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you)). En feb-2026 hubo recortes drásticos denunciados por usuarios.

### 3.2 Labs → "Create files and apps"

- **Labs** (29-may-2025): trabajo autosupervisado de ~10 min que produce informes, hojas de cálculo, dashboards, presentaciones y **mini web apps**; pestañas "Assets" (charts, CSV, código) y "App" ([blog Labs](https://perplexity.ai/hub/blog/introducing-perplexity-labs)).
- En feb-2026 se renombró a **Create files and apps** dentro del menú "+". Cuotas: Pro mensual, Enterprise Pro 50/mes, Enterprise Max 500/mes.

### 3.3 Pages

Permitía convertir hilos en artículos publicables con secciones, imágenes y fuentes editables. **Estado (jul-2026): "Create page" temporalmente retirado**; "Convert to Page" volverá con mejoras.
Fuente: [help Pages](https://www.perplexity.ai/help-center/en/articles/10352968-perplexity-pages)

### 3.4 Tasks y automatizaciones

Dos sistemas conviven:

1. **Perplexity Tasks** (antiguo): tareas recurrentes (resumen diario, alertas de precio), frecuencias una vez/diaria/semanal/mensual/anual, notificación in-app/email/SMS; también vía WhatsApp y Telegram.
2. **Scheduled Tasks en Computer**: lenguaje natural, cadencia mínima **1/hora**, dashboard de Automations, tareas background (agente aislado) o attended (con documentos), uso de conectores; cada ejecución consume créditos. En sep-2026 se añadieron **Automations con disparadores por eventos**.

Fuentes: [Tasks](https://www.perplexity.ai/help-center/en/articles/11521526-perplexity-tasks) · [borrar tareas](https://www.perplexity.ai/help-center/en/articles/20260710-how-to-delete-scheduled-tasks-perplexity-tasks-vs-computer-scheduled-tasks)

---

## 4. Model Council (consejo multi-modelo)

- **Lanzado el 5-feb-2026**: lanza la consulta en **3 modelos frontera en paralelo** y un modelo sintetizador ("chair") que produce una respuesta única mostrando acuerdos, desacuerdos y aportes únicos. Inicialmente solo web y solo Max.
- **Expansión jul-2026**: llega a Computer con **2–8 modelos** (frontera y open-weight), profundidad configurable y orquestador elegible; disponible para Max, Pro y enterprise. El resultado puede convertirse en informes/decks.
- Implementación observada: una *skill* que lanza subagentes paralelos y espera a que todos terminen; el modelo elegido hace de "chair".

Fuentes: [blog](https://www.perplexity.ai/hub/blog/introducing-model-council) · [help](https://www.perplexity.ai/help-center/en/articles/13641704-what-is-model-council.html) · [The Register](https://www.theregister.com/ai-and-ml/2026/07/28/perplexitys-tokenmaxxing-model-council-gives-you-multiple-bot-perspectives/5279972)

---

## 5. Gestión del conocimiento

### 5.1 Spaces → Projects (jul-2026)

Los Spaces migraron automáticamente a **Projects**: hubs con:

- **Sistema de archivos persistente compartido**.
- **Brain**: memoria que aprende entre tareas.
- Instrucciones por proyecto, modelo/modo por defecto, conectores con credenciales individuales.
- Canales de Slack/Teams con `/project`, roles Owner / Can edit / Can view.

Límites por Project: **5.000 archivos, 2,5 GB totales, 100 MB/archivo**, cualquier tipo de archivo.
Fuente: [blog Projects](https://www.perplexity.ai/hub/blog/spaces-are-now-projects) · [help](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-projects)

### 5.2 Subida de archivos

- En sesiones: hasta **10 archivos por hilo**, borrados a los 7 días; PDF, CSV, DOCX, PPTX, XLSX, audio, vídeo, imágenes.
- En Projects: persistente (límites arriba; 50 MB/archivo en repositorio de organización).

### 5.3 Conectores e integraciones

Catálogo (Pro y Enterprise): **Google Drive, Gmail/Calendar, Notion, Slack, SharePoint/OneDrive, Teams, Outlook, Jira, Confluence, Asana, Linear, GitHub, Box, Dropbox, HubSpot, Snowflake, Databricks…**

- **Standard Search**: consulta en vivo en cada query. **Importar a Project**: copia estática (requiere reimportar para actualizar).
- **High-Precision Search**: análisis profundo, solo Enterprise.
- Soporta **MCP local y remoto** y conectores personalizados vía MCP.
- Computer habla de **400+ aplicaciones** conectadas.

Fuentes: [conectores](https://www.perplexity.ai/help-center/en/collections/18799295-connectors-integrations) · [file connectors Enterprise](https://www.perplexity.ai/help-center/en/articles/10672063-introduction-to-file-connectors-for-enterprise-organizations) · [docs Agent API connectors](https://docs.perplexity.ai/docs/agent-api/tools/connectors)

### 5.4 Internal Knowledge Search (Enterprise)

Indexa repositorios internos (SharePoint, Drive, Notion, Confluence) junto a la web; el usuario elige Web / Org Files / Web+Org Files / None y las respuestas citan archivos internos. Nota: el "Organization File Repository" se retira el **1-oct-2026** en favor de Projects + conectores.
Fuente: [IKS](https://www.perplexity.ai/help-center/en/articles/10352914-what-is-internal-knowledge-search)

### 5.5 Memoria y personalización

- **Memoria personal**: ocupación, instrucciones personalizadas, formato de respuesta, referencia al historial. Mejora reportada en 2026 (~95% de acierto del detalle relevante).
- **Brain** (jun-2026, Research Preview para Max/Enterprise): memoria auto-mejorable de Computer; registra conectores, fuentes, ediciones y errores en un grafo, actualiza un "wiki" nocturno y lo recarga por tarea. Métricas declaradas: +25% precisión en tareas repetitivas, +16% recall, −13% coste.

Fuentes: [help Max](https://www.perplexity.ai/help-center/en/articles/11680686-perplexity-max) · [DigitalToday](https://www.digitaltoday.co.kr/en/view/69025/perplexity-launches-brain-memory-system-for-ai-agent-computer)

### 5.6 Compartir

Enlaces públicos de hilos, Projects compartidos con roles, lista de Projects a nivel organización y "fork" de hilos compartidos sin heredar memoria/conectores privados del autor.

---

## 6. Agentes y acciones

### 6.1 Asistente móvil

- **Android** (23-ene-2025): asistente por defecto del sistema: voz, preguntas, acciones (reservar, pedir transporte, recordatorios), 15 idiomas.
- **iOS**: app nativa con voice mode; Comet iOS (18-mar-2026) integra assistant, voz, Deep Research y continuidad de hilos.

Fuentes: [Reuters](https://www.reuters.com/technology/artificial-intelligence/perplexity-debuts-ai-assistant-android-challenge-alexa-chatgpt-2025-01-23) · [blog Comet iOS](https://www.perplexity.ai/hub/blog/meet-comet-for-ios)

### 6.2 Comet (navegador agéntico)

- Cronología: desktop Mac/Windows (9-jul-2025, solo Max) → **gratis para todos (2-oct-2025)** → Android (20-nov-2025) → iOS (18-mar-2026). Base Chromium/Blink.
- **Tabs as context**: el Assistant lee las pestañas abiertas, se mencionan con "@" y resume varias.
- Panel lateral, inline assistant, ad blocker con whitelist, importación de extensiones/bookmarks, historial local cifrado E2E, memoria persistente.
- **Voice Mode** con GPT Realtime (feb-2026): conciencia de pantalla, navegación por voz.
- **Search mode vs Work mode**: Search no consume créditos; Work ejecuta Computer y sí.
- **Background Assistants** (2-oct-2025): tareas agénticas en paralelo.
- **Email Assistant** (Max): Gmail/Outlook, redacta con tu tono, agenda y resume.
- **Comet Plus** ($5/mes, incluido en Pro/Max): contenido de editores asociados (CNN, Condé Nast, WaPo, LA Times, Fortune, Le Monde…).

Fuentes: [Wikipedia Comet](https://en.wikipedia.org/wiki/Comet_%28browser%29) · [blog Android](https://www.perplexity.ai/hub/blog/comet-for-android-is-here) · [blog Email Assistant](https://www.perplexity.ai/hub/blog/a-personal-assistant-for-your-inbox)

### 6.3 Computer / Personal / Portable

- **Computer** (25-feb-2026): "digital worker" que descompone instrucciones, ejecuta **subagentes en paralelo en entornos aislados** (**SPACE sandbox**: red confinada y aislamiento de VM, ver [research](https://research.perplexity.ai/)), navega, opera archivos, llama APIs y usa conectores; routing sobre ~20 modelos especializados; puede correr horas o meses con memoria persistente. Slack y email (`computer@perplexity.com`). **Computer for Enterprise** conecta 400+ apps y añade "Wide Research".
- **Cobro por créditos**: 100 créditos = $1; tareas ligeras 100–350, complejas 350–950, pesadas 875–2.275, "mega" 2.400–9.800. Max incluye 10.000/mes; Pro no incluye asignación mensual.
- **Skills** (ex Workflows, retirados sep-2026): instrucciones reutilizables con `SKILL.md`, activadas por descripción, con biblioteca propia y personal.
- **Personal Computer**: Mac (11-mar-2026, GA 7-may-2026) y Windows (4-ago-2026): edita archivos locales, usa apps nativas, navega con Comet, orquestación por voz, acceso remoto desde iPhone.
- **Portable Computer** (local-first): DGX Spark, Windows RTX ≥24 GB VRAM, AMD Ryzen AI Max; modelo local + harness + scheduler en el dispositivo, **no consume créditos**, escala a la nube con permiso. Soporta MCP local.

Fuentes: [help Credits](https://www.perplexity.ai/help-center/en/articles/13838041-how-credits-work-on-perplexity) · [help Skills](https://www.perplexity.ai/help-center/en/articles/13914413-how-to-use-computer-skills) · [help Computer Enterprise](https://www.perplexity.ai/help-center/en/articles/13901210-computer-for-enterprise) · [TechCrunch Personal Computer](https://techcrunch.com/2026/05/07/perplexitys-personal-computer-is-now-available-everyone-on-mac) · [blog Portable Windows](https://www.perplexity.ai/hub/blog/portable-computer-for-windows-is-here)

### 6.4 Shopping

- **Buy with Pro** (nov-2024): checkout de un clic con datos guardados.
- Alianza con **PayPal** (may-2025) y relanzamiento de compra (25-nov-2025) en EE. UU.: checkout PayPal/Venmo dentro del chat, catálogos en tiempo real, **Instant Buy**.
- Descubrimiento con tarjetas de producto (imagen, precio, valoraciones), memoria de preferencias y comparación con citas; programa de comerciantes.

Fuentes: [PayPal nov-2025](https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy) · [blog shopping](https://perplexity.ai/hub/blog/shopping-that-puts-you-first)

### 6.5 Viajes

- **Hoteles**: reserva dentro de Perplexity con **Selfbook** (pagos) y datos de **Tripadvisor** desde mar-2025.
- **Restaurantes**: disponibilidad vía OpenTable/Resy/Yelp; mapas en web e iOS.
- **No hay vuelos nativos**: se delega en Comet/agente. Ventajas Pro en EE. UU.: descuentos en reservas Selfbook/Viator.

### 6.6 Finance, Personal CFO y Discover

- **Finance**: páginas por ticker con pestañas Overview, Financials, Earnings, Holders, Historical Data, Analysis; transcripciones y audio de earnings; insiders/políticos; deep-links al documento SEC exacto. Proveedores: Financial Modeling Prep, Unusual Whales, Quartr, Fiscal.ai, S&P Global, Polymarket, TradingView…
- **Personal CFO** (abr-2026): conexión bancaria vía **Plaid**, seguimiento de gasto, presupuestos y patrimonio (EE. UU./Canadá).
- **Discover**: feed de hilos compartidos; **Library** como curación personal.

Fuentes: [perplexity.ai/finance](https://www.perplexity.ai/finance/MD/earnings?tab=transcript) · [changelog abr-2026](https://www.perplexity.ai/changelog/personal-computer-on-mac-launch-and-computer-updates---april-17-2026)

---

## 7. API Platform

La API se reorganizó en torno a la **Agent API** (sucesora de Sonar Chat Completions), más Router, Search, Embeddings y Decisions.
Índice completo: [docs.perplexity.ai/llms.txt](https://docs.perplexity.ai/llms.txt)

### 7.1 Agent API

- Endpoint canónico **`POST /v1/agent`**; alias **`POST /v1/responses`** (compatible con `client.responses.create()` de OpenAI cambiando `base_url` a `https://api.perplexity.ai/v1`).
- **Presets**: `fast` (1 web_search), `low` (+ fetch_url), `medium` (2+2), `high` (3+3), `xhigh` (+ sandbox).
- **Herramientas integradas y precio por invocación**: `web_search` ($0.0025), `image_search` ($0.0025), `fetch_url` ($0.0005), `people_search` ($0.005), `finance_search` ($0.005), **sandbox** ($0.03/sesión ≤20 min + $0.0025/búsqueda), MCP remoto, conectores gestionados (`connector_github`, `connector_slack`, `connector_googledrive`, `connector_datadog`, `connector_linear`, `connector_notion`).
- Capacidades: streaming, salida estructurada (JSON schema), estado de conversación, adjuntos de imagen, **background mode** (async con polling/cancelación), gestión de archivos, **Skills** (zip con `SKILL.md`) y **Profiles** versionados.
- Modelos del catálogo: Claude Opus 5.5 ($4/$20 por 1M tokens), Claude Sonnet 5.5 ($2/$10), GPT-6.1 Sol, GPT-6 Luna ($0.10–0.20/$0.50–0.75), Gemini 3.8 Flash, Grok 4.7, Kimi K3, GLM 5.3, Nemotron 3 Ultra 550B, `perplexity/sonar` ($0.25/$2.50).
- **Migración**: el Sonar Chat Completions deja de aceptar carga nueva el **27-sep-2026**; mapeo oficial Sonar→`fast`, Sonar Pro→`low`, Sonar Reasoning Pro→`medium`, Sonar Deep Research→`high`.

Fuentes: [OpenAI compatibility](https://docs.perplexity.ai/docs/agent-api/openai-compatibility) · [pricing](https://docs.perplexity.ai/getting-started/pricing) · [Sonar retirement](https://docs.perplexity.ai/docs/sonar/models/sonar)

### 7.2 Router API

Acceso unificado a modelos open-weight y de terceros mediante OpenAI Chat Completions, OpenAI Responses y Anthropic Messages con la misma API key; failover automático y precio transparente. Endpoints: `/chat/completions`, `/responses`, `/messages`, `/models`.

### 7.3 Search API

`POST /search` devuelve resultados web estructurados y rankeados:

- `max_results` 1–20 (def. 10), hasta 5 consultas por request, `country`, filtros de fecha/idioma.
- `search_domain_filter` allowlist/denylist (máx. 20 dominios, con paths).
- `search_context_size` low/medium/high; `search_type: "fast"` para baja latencia.
- Precio: **$5/1K requests** estándar, **$1/1K** fast; sin coste por token.

Fuente: [Search quickstart](https://docs.perplexity.ai/docs/search/quickstart)

### 7.4 Embeddings y Decisions

- **Embeddings**: `pplx-embed-v1-0.6b` (1024 dims, $0.004/1M), `-4b` (2560 dims, $0.03/1M); contextualizados `pplx-embed-context-v1-*`.
- **Decisions API**: respuestas probabilísticas (sí/no, opción múltiple, score) con `pplx-decider-v1-27b` a $0.04/1M tokens de entrada.

### 7.5 Rate limits y ecosistema

| API | Límite |
|---|---|
| Agent API | 1 QPS (T0) → 33 QPS (T4/T5), ventana 1 s por organización |
| Search API | 50 query units/s, burst 50 |
| Embeddings | 85–335 QPS según tier |
| Tiers | por compra acumulada: $0, $50, $250, $500, $1.000, $5.000 |

SDKs oficiales Python y TypeScript, CLI `pplx`, MCP Server de la API y Computer MCP Server; integraciones con LangChain/LangGraph, Vercel AI SDK, LiteLLM, n8n, Cursor, Claude Code, **OpenCode**, etc.
Fuente: [rate limits](https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers)

---

## 8. Planes y precios (oct-2026)

| Plan | Precio | Incluye (resumen) |
|---|---|---|
| **Free** | $0 | Búsquedas básicas casi ilimitadas; 3 Pro Searches/día; 1 Research/mes; sin modelos avanzados ni creación de archivos |
| **Pro** | $20/mes ($200/año) | Pro Search con límites semanales, Research mensual, modelos avanzados, imagen/vídeo limitado, ~$5/mes de créditos Sonar API (promo), 4.000 créditos bonus de Computer, Comet Plus |
| **Education Pro** | $10/mes | Todo Pro + Learn Mode |
| **Max** | $200/mes | Límites altos, 10.000 créditos/mes + 35.000 bonus, Model Council, Brain, Max Assistant, acceso temprano |
| **Enterprise Pro** | $40/asiento/mes | SSO, privacidad estricta, conectores gobernados, Projects; 400 Pro-search/sem, 50 Research/mes, 80 agente/mes |
| **Enterprise Max** | $325/asiento/mes | + SCIM, audit logs, retención configurable, Insights; 4.000 Pro-search/sem, 500 Research/mes, 800 agente/mes |

**Créditos**: 100 = $1; consumo bonus → mensuales → comprados; auto-recarga configurable.
Fuente: [planes](https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you)

---

## 9. Arquitectura técnica (lo que se sabe públicamente)

### 9.1 Pipeline

```
query → rewrite/expansión → recuperación híbrida (BM25 + densa)
      → fetch URLs → ranking multietapa (filtro → cross-encoder → reranker pesado)
      → generación con citas unidas ANTES de generar → respuesta + source cards
```

La cita **no es un post-proceso del LLM**: se ata a las fuentes recuperadas. El system prompt filtrado confirma reglas de producción (citas `[web:1]`, máx. 5 secciones, sin meta-comentario del proceso).

### 9.2 Stack propio

- **Photon** (sep-2026): motor de recuperación y ranking construido desde cero.
- **CobbleDB** (sep-2026): almacén clave-valor sobre RocksDB + Pillar (YTsaurus) + Lorry; ~5× menos latencia de lecturas por lote y ≥20% de ahorro frente a DynamoDB; cada request de Search API toca 100–120 claves de ~50 KB.
- Crawling/indexado/ranking propios, embeddings propios (`pplx-embed-*`), inferencia propia.
- **Q2D-Web**: benchmark de recuperación con 70.000 consultas de agente y 190M documentos web.
- **SPACE sandbox**: aislamiento de VM y confinamiento de red para agentes, con red-teaming público.
- Crawlers documentados: PerplexityBot y user agents.

Fuentes: [blog Photon](https://www.perplexity.ai/hub/blog/photon) · [blog CobbleDB](https://www.perplexity.ai/hub/blog/cobbledb) · [research](https://research.perplexity.ai/) · [crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)

### 9.3 Cifras de terceros (no oficiales)

Un análisis de marzo-2026 atribuye: >200.000M URLs indexadas, 400 PB de almacenamiento caliente, ~358 ms de latencia mediana (p95 <800 ms), 93,9% en SimpleQA para Deep Research y ~37% de fallo de citas (el mejor entre motores de IA según Columbia Tow Center). Oficial: la compañía declara >1.500M preguntas/mes.

---

## 10. Panorama open source y brechas

| Proyecto | Fortalezas | Qué le falta vs Perplexity |
|---|---|---|
| **Vane (ex-Perplexica)** MIT | El clon más popular: SearXNG + Ollama/nube, modos, 6 focus modes, subida de archivos, Docker | Sin índice/crawler propio, sin reranking de producción, sin agente/navegador, sin conectores, sin Research con sandbox, sin Council |
| **Morphic** Apache-2.0 | UI generativa pulida (Next.js, Vercel AI SDK), streaming de componentes | Sin memoria persistente real, sin agentes largos, sin conectores, sin API compatible |
| **Khoj** AGPL | Asistente web+docs, escritorio, RAG personal auto-hospedado | No es answer engine web-first con citas top |
| **Onyx (ex-Danswer)** MIT | Búsqueda empresarial sobre documentos, conectores, self-hosted | Sin web abierta, sin modos de investigación, sin navegador |
| **SearXNG** AGPL | Backbone de búsqueda privada (metabuscador) | Sin síntesis, citas ni agentes |
| **OpenPerplex / Farfalle / Fireplexity** | Clones parciales | Muy incompletos |

**Brechas comunes**: (1) índice web propio y reranker afinado; (2) citation binding estricto; (3) Deep Research asíncrono con sandbox; (4) computer-use; (5) conectores gestionados con permisos; (6) memoria tipo Brain; (7) API OpenAI/Anthropic-compatible con presets; (8) verticales; (9) economía de créditos; (10) apps móviles y extensión de navegador.

---

## 11. Implicaciones para el clon (prioridades)

1. **MVP**: rewrite de query + recuperación híbrida (SearXNG/Tavily/Brave + BM25+vectores) + cross-encoder rerank + generación con citas `[n]` y tarjetas de fuente + streaming.
2. **Diferenciadores baratos**: focus modes (académico/finanzas/Reddit), subida de archivos con RAG temporal, hilos compartibles, related questions, selector multi-proveedor.
3. **Research**: descomposición → subconsultas → lectura → informe Markdown con progreso en vivo + sandbox opcional (E2B/Deno) + export.
4. **Conocimiento**: Projects/Espacios con archivos persistentes + conectores MCP + memoria por proyecto.
5. **Agentes**: orquestador con herramientas, tareas programadas, modo background y sandbox aislado.
6. **Multi-modelo (Council)**: N modelos en paralelo + sintetizador "acuerdos/desacuerdos" (caro pero replicable).
7. **API**: endpoint OpenAI-compatible + Search API + presets.
8. **Costes**: medir coste por query desde el día 1.
