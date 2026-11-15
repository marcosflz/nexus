# Gestor de espacios de trabajo de los agentes (perfil «computer» de Compose).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv

COPY pyproject.toml ./
COPY sandboxd ./sandboxd
RUN pip install fastapi "uvicorn>=0.34" "httpx>=0.27" "pydantic>=2.12" && pip install --no-deps .

RUN useradd --system --uid 10002 --no-create-home sandboxd
USER sandboxd

EXPOSE 8095
CMD ["uvicorn", "sandboxd.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8095"]
