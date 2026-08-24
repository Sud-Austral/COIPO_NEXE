# Descarga histórica de posiciones Nexe (AFF JSON) — CONAF
#
# Extractor batch para ANÁLISIS (pandas, QGIS, kepler.gl): descarga las posiciones en
# ARCHIVOS DIARIOS CSV (datos_historicos/posiciones_AAAA-MM-DD.csv) más un catálogo de
# recursos con los metadatos hg*.
#
# Es independiente del collector: aquel alimenta Postgres en continuo para el visor;
# este produce archivos sueltos para trabajo analítico. AMBOS comparten el mismo
# cliente de Nexe (backend/app/nexe/), así que hablan exactamente el mismo contrato.
#
# Cuida el endpoint (CLAUDE.md §7.4):
# - pagina por dataCtrTime (filtro estrictamente >, límite real 1000/página),
# - pausa configurable entre páginas (default 0,7 s ~= 1,4 req/s),
# - un día por vez, y SE SALTA los días que ya tienen archivo — al correrlo a diario
#   solo baja lo nuevo. Un día sin datos NO crea archivo, para poder reintentarlo.
#
# Uso:
#   python descargar_historico_nexe.py                        # ayer (día de Chile)
#   python descargar_historico_nexe.py --desde 2026-06-19 --hasta 2026-06-27
#   python descargar_historico_nexe.py --forzar --pausa 1.0
#
# Programarlo diario en Windows (Programador de tareas), 08:00:
#   schtasks /Create /SC DAILY /ST 08:00 /TN "NexeHistorico" ^
#     /TR "python C:\...\COIPO_NEXE\descargar_historico_nexe.py"
#
# La API key se lee de NEXE_API_KEY o del .env de la raíz / frontend/.env — jamás va
# escrita en este archivo (el repo es público).

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
# El cliente de Nexe vive en el backend: una sola definición del contrato.
sys.path.insert(0, str(RAIZ / "backend"))

from app.nexe import (  # noqa: E402  (después del sys.path)
    ClaveRechazada,
    ClienteNexe,
    ContratoRechazado,
    NexeError,
    iso_utc,
)

# consolas Windows con cp1252: no reventar por un "→" en un print
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CARPETA_SALIDA = RAIZ / "datos_historicos"
MARGEN_REZAGADOS = timedelta(minutes=25)  # llegadas tardías tras el fin del día

COLUMNAS = [
    "esn", "pos_time", "data_ctr_time", "latitud", "longitud",
    "altitud", "velocidad", "rumbo", "fix_type", "src",
    "pdop", "hdop", "unit_id", "hg_ext_name",
]

COLUMNAS_CATALOGO = [
    "esn", "unit_id", "hg_ext_name", "hg_alias", "hg_asset", "hg_asset_model",
    "hg_asset_family", "hg_family_type", "hg_company", "hg_source", "hg_navstate",
    "pos_time", "data_ctr_time", "latitud", "longitud",
]


def leer_api_key() -> str:
    """NEXE_API_KEY del entorno, o del .env de la raíz / frontend/.env."""
    key = os.environ.get("NEXE_API_KEY", "").strip()
    if key:
        return key
    for dotenv in (RAIZ / ".env", RAIZ / "frontend" / ".env"):
        if not dotenv.exists():
            continue
        for linea in dotenv.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if linea.startswith("NEXE_API_KEY="):
                key = linea.split("=", 1)[1].strip()
                if key and not key.startswith("<"):
                    return key
    sys.exit(
        "No encontré la API key: define NEXE_API_KEY en el entorno o en .env "
        "(NEXE_API_KEY=...) en la raíz del repo o en frontend/."
    )


def leer_base_url() -> str:
    url = os.environ.get("NEXE_BASE_URL", "").strip()
    if url:
        return url
    for dotenv in (RAIZ / ".env", RAIZ / "frontend" / ".env"):
        if not dotenv.exists():
            continue
        for linea in dotenv.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if linea.startswith("NEXE_BASE_URL="):
                valor = linea.split("=", 1)[1].strip()
                if valor:
                    return valor
    return "https://staging.nexe.online/api/v1/monitor"


