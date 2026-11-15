# NexBots

Bots agénticos con identidad, entorno, archivos y estado propios. Estado a 2026-11-09.

## 1. Identidad y skills

La configuración actual está descrita en [Skills y Nexbots](skills.md). Los antiguos perfiles de Agentes se han retirado: cada Nexbot guarda su configuración de ejecución y sus skills asignadas. El ordenador es opcional; los bots sin entorno pueden conversar, participar en salas y ejecutar rutinas.

Las skills son procedimientos portables, independientes del modelo, la identidad y los permisos. El formato y la carga progresiva se centralizan en nas-adk. Nexus gestiona biblioteca, borradores, versiones y galería.

Las secciones siguientes documentan el diseño del entorno aislado y sus antecedentes.

## 2. El referente: «grokbots»

«grokbots» no es un nombre oficial. El candidato creíble es **Grok Bot** de xAI (beta desde 2026-08-11). Las listas comunitarias `awesome-grokbot` y `pftq/GrokBot` solo aparecieron como resultados de búsqueda y no se pudo confirmar relación.

| Lo que se suponía | Veredicto | Evidencia |
|---|---|---|
| Entorno independiente por bot | **Falso, documentado** | Una microVM Firecracker por usuario, «every Bot shares that computer», «do not use separate Bots as a security boundary» ([security-faq](https://docs.x.ai/grok-bot/security-faq), [faq](https://docs.x.ai/grok-bot/faq)). Excepción: un bot compartido en Slack tiene ordenador propio ([teams](https://docs.x.ai/grok-bot/teams-and-enterprises)) |
| Directorios propios | **Falso en el ordenador, documentado** | `/workspace` y los logins se comparten; solo los adjuntos son por bot ([bots](https://docs.x.ai/grok-bot/bots), [computer](https://docs.x.ai/grok-bot/computer-and-apps)) |
| Configuración, memoria y estado | **Documentado** | Memoria, conversaciones, rutinas y perfil por bot. El almacenamiento interno no es público |
| Herramientas autónomas | **Documentado** | Navegador, terminal, archivos, MCP, rutinas ([overview](https://docs.x.ai/grok-bot/overview)) |
| Computer use | **Documentado** | Pantalla propia, una tarea por bot a la vez, se detiene ante SSO o CAPTCHA ([how it works](https://docs.x.ai/grok-bot/how-grok-bot-works)) |

El anuncio de xAI dice que cada bot tiene «their own computer», pero su documentación aclara que es compartido. `x.ai/bot` devolvió 403, y las páginas de xAI se leyeron mediante un extractor intermedio: conviene cotejar las citas exactas.

**Consecuencia:** un NexBot aísla más que el referente. Para aislamiento por bot, lo comparable son [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/environments) y [OpenClaw con sandbox](https://docs.openclaw.ai/gateway/sandboxing). De Grok Bot se toman comportamientos: trabajo con el cliente cerrado, memoria inspeccionable, una tarea de navegador a la vez, traspaso a una persona ante un login y aprobaciones por acción.

## 3. Arquitectura

```
Navegador → BFF Next (/api/bots/*, auth, BD)
              │ HTTP firmado (HMAC)
              ▼
          sandboxd ──► docker-socket-proxy ──► Docker
              │ conectado a la red de cada bot
   ┌──────────▼──────────┐          ┌──────────────────────┐
   │ red interna bot A   │          │ red interna bot B    │
   │  botd + Chromium    │          │  botd + Chromium     │
   │  volumen A: /bot    │          │  volumen B: /bot     │
   └──────────┬──────────┘          └──────────┬───────────┘
              └────────► proxy de salida ◄─────┘
                         (rechaza destinos privados) ──► internet

Sidecar nas-adk (bucle del modelo y claves) ──MCP──► botd
```

**Decisión principal: las manos dentro, el cerebro fuera.** El bucle del modelo y las claves siguen en el sidecar. El bot solo expone herramientas por MCP, así que una página maliciosa no encuentra ninguna clave que robar. Además se reutilizan runs, AG-UI, política, aprobaciones y auditoría.

### Alternativas evaluadas

| Opción | Aislamiento | Coste | Veredicto |
|---|---|---|---|
| **Contenedor + volumen + red por bot** | Bueno; kernel compartido | ~950 MB de imagen compartida | **Elegida**: encaja con `sandboxd` y Docker ya presentes |
| Un contenedor con carpetas por bot | Solo convención | Mínimo | Descartada: es lo que xAI advierte que no es una frontera |
| Contenedor nuevo por tarea | Muy bueno entre tareas | Arranque por tarea; sin sesión viva | Descartada: el bot debe tener continuidad |
| gVisor (`runsc`) | Mejor: kernel en espacio de usuario | Instalar en el host; compatibilidad con Chromium por verificar | Siguiente paso; hoy Docker solo tiene `runc` |
| microVM (Firecracker, Kata) | El mejor | Operación mucho mayor | Si los bots fueran multiusuario hostil |

### Qué vive dónde

| Lugar | Contenido |
|---|---|
| **Base de datos** | Identidad, configuración, estado deseado y conocido, skills asignadas, registro de tareas (sin secretos) |
| **Volumen `/bot`** | `workspace/` (artifacts, downloads, uploads, memory), `state/tasks/` (journal, eventos, trazas, capturas de fallo), `browser/storage-state.json` (solo si se autoriza), `deps/` (pip y npm), `logs/` |
| **Efímero** | `/tmp`, `/dev/shm`, procesos, RAM y pestañas del navegador, sistema de ficheros raíz (solo lectura) |
| **En ningún sitio persistente** | Valores de pasos `secret: true`: solo en memoria durante la tarea |

**Persistir no es reanudar.** Tras un reinicio se conservan los archivos y se sabe qué tarea estaba en marcha, pero la página, el DOM y los procesos ya no existen. Por eso las tareas en curso pasan a `interrupted` y no se reanudan solas. Las que aún estaban en cola sí se ejecutan, salvo si llevaban un secreto, que ya no existe.

### Otras decisiones

- **Concurrencia:** una tarea por bot, en cola FIFO, porque comparten navegador. Las herramientas MCP reciben «ocupado» si hay una tarea activa. La concurrencia real se obtiene con más bots.
- **Límites:** memoria sin swap, CPU, 512 PIDs, `/tmp` de 512 MB, tiempo máximo por tarea, cupo de bots por cuenta y de bots en marcha. Disco: cuota **blanda** (ver límites).
- **Recuperación:** el bot se reconstruye desde imagen + volumen. Si cambia la configuración o la imagen, el contenedor se recrea y el volumen no. Al arrancar la app se levantan los bots con `desired_state = running`.
- **Comunicación:** BFF → `sandboxd` con HMAC, y `sandboxd`/sidecar → bot con un token por bot derivado (`HMAC(secreto, id)`). Conocer un token no permite calcular otro.

## 4. Navegador y computer use

Son capacidades **distintas**.

| | Navegador estructurado | Escritorio virtual |
|---|---|---|
| Actúa sobre | Páginas de un navegador (DOM, accesibilidad) | Toda la pantalla, por píxeles |
| Exige del modelo | Solo tool calling; válido también para modelos locales | Visión y tool calling |
| Modelos | Cualquiera con herramientas (no probado aquí con modelos reales) | [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) (según versión), [OpenAI](https://developers.openai.com/api/docs/guides/tools-computer-use), [Gemini](https://aistudio.google.com/docs/computer-use). La suscripción Claude Code en Linux [no lo ofrece](https://code.claude.com/docs/en/computer-use) |

Se empezó por el navegador porque es la única opción que sirve con BYOK, modelos locales y suscripción.

### Escritorio y visor

Cada bot con `desktop: true` (por defecto) tiene una pantalla virtual Xvfb de 1280×800 con openbox, y Chromium se abre en ella con su ventana completa.

- **Visor:** en `/bots/<id>` se ve la pantalla en directo, por MJPEG a 1, 2 o 5 fps. Lo recorre Next → `sandboxd` → bot, autenticado en cada salto, y solo el dueño del bot puede verlo.
- **Solo lectura por diseño:** es una imagen que se actualiza. No existe ninguna ruta para enviar clics o teclas desde el visor.
- **Acciones por píxeles:** pasos `desktop_click`, `desktop_type`, `desktop_key`, `desktop_scroll` y `desktop_screenshot` en planes deterministas, y computer use con un modelo (abajo).
- **Límites de uso:** máximo 4 espectadores por bot; cada emisión se corta a los 30 min para volver a comprobar el permiso; se corta sola si la pestaña no está visible.
- **Sin pantalla:** si Xvfb no arranca, o con `desktop: false`, el bot sigue funcionando en headless e informa del motivo.
- **Coste:** la imagen pasa de 952 MB a 1,51 GB. Un bot con el navegador abierto consumió unos 350 MB de RAM en reposo.

### Computer use con un modelo

Tarea `kind: "computer"` (botón «Ordenador» en `/bots/<id>`). El bucle del modelo sigue en el sidecar; cada acción se ejecuta en el bot y devuelve la pantalla resultante, que el modelo recibe como imagen.

**Alcance: solo el contenedor del bot.**

| Vía de salida posible | Control |
|---|---|
| Herramientas que corren fuera del bot (`web_search`, `web_fetch`, memoria, conocimiento) | Un run de ordenador no las recibe, tenga lo que tenga el perfil |
| Conectores del perfil | No se conectan. El sidecar solo acepta el endpoint `nexus-bot-<id>` y le impone la lista de herramientas |
| Terminal y DOM del bot | `shell_exec` y `browser_*` no se ofrecen; solo `desktop_*` y `workspace_*` |
| Otro bot o el host | El control va solo por el MCP de su bot; X11 no escucha por TCP y la pantalla vive en el contenedor |
| Ficheros y páginas internas desde el navegador | Política de Chromium: `file://`, `chrome://`, `devtools://` y `view-source:` bloqueados, también escritos a mano en la barra |
| Programas desde el escritorio | Openbox sin menús ni atajos; la imagen no incluye terminal gráfica |
| Teclas o coordenadas maliciosas | `xdotool` sin shell, teclas validadas, coordenadas dentro de la pantalla |

**Internet.** Confinar el control no corta la navegación: con `network: "restricted"` Chromium sale a webs públicas por el proxy, y un modelo engañado por una página puede enviar lo que vea a esa web. Con `network: "none"` no hay ninguna salida. No existe todavía una lista de dominios por bot.

**Sin aprobación por clic.** Pedir permiso en cada acción haría inviable la tarea. La lanza una persona, que la observa en el visor y puede pararla; cada acción queda auditada y la tarea tiene un máximo de pasos (30 por defecto, 60 como mucho). Solo una tarea de ordenador a la vez por bot.

**Modelos.** Vale cualquier modelo con visión y herramientas por API: Anthropic nativo u OpenAI-compatible. **La suscripción de Claude Code no sirve**, porque su integración no pasa imágenes. Se usan herramientas propias con imágenes en sus resultados, no el `computer_toolset` nativo de Anthropic: es un único camino para todos los proveedores, a cambio de que Claude no use la herramienta para la que está entrenado.

**Coste.** Las capturas se conservan durante toda la tarea y se reenvían en cada llamada (aproximadamente 1.400 tokens de entrada por captura en Claude). No se recortan porque editar turnos anteriores invalida el razonamiento conservado de los modelos actuales. Es la razón del tope de pasos.

Tampoco hay toma de control manual.

**El visor también muestra lo que el bot escribe.** `secret: true` evita que un valor se guarde en el journal y los logs, pero un campo que no sea de contraseña lo enseña en pantalla mientras dure en ella.

Otras capacidades: una sesión por bot, `storage_state` opcional, capturas, trazas de Playwright (`trace: true`), descargas y subidas en el workspace.

Se usa `storage_state` en vez de un perfil de Chromium porque conserva también las cookies de sesión y no sufre bloqueos de perfil al recrear el contenedor.

## 5. Seguridad

| Control | Cómo | Probado en e2e |
|---|---|---|
| Archivos y secretos de otro bot | Volumen propio; sin montajes compartidos | Sí |
| Host y servicios internos | Red `internal` por bot, **sin IP en el puente** | Sí, barrido de la subred |
| Salida a internet | Solo por el proxy, que decide con la IP ya resuelta y solo admite 80/443 | Sí |
| Socket de Docker | Nunca en el bot; `sandboxd` usa un proxy sin `exec` ni imágenes | Sí |
| Secretos | Ni en imagen, ni repo, ni logs; las claves del modelo no entran en el bot | Sí |
| Privilegios | Sin root, sin capabilities, `no-new-privileges`, raíz de solo lectura | Sí |
| Rutas | Resueltas contra enlaces simbólicos; solo `http(s)` en el navegador | Sí |
| Aprobación | Paso `approve` en planes. En runs con modelo, la política pide aprobar `navigate`, `click`, `type`, `press` y `shell_exec` | Planes sí; con modelo, solo pruebas unitarias |
| Parada | Cancelar tarea (mata el grupo de procesos) y parar bot | Sí |
| Artefactos no confiables | Se descargan siempre como adjunto, nunca se renderizan | Parcial |

Se encontró y corrigió un fallo real durante las pruebas: una red `internal` de Docker **todavía deja llegar al host por la IP del gateway** (el bot alcanzaba el SSH del NAS). De ahí `com.docker.network.bridge.inhibit_ipv4`.

### Límites reales del aislamiento

Un contenedor no es una frontera absoluta.

- **Kernel compartido.** Una vulnerabilidad del kernel rompe el aislamiento.
- **Chromium corre con `--no-sandbox`**: su sandbox necesita user namespaces, que el host restringe con AppArmor. No se ha probado un perfil seccomp propio que lo active. Un exploit del renderer obtiene el contenedor entero de ese bot, pero no los demás.
- **`sandboxd` y su proxy son equivalentes a root en el host si se comprometen:** poder crear contenedores permite montar el disco. Solo los protege la firma HMAC y que no estén publicados.
- **El bot alcanza a `sandboxd` y al sidecar en su propia red.** Exigen autenticación, pero son superficie de ataque.
- **La inyección de instrucciones no está resuelta.** Se mitiga con la falta de claves, las aprobaciones y la red. Sin allowlist por bot, un bot engañado puede filtrar a cualquier web pública lo que tenga en su workspace.
- **El proxy no descifra TLS:** ve destinos, no contenidos.
- **La cuota de disco es blanda.** Se comprueba al empezar la tarea y al escribir, pero un comando puede llenar el disco del host mientras corre: el driver `local` no impone tamaño.
- **El estado que informa el bot no es confiable.** Un bot comprometido puede falsear su journal; el BFF lo acota pero no lo verifica.
- **Sesiones autorizadas:** cookies en claro en el volumen, y las trazas pueden contener datos sensibles. Conviene usar cuentas de bajo privilegio por bot.

## 6. Fases

1. **Hecho: recorrido vertical.** Identidad, entorno, tareas, navegador, artefactos, ciclo de vida, aislamiento.
2. **Hecho:** interfaz `/bots`, escritorio virtual y visor en directo.
3. **Hecho:** computer use confinado al contenedor, con cualquier modelo con visión por API.
4. **Siguiente:** prueba con un modelo real, allowlist de dominios por bot en el proxy y herramienta nativa de Anthropic si la precisión lo pide.
5. **Después:** toma de control, bóveda de credenciales, delegación entre bots, gVisor y cuota dura de disco.

## 7. Uso

### Desplegar

Esto modifica el stack en marcha: revísalo antes de ejecutarlo.

```bash
# En .env
NEXUS_SANDBOXD_URL=http://sandboxd:8095

docker compose --profile build-only build nexbot-image
docker compose --profile computer up -d --build
```

La migración se aplica al arrancar la app. Requiere el perfil `computer`, y el permiso «NexBots» está activo salvo que un admin lo retire.

### Crear, usar y detener

```bash
APP=http://localhost:3000
curl -c c.txt -H 'content-type: application/json' $APP/api/auth/login \
  -d '{"email":"tu@correo","password":"..."}'

# Crear (persistBrowser autoriza a conservar cookies)
ID=$(curl -sb c.txt -H 'content-type: application/json' $APP/api/bots \
  -d '{"name":"Investigador","config":{"persistBrowser":true}}' | jq -r .bot.id)

# Arrancar
curl -sb c.txt -H 'content-type: application/json' $APP/api/bots/$ID/lifecycle -d '{"action":"start"}'

# Tarea determinista
curl -sb c.txt -H 'content-type: application/json' $APP/api/bots/$ID/tasks -d '{
  "kind":"plan","steps":[
    {"action":"goto","url":"https://example.com/"},
    {"action":"extract","selector":"body","save_as":"texto"},
    {"action":"write_file","path":"artifacts/pagina.txt","content":"{{texto}}"}]}'

# Tarea con un modelo (requiere un perfil asignado con "agentIds" y el permiso de rutinas)
curl -sb c.txt -H 'content-type: application/json' $APP/api/bots/$ID/tasks \
  -d '{"kind":"agent","prompt":"Resume example.com en artifacts/resumen.md"}'

curl -sb c.txt $APP/api/bots/$ID/tasks                                  # estado
curl -sb c.txt "$APP/api/bots/$ID/files?path=artifacts"                 # listar
curl -sb c.txt "$APP/api/bots/$ID/files?path=artifacts/pagina.txt&download=1"  # descargar
curl -sb c.txt $APP/api/bots/$ID/logs                                   # logs

curl -sb c.txt -H 'content-type: application/json' $APP/api/bots/$ID/tasks/$TASK -d '{"action":"cancel"}'  # también approve o deny
curl -sb c.txt -H 'content-type: application/json' $APP/api/bots/$ID/lifecycle -d '{"action":"stop"}'      # o recreate

curl -sb c.txt -X DELETE $APP/api/bots/$ID            # conserva el volumen
curl -sb c.txt -X DELETE "$APP/api/bots/$ID?purge=1"  # borra también los datos
```

Pasos disponibles: `goto`, `fill` (`secret: true` para no registrar el valor), `click`, `press`, `scroll`, `wait_for`, `extract`, `screenshot`, `write_file`, `download`, `upload`, `shell`, `approve`, `desktop_click`, `desktop_type` (también admite `secret`), `desktop_key`, `desktop_scroll`, `desktop_screenshot`. Los valores admiten `{{variable}}`.

También se puede hacer todo desde la interfaz, en `/bots`.

`network: "none"` deja un bot sin ninguna salida.

### Reproducir el e2e

No toca el stack `nexus`: usa un proyecto Compose y una base de datos aparte.

```bash
docker compose -p nexbots-e2e -f services/nexbot/e2e/compose.yml --profile build-only build nexbot-image
docker compose -p nexbots-e2e -f services/nexbot/e2e/compose.yml up -d --build
docker compose -p nexbots-e2e -f services/nexbot/e2e/compose.yml exec -T db pg_isready -U plexo

export DATABASE_URL=postgres://plexo:plexo@127.0.0.1:15433/plexo \
  NEXUS_SANDBOXD_URL=http://127.0.0.1:18095 NEXUS_AGENT_SECRET=e2e-secret-no-es-real \
  APP_ENCRYPTION_KEY=$(openssl rand -hex 32) NEXUS_WORKER=off \
  NEXUS_AGENT_URL=http://127.0.0.1:18096 NEXUS_INTERNAL_URL=http://host.docker.internal:3999 E2E_OUT=/tmp
node scripts/migrate.mjs
node_modules/.bin/next dev -p 3999 &
node services/nexbot/e2e/run.mjs   # deja capturas de la interfaz en $E2E_OUT

# Limpieza
docker compose -p nexbots-e2e -f services/nexbot/e2e/compose.yml --profile build-only down -v --rmi local
docker image rm nexus-nexbot:e2e
```

El registro de la primera cuenta solo funciona con la base de datos vacía; para repetir, vacíala antes con `TRUNCATE users CASCADE`. El e2e usa `nexus-agent` como imagen del cliente MCP, así que necesita ese contenedor. Su sidecar se construye desde el repositorio hermano `../nas-adk`, y el «modelo» es un simulador (`fake_model.py`) que decide leyendo los píxeles: no mide la calidad de ningún modelo real.

## 8. Qué está diseñado, implementado y probado

| Elemento | Estado |
|---|---|
| Crear bots, entorno, tareas, navegador, artefactos, parar/arrancar/recrear, aislamiento, fallos, aprobaciones en planes | **Probado de extremo a extremo** (API de Next, `sandboxd`, Docker y Chromium reales; 287/287 junto con lo siguiente y con las salas, contra la imagen de producción) |
| Escritorio, acciones por píxeles, emisión MJPEG, límite de espectadores, bot sin pantalla | **Probado de extremo a extremo** |
| Visor e interfaz `/bots` en un navegador real | **Probado** (carga y emisión); el resto de la interfaz, de forma manual solo por capturas |
| Cliente MCP real de nas-adk contra un bot | **Probado** (sin modelo: las llamadas las hace el script) |
| Recrear `sandboxd` y recuperar el contacto con los bots | **Probado** |
| Tareas con un modelo (`kind: "agent"`), conector al reanudar tras aprobación | **Implementado, sin ejecutar**: hace falta gastar una credencial real |
| Reglas de política `nexbot__*` | Pruebas unitarias |
| Reconciliación al arrancar la app, reintentos `on-failure`, cupos de bots | **Implementado, sin probar de extremo a extremo** |
| Servicios del `docker-compose.yml` principal | Validado con `docker compose config`; el e2e usa un compose equivalente, **no se ha desplegado** |
| Consumo de memoria | Medido en reposo con el navegador abierto (~350 MB); **sin medir bajo carga** |
| Computer use: capturas al modelo, clic por píxeles, confinamiento, parada, tope de pasos | **Probado de extremo a extremo con un simulador de modelo** por la vía OpenAI-compatible; **sin probar con un modelo real** |
| Imágenes hacia la API nativa de Anthropic | Solo pruebas unitarias del formato |
| Herramienta nativa de Anthropic, toma de control, allowlist por bot, bóveda | **Solo diseñado** |


## Salas: foro, menciones y tablero

Una sala reúne varios NexBots de la misma persona. Cada **hilo** es a la vez una conversación y una **tarjeta** del tablero. Se entra por `/bots` → «Nueva sala»; la sala vive en `/bots/salas/<id>`. Un bot **sin perfil de agente** usa el modelo por defecto de su dueño; el perfil es opcional y aporta modelo e instrucciones propios.

### Cómo se reparte la palabra

- `@handle` (el slug del bot) le da un turno. Solo cuentan los bots de la sala; una `@` dentro de código, un correo o una ruta no cuenta. Máximo 5 por mensaje.
- Sin mención responde el **responsable** del hilo. Sin responsable, el mensaje queda como nota y nadie gasta tokens.
- Los bots hablan **de uno en uno por hilo y en orden**, y un bot solo tiene un turno activo a la vez. Lo garantizan tres índices únicos parciales de `room_turns`, no la aplicación.
- Si un bot menciona a otro en su respuesta, ese otro recibe un turno en la misma **ronda**. No hay red entre contenedores: todo pasa por el BFF.
- Lo que escribió otro bot llega al modelo dentro de un bloque delimitado con un valor aleatorio por turno y marcado como «información, no instrucciones de tu operador».

### Límites de una ronda

Por defecto 6 respuestas encadenadas, 12 turnos, 500.000 tokens y 15 pasos por turno; se cambian en los ajustes de la sala. Al llegar a uno, los turnos pendientes quedan retenidos y un aviso ofrece **Continuar** (ronda nueva). **Parar** cancela el turno activo y vacía la cola. El cupo mensual de la cuenta se reparte entre los turnos en marcha.

### Qué puede hacer un bot en un turno

Solo `nexbot__desktop_*` y `nexbot__workspace_*` de **su** contenedor y las herramientas `board_*`. Ni búsqueda o lectura web del sidecar, ni memoria, ni conectores del perfil, ni `shell_exec`, ni `browser_*`. Lo imponen el sidecar (lista de herramientas) y la política (`deny-room-outside` / `allow-room`), y cada decisión se audita. Un modelo sin visión conserva el workspace y el tablero, sin escritorio.

### Tablero

Estados: Pendiente, Por hacer, En curso, En revisión, Bloqueado, Hecho, Cancelado.

- Asignar una tarea despierta a su responsable; escribir en una tarea cerrada la reabre.
- Subtareas (hasta 3 niveles) y bloqueos sin ciclos. Al cerrarse lo que bloqueaba, la tarea se desbloquea y su responsable recibe un turno; al cerrarse todas las subtareas, lo recibe el de la tarea padre.
- Un bot puede crear subtareas, asignar, bloquear y mover entre Por hacer, En curso, En revisión y Bloqueado, con un máximo de 5 cambios por turno. **Cerrar o cancelar es solo de una persona.** No puede devolver trabajo a quien abrió una tarea superior aún abierta, ni tocar tarjetas de otra sala.
- `room_activity` guarda quién hizo qué.

### Límites reales

- **La sala es un canal de datos.** Un bot sin internet junto a otro con internet puede pasarle información que este saque fuera. Mezclarlos exige confirmación explícita, pero no lo impide.
- **Inyección en cascada.** Una web puede engañar a un bot para que intente engañar a otro. Lo acotan el marcado de no confiable, los límites de ronda, que solo una persona cierra tareas y que los bots no tocan la configuración. No lo elimina.
- **Razonamiento.** Se muestra plegado en cada mensaje y en «Actividad» solo cuando el proveedor lo publica: Claude 5 y posteriores por la API de Anthropic (resumen, `display: "summarized"`), y servidores compatibles con OpenAI que envían `reasoning_content` o `reasoning`. No se pide en Claude 4.x (activarlo cambiaría su coste), ni con la suscripción de Claude Code, ni se solicita a la API Responses de OpenAI (solo se muestra si llega). Es lo que el modelo decide publicar, no una traza fiel de su proceso, y se guarda hasta 24.000 caracteres por turno.
- Un turno en pausa por aprobación se reanuda confinado (código y tipos), pero **esa ruta no está probada de extremo a extremo**: la política de sala no pide aprobaciones, así que no ocurre en el flujo normal.
- Probado con un simulador de modelo, no con un modelo real: no mide si los bots colaboran bien.

### NexBots desde un chat normal

Un mensaje que empieza por `@handle` de un bot propio (`@ana abre …`) da **ese turno** al bot: responde en el chat con el historial del hilo y trabaja en su contenedor. Las salas aparecen además en la barra lateral, en la sección «Salas».

- El turno está confinado igual que en una sala, sin tablero: solo `nexbot__desktop_*` y `nexbot__workspace_*` de su contenedor. Ni búsqueda, ni conectores, ni interfaz generativa.
- La mención no se recuerda: el siguiente mensaje sin `@` vuelve al chat normal. Si un agente y un bot comparten nombre, gana el agente.
- El bot debe estar en marcha y libre. Si está parado u ocupado (sala, tarea de ordenador u otro chat), el chat lo dice y no lanza nada.
- Solo vale al principio del mensaje y para un bot por turno; para que varios colaboren están las salas.

### Varias instalaciones en un mismo Docker

Cada `sandboxd` solo gestiona los bots con su etiqueta (`BOT_LABEL`, por defecto `nexus.bot`). Sin esto, una segunda instalación (por ejemplo el e2e) veía conectados a sus bots los servicios de la primera.
