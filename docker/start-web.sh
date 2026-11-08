#!/usr/bin/env bash
# Arranque del contenedor web: migraciones + Next.js.
# Se ejecuta como el usuario `hermes` (uid 10000) vía el dispatcher de la imagen.
set -euo pipefail

# Node puede no estar en el PATH fuera del árbol s6: localizarlo.
if ! command -v node >/dev/null 2>&1; then
  for d in /opt/hermes/tools/node/bin /opt/hermes/tools/nodejs/bin /opt/hermes/tools/node-v26/bin; do
    if [ -x "$d/node" ]; then
      export PATH="$d:$PATH"
      break
    fi
  done
fi

export PATH="$PATH:/opt/hermes/.venv/bin"
command -v node >/dev/null 2>&1 || { echo "[nexus] FATAL: node no encontrado" >&2; exit 1; }

echo "[nexus] aplicando migraciones..."
node scripts/migrate.mjs

# Renombra los perfiles de Hermes de plexo-* a nexus-* (idempotente; si falla,
# la app sigue usando el nombre antiguo).
node scripts/migrate-hermes-profiles.mjs || echo "[nexus] la migración de perfiles falló; se usarán los nombres antiguos" >&2

# Esta versión de Hermes responde por un gateway local. Si lo arrancamos aquí y lo dejamos
# vivo, la primera pregunta no paga ~20-50 s de arranque en frío ni se apaga por inactividad.
# Si falla, el CLI sigue levantando uno a demanda, como antes.
( hermes --profile default gateway run --quiet >/tmp/hermes-gateway.log 2>&1 || true ) &

echo "[nexus] arrancando Next.js en :${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
