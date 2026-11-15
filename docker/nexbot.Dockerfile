# Runtime de un NexBot: la imagen es inmutable y compartida; lo que distingue a
# cada bot vive en su volumen. No incluye ningún secreto.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

WORKDIR /srv
COPY pyproject.toml ./
COPY nexbot ./nexbot
RUN pip install "fastapi>=0.133,<1" "uvicorn>=0.34,<1" "pydantic>=2.12,<3" "playwright==1.64.1" "mcp>=1.30,<2" \
        "mss>=10,<11" "pillow>=11,<13" \
    && pip install --no-deps . \
    && playwright install --with-deps chromium \
    && apt-get install -y --no-install-recommends xvfb openbox xdotool nodejs \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Escritorio confinado: sin menús ni atajos, y Chromium sin acceso a ficheros ni a páginas internas.
COPY desktop/rc.xml /etc/nexbot/openbox.xml
COPY desktop/chromium-policy.json /etc/chromium/policies/managed/nexbot.json
COPY desktop/chromium-policy.json /etc/opt/chrome_for_testing/policies/managed/nexbot.json

# El volumen hereda este propietario la primera vez que se monta.
RUN useradd --uid 10010 --create-home --shell /bin/bash bot \
    && mkdir -p /bot && chown bot:bot /bot
USER bot
VOLUME ["/bot"]

EXPOSE 8900
CMD ["uvicorn", "nexbot.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8900", "--no-access-log"]
