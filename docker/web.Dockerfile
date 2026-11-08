# Imagen de la app (Next.js + BFF). El motor de agentes vive en otro contenedor
# (sidecar nas-adk, docker/agent.Dockerfile), así que aquí solo hace falta Node.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# El .npmrc debe estar presente ANTES del install: fija legacy-peer-deps, sin lo
# cual npm aborta por el conflicto zustand 4 (OpenUI) / zustand 5 (assistant-ui).
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["sh", "/app/docker/start-web.sh"]
