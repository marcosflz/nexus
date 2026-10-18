# Próximos pasos (retomar aquí)

Estado al pausar: **2026-10-04**. El stack se construyó y arrancó con `docker compose`
y se hizo un smoke test completo por API. Este documento resume qué funciona, qué
encontramos y el backlog priorizado para retomar.

## 1. Smoke test realizado (qué funciona)

Comando usado: `docker compose up -d --build` con la app en `http://localhost:3010`
(`APP_PORT=3010`; por defecto 3000), Postgres en `127.0.0.1:5433` y SearXNG en
`127.0.0.1:8888`.

| Prueba | Resultado |
|---|---|
| `GET /` sin sesión | `307` → `/login` |
| Registro (`POST /api/auth/register`) | Usuario creado en Postgres |
| `GET /api/settings` | Lista de proveedores OK |
| `PUT /api/settings` con key | Guardada cifrada (AES-256-GCM) |
| Crear hilo / listar / GET hilo | OK; título autogenerado y mensaje persistido |
| `POST /api/uploads` con `.txt` | Texto extraído correctamente |
| SearXNG `format=json` | Resultados reales vía JSON API |
| `POST /api/chat` con key falsa | SSE con `event: session` (sesión de Hermes creada) y `event: error` `HTTP 401: User not found.` |
| Perfil Hermes por usuario | `profiles/plexo-<hash>/SOUL.md` + `workspaces/plexo-<hash>/` creados en el volumen |

La cadena completa BFF → spawn CLI → JSONL → SSE → UI queda validada; solo falta
probar con una API key real para ver búsquedas y citas de extremo a extremo.

## 2. Hallazgos y correcciones aplicadas

1. **`NODE_ENV=production` en la imagen base** hacía que `npm install` omitiera las
   devDependencies (Tailwind, TypeScript) y `next build` fallara. Corregido con
   `npm install --include=dev` en `docker/web.Dockerfile`.
2. **Postgres 18** espera el volumen en `/var/lib/postgresql` (no `.../data`).
   Corregido en `docker-compose.yml`.
3. **Puertos ocupados en el host** (5432 y 3000): la DB se publica en `5433` y la
   app acepta `APP_PORT` (p. ej. `APP_PORT=3010 docker compose up -d`).
4. **`hermes` no está en el PATH de `docker compose exec`** (solo dentro del árbol s6).
   El runner usa la ruta absoluta `HERMES_BIN=/opt/hermes/.venv/bin/hermes`; para
   depurar a mano usar esa ruta.
5. **La sesión de Hermes no se persiste si el turno falla**: `hermesSessionId` solo se
   guarda tras un turno correcto. Detectado con la key falsa. Ver P0-1.
6. **Bucle de login en HTTP**: con `NODE_ENV=production` la cookie de sesión salía con
   `Secure` y el navegador la descartaba al servir por HTTP (self-hosted/LAN). Corregido:
   `sessionCookieOptions` deriva `secure` de `x-forwarded-proto`/URL de la petición
   (marca `Secure` solo detrás de HTTPS).

## 3. Cómo retomar

```bash
# Arrancar (la imagen ya está construida)
APP_PORT=3010 docker compose up -d

# Ver estado / logs
docker compose ps
docker compose logs -f app

# Tests y checks
npm test && npm run typecheck && npm run build

# Parar / resetear todo (borra usuarios, hilos y .hermes-data)
docker compose down
docker compose down -v

# Reescalar tras cambiar Dockerfile o dependencias
docker compose build app && APP_PORT=3010 docker compose up -d
```

Datos de prueba creados (viven en el volumen `plexo_db-data`; `docker compose down -v` los borra):

| Cuenta | Password | Notas |
|---|---|---|
| `test@plexo.local` | `testpass123` | Creada vía API; key falsa ya eliminada |
| `admin@plexo.local` | `admin` | Insertada a mano; **hoy es un usuario normal**: no existe rol admin ni panel de administración |