def zona_chile():
    """America/Santiago; si falta la base de datos tz (Windows), instruye."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("America/Santiago")
    except Exception:
        sys.exit(
            "No pude cargar la zona horaria America/Santiago. "
            "Instala la base tz:  pip install tzdata"
        )


def escribir_csv(destino: Path, columnas: list[str], filas: list[dict]) -> None:
    CARPETA_SALIDA.mkdir(exist_ok=True)
    with destino.open("w", newline="", encoding="utf-8-sig") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=columnas, extrasaction="ignore")
        escritor.writeheader()
        for fila in filas:
            escritor.writerow(
                {
                    c: (iso_utc(v) if isinstance(v, datetime) else v)
                    for c, v in fila.items()
                }
            )


def descargar_dia(api: ClienteNexe, dia: date, tz, pausa_s: float, forzar: bool) -> None:
    """Un día de Chile [00:00, 24:00) -> un CSV. Se salta si ya existe."""
    destino = CARPETA_SALIDA / f"posiciones_{dia.isoformat()}.csv"
    if destino.exists() and not forzar:
        print(f"• {dia}: ya existe {destino.name} — omitido (usa --forzar para rehacer)")
        return

    inicio = datetime.combine(dia, dtime.min, tzinfo=tz).astimezone(timezone.utc)
    fin = inicio + timedelta(days=1)

    filas: dict[tuple, dict] = {}  # dedupe por (esn, pos_time)
    paginas = 0

    for pagina in api.paginas_desde(inicio, max_paginas=200):
        paginas += 1
        for fila in pagina.filas:
            if inicio <= fila["pos_time"] < fin:
                filas[(fila["esn"], fila["pos_time"])] = fila
        print(f"  página {paginas}: {pagina.crudas} features · en el día: {len(filas)}")
        # Ya pasamos el día (con margen para los rezagados): no hay nada más que traer.
        if pagina.cursor is not None and pagina.cursor > fin + MARGEN_REZAGADOS:
            break
        time.sleep(pausa_s)

    # Día sin posiciones: NO crear archivo — así una corrida futura lo reintenta
    # (en staging la copia de datos corre días detrás del presente, CLAUDE.md §2).
    if not filas:
        print(f"• {dia}: sin posiciones (¿día aún no disponible en staging?) — no se crea archivo")
        return

    ordenadas = [filas[clave] for clave in sorted(filas)]
    escribir_csv(destino, COLUMNAS, ordenadas)
    print(f"✔ {dia}: {len(ordenadas)} posiciones → {destino.relative_to(RAIZ)}")


def descargar_catalogo(api: ClienteNexe, pausa_s: float) -> None:
    """Última posición + metadatos hg* de cada recurso (1 sola llamada)."""
    time.sleep(pausa_s)
    filas = api.ultimas_posiciones(datetime.now(timezone.utc) - timedelta(days=30))
    destino = CARPETA_SALIDA / "catalogo_recursos.csv"
    escribir_csv(destino, COLUMNAS_CATALOGO, sorted(filas, key=lambda f: str(f["esn"])))
    print(f"✔ catálogo: {len(filas)} recursos → {destino.relative_to(RAIZ)}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Descarga diaria de posiciones históricas de Nexe (AFF JSON)."
    )
    parser.add_argument("--desde", type=date.fromisoformat, default=None,
                        help="primer día AAAA-MM-DD (default: ayer, hora de Chile)")
    parser.add_argument("--hasta", type=date.fromisoformat, default=None,
                        help="último día inclusive (default: igual a --desde)")
    parser.add_argument("--pausa", type=float, default=0.7,
                        help="segundos entre páginas (default 0.7)")
    parser.add_argument("--forzar", action="store_true",
                        help="rehacer días que ya tienen archivo")
    parser.add_argument("--sin-catalogo", action="store_true",
                        help="no actualizar catalogo_recursos.csv")
    args = parser.parse_args()

    tz = zona_chile()
    ayer = (datetime.now(tz) - timedelta(days=1)).date()
    desde = args.desde or ayer
    hasta = args.hasta or desde
    if hasta < desde:
        sys.exit("--hasta no puede ser anterior a --desde")

    base_url = leer_base_url()
    api = ClienteNexe(base_url, leer_api_key())

    print(f"Rango: {desde} → {hasta} (días de Chile) · pausa {args.pausa}s · {base_url}")
    try:
        dia = desde
        while dia <= hasta:
            descargar_dia(api, dia, tz, args.pausa, args.forzar)
            dia += timedelta(days=1)
            if dia <= hasta:
                time.sleep(args.pausa)

        if not args.sin_catalogo:
            descargar_catalogo(api, args.pausa)
    except ClaveRechazada as error:
        sys.exit(f"401: {error}")
    except ContratoRechazado as error:
        sys.exit(f"422: contrato desalineado — detalle: {error.detalle}")
    except NexeError as error:
        sys.exit(f"Nexe no disponible: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


# ── Análisis posterior (ejemplo con pandas) ──────────────────────────────────
# import pandas as pd
# from pathlib import Path
#
# archivos = sorted(Path("datos_historicos").glob("posiciones_*.csv"))
# df = pd.concat((pd.read_csv(a, parse_dates=["pos_time", "data_ctr_time"]) for a in archivos))
# catalogo = pd.read_csv("datos_historicos/catalogo_recursos.csv")
#
# df.groupby("hg_ext_name").agg(
#     posiciones=("pos_time", "count"),
#     primera=("pos_time", "min"),
#     ultima=("pos_time", "max"),
#     vel_max=("velocidad", "max"),
# )
