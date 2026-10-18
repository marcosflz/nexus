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
command -v node >/dev/null 2>&1 || { echo "[plexo] FATAL: node no encontrado" >&2; exit 1; }

echo "[plexo] aplicando migraciones..."
node scripts/migrate.mjs

echo "[plexo] arrancando Next.js en :${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
