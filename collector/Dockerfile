# Collector: ingiere Nexe hacia Postgres cada minuto. Build context = RAÍZ del repo.
#
# Reutiliza backend/requirements.txt y copia backend/ para poder importar
# `app.nexe` y `app.db`: la lógica de negocio (contrato de Nexe, aplanado, esquema)
# vive UNA sola vez, en el backend. Duplicarla aquí sería garantía de divergencia.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/backend

WORKDIR /app

# supercronic: cron para contenedores (sin root, sin syslog, loguea a stdout).
# Se verifica el binario con sha1sum antes de confiar en él.
# Versión y checksum idénticos a los de COIPO_PRENSA2, ya verificados en producción.
ENV SUPERCRONIC_VERSION=v0.2.47
ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64
ENV SUPERCRONIC_SHA1SUM=712d2ece75da6f6e530192a151488578153e4e96
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSLo /usr/local/bin/supercronic "$SUPERCRONIC_URL" \
    && echo "${SUPERCRONIC_SHA1SUM}  /usr/local/bin/supercronic" | sha1sum -c - \
    && chmod +x /usr/local/bin/supercronic \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY db/ db/
COPY backend/ backend/
COPY collector/ collector/

RUN chmod +x collector/docker-entrypoint.sh

ENTRYPOINT ["/app/collector/docker-entrypoint.sh"]
