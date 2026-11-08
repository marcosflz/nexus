# Sidecar de agentes de Nexus (nas-adk detrás de una API SSE).
#
# nas-adk vive en su propio repositorio: docker-compose lo aporta como contexto
# adicional llamado "nas-adk" (ver docker-compose.yml, variable NAS_ADK_PATH).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# CLI de Claude Code para el proveedor «suscripción». La versión se fija porque nas-adk
# valida sus opciones de aislamiento; 2.1.319 es la que tiene probada.
ARG CLAUDE_CODE_VERSION=2.1.319
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://claude.ai/install.sh | HOME=/tmp/claude-install bash -s "$CLAUDE_CODE_VERSION" \
    && install -m 0755 "$(readlink -f /tmp/claude-install/.local/bin/claude)" /usr/local/bin/claude \
    && rm -rf /tmp/claude-install /var/lib/apt/lists/* \
    && claude --version

COPY --from=nas-adk . /opt/nas-adk
RUN pip install "/opt/nas-adk[anthropic]"

COPY pyproject.toml ./
COPY nexus_agent ./nexus_agent
# nas-adk ya está instalado: se instalan el resto de dependencias y el paquete sin volver a resolverlo.
RUN pip install fastapi "uvicorn>=0.34" "httpx>=0.27" "pydantic>=2.12" && pip install --no-deps .

# El CLI necesita un HOME escribible para su configuración.
RUN useradd --system --uid 10001 --create-home --home-dir /home/agent agent
ENV HOME=/home/agent
USER agent

EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=2).status==200 else 1)"

CMD ["uvicorn", "nexus_agent.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8090"]
