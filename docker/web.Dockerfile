# Imagen base oficial de Hermes (incluye el CLI `hermes`, Python y Node 26).
# Plexo embebe el CLI: cada turno se ejecuta con el perfil del usuario y su key.
FROM nousresearch/hermes-agent:latest

USER root
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HERMES_HOME=/opt/data \
    HERMES_BIN=/opt/hermes/.venv/bin/hermes

COPY package.json ./
# --include=dev: la imagen base define NODE_ENV=production y npm omitiría
# tailwind/typescript, necesarios para `next build`.
RUN npm install --include=dev --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev && chown -R 10000:10000 /app

EXPOSE 3000

# Se conserva el ENTRYPOINT de la imagen (dispatcher/s6): inicializa /opt/data,
# arregla permisos del volumen y luego ejecuta este CMD como el usuario hermes.
CMD ["bash", "/app/docker/start-web.sh"]
