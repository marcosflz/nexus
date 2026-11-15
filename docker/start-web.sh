#!/bin/sh
# Arranque del contenedor web: migraciones + Next.js.
set -eu

echo "[nexus] aplicando migraciones..."
node scripts/migrate.mjs

echo "[nexus] arrancando Next.js en :${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
