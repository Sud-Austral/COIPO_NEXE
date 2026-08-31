#!/bin/sh
# Corrida inmediata + supercronic. La corrida inmediata importa: sin ella, tras cada
# deploy el visor se queda sin datos nuevos hasta que el reloj cruce el minuto.
# Si falla, no se aborta el arranque: supercronic seguirá intentando cada minuto.
set -e

echo "[entrypoint] corrida inicial de ingesta"
cd /app/collector && python ingesta.py \
  || echo "[entrypoint] la corrida inicial falló; supercronic reintentará cada minuto"

echo "[entrypoint] cediendo el control a supercronic"
exec supercronic /app/collector/crontab