Para recrear la cuenta admin tras un reset (la contraseña no pasa el mínimo de 8
caracteres del registro, por eso se inserta directo con el hash scrypt de la app):

```bash
HASH=$(node -e "const c=require('node:crypto');const s=c.randomBytes(16);const h=c.scryptSync('admin',s,64);console.log('scrypt:'+s.toString('base64')+':'+h.toString('base64'))")
docker compose exec -T db psql -U plexo -d plexo -c \
  "INSERT INTO users (email, password_hash) VALUES ('admin@plexo.local', '$HASH') ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;"
```

El volumen `plexo_hermes-data` contiene los perfiles y workspaces de Hermes.

## 4. Backlog priorizado

### P0 — correcciones pequeñas

1. **Persistir `hermesSessionId` al vuelo**: en `app/api/chat/route.ts`, en el caso
   `event.kind === "session"`, actualizar `threads.hermesSessionId` inmediatamente
   (hoy se pierde si el turno aborta/falla y el siguiente turno arranca sin contexto).
2. **`no_credential` en la UI**: si `/api/chat` responde 400 con `code: "no_credential"`,
   redirigir a `/settings` con un aviso en vez de dejarlo como error del mensaje.
3. **Manejo de cancelación**: al cancelar, persistir el parcial o marcarlo; hoy el
   mensaje queda solo en el cliente.

### P1 — producto

4. **Compartir hilos por enlace** (`/s/<id>` público de solo lectura) + opción de
   desactivar.
5. **Coste/uso por usuario**: `messages.usage` ya se persiste; agregar totales por hilo
   y por mes en Ajustes, y límites opcionales por variables de entorno.
6. **Historial**: buscar en hilos, renombrar y borrar desde la UI.
7. **Focus modes reales**: mapear a categorías/dominios de SearXNG (hoy es solo
   instrucción de prompt); requiere verificar si el backend SearXNG de Hermes expone
   filtros.
8. **Adjuntos**: citar documentos en `## Sources`, soportar PDF escaneado (OCR) y
   no truncar tan agresivamente (o indexar por embeddings).
9. **Roles y administración**: `admin@plexo.local` hoy no tiene privilegios. Añadir
   `users.role`, panel básico (usuarios, uso, borrado) y, si aplica, primer usuario
   registrado como admin por variable de entorno.

### P2 — arquitectura e infra

10. **Sidecar `AIAgent` embebido** (guía oficial "Hermes as a Python library", con
    `api_key` por instancia y callbacks): elimina el arranque en frío por turno y
    permite streaming por eventos internos. Alternativa intermedia: mantener el CLI
    pero precalentar perfiles.
11. **SSE resumible**: persistir deltas o adoptar streams resumibles
    (`assistant-stream/resumable`) para recargas a mitad de respuesta.
12. **Imagen más ligera**: hoy hereda Hermes completo (Chromium, Python, etc.). Opción:
    separar `web` (node slim) + `agent` (imagen Hermes) con un protocolo interno
    (HTTP/Unix socket) en vez de co-locar el CLI.
13. **CI**: workflow con `npm test`, `typecheck`, `build` y un smoke test de compose.
14. **i18n**: la UI está en español; extraer cadenas si se quiere publicar en inglés.
15. **Hardening**: rate limiting por usuario/IP, CSRF explícito, límites de tamaño
    también en `/api/chat`, auditoría de eventos, rotación de `APP_ENCRYPTION_KEY`.

## 5. Decisiones y referencias

- Decisiones de arquitectura e iteraciones: [`decisiones-mvp.md`](decisiones-mvp.md).
- Investigación de features de Perplexity y del stack: [`perplexity-funcionalidades.md`](perplexity-funcionalidades.md),
  [`stack-tecnico.md`](stack-tecnico.md).
- Quickstart y estructura: [`../README.md`](../README.md).
