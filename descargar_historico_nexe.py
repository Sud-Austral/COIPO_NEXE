# Descarga histórica de posiciones Nexe (AFF JSON) — CONAF
#
# Descarga las posiciones de /position/affjson/get en ARCHIVOS DIARIOS CSV
# (datos_historicos/posiciones_AAAA-MM-DD.csv) para análisis posterior
# (pandas, QGIS, kepler.gl), más un catálogo de recursos con los metadatos
# hg* de get_lastpositions.
#
# Diseñado para NO sobrecargar el endpoint (CLAUDE.md §7.4):
# - pagina por dataCtrTime (filtro estrictamente >, límite real 1000/página),
# - pausa configurable entre páginas (default 0,7 s ~= 1,4 req/s, muy bajo el
#   tope defensivo de 4 req/s),
# - un día por vez, y SE SALTA los días que ya tienen archivo — al correrlo
#   a diario solo baja lo nuevo.
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
# La API key se lee de la variable de entorno NEXE_API_KEY o de frontend/.env
# (jamás va escrita en este archivo: el repo es público).

from __future__ import annotations

import argparse
import csv
import sys
import time
from datetime import datetime, date, time as dtime, timedelta, timezone
from pathlib import Path

import requests

# consolas Windows con cp1252: no reventar por un "→" en un print
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent
CARPETA_SALIDA = RAIZ / "datos_historicos"

BASE_URL = "https://staging.nexe.online/api/v1/monitor"
LIMITE_PAGINA = 1000          # límite real observado (CLAUDE.md §2)
UMBRAL_PAGINA_LLENA = 900     # menos que esto = última página
MAX_PAGINAS_POR_DIA = 200     # tope de seguridad (~200.000 posiciones/día)
MARGEN_REZAGADOS_S = 25 * 60  # llegadas tardías tras el fin del día
REINTENTOS_5XX = (5, 10, 20)  # backoff en segundos

COLUMNAS = [
    "esn", "posTime", "dataCtrTime", "latitude", "longitude",
    "altitude", "speed", "heading", "fixType", "src",
    "pdop", "hdop", "unitId", "hgExtName",
]

COLUMNAS_CATALOGO = [
    "esn", "unitId", "hgExtName", "hgAlias", "hgAsset", "hgAssetModel",
    "hgAssetFamily", "hgFamilyType", "hgCompany", "hgSource", "hgNavstate",
    "posTime", "dataCtrTime", "latitude", "longitude",
]


def leer_api_key() -> str:
    """NEXE_API_KEY del entorno, o de frontend/.env (nunca hardcodeada aquí)."""
    import os

    key = os.environ.get("NEXE_API_KEY", "").strip()
    if key:
        return key
    dotenv = RAIZ / "frontend" / ".env"
    if dotenv.exists():
        for linea in dotenv.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if linea.startswith("NEXE_API_KEY="):
                key = linea.split("=", 1)[1].strip()
                if key:
                    return key
    sys.exit(
        "No encontré la API key: define NEXE_API_KEY en el entorno "
        "o en frontend/.env (NEXE_API_KEY=...)."
    )


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


def iso_utc(momento: datetime) -> str:
    """ISO 8601 UTC con milisegundos y Z, como exige Nexe."""
    return momento.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def cuerpo_nexe(data_ctr_time_iso: str) -> dict:
    """Body oficial (CLAUDE.md §7.2). Los "string" son placeholders OBLIGATORIOS."""
    return {
        "type": "dataRequest",
        "dataCenter": [
            {"affVer": "string", "name": "string", "reqTime": iso_utc(datetime.now(timezone.utc))}
        ],
        "msgRequest": [
            {"to": "string", "from": "string", "msgType": "string",
             "dataCtrTime": data_ctr_time_iso}
        ],
    }


def post_nexe(sesion: requests.Session, endpoint: str, body: dict) -> dict:
    """POST con reintentos ante 5xx/red. Aborta claro ante 401/422."""
    ultimo_error: Exception | None = None
    for espera in (0,) + REINTENTOS_5XX:
        if espera:
            print(f"    reintento en {espera} s…")
            time.sleep(espera)
        try:
            resp = sesion.post(f"{BASE_URL}/{endpoint}", json=body, timeout=60)
        except requests.RequestException as error:  # red caída, timeout…
            ultimo_error = error
            continue
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 401:
            sys.exit("401: API key inválida o rotada — pedir la vigente (CLAUDE.md §2).")
        if resp.status_code == 422:
            sys.exit(f"422: contrato desalineado — detail: {resp.text[:500]}")
        ultimo_error = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    raise SystemExit(f"Sin respuesta del endpoint tras reintentos: {ultimo_error}")


def aplanar_feature(feature: dict) -> dict:
    """Feature GeoJSON → fila plana. coordinates viene [lon, lat] (¡ojo!)."""
    fila = dict(feature.get("properties") or {})
    coordenadas = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coordenadas) >= 2:
        fila["longitude"] = coordenadas[0]
        fila["latitude"] = coordenadas[1]
    # alias tolerantes del contrato (spd→speed, cog→heading, fix→fixType, alt→altitude)
    fila.setdefault("speed", fila.get("spd"))
    fila.setdefault("heading", fila.get("cog"))
    fila.setdefault("fixType", fila.get("fix"))
    fila.setdefault("altitude", fila.get("alt"))
    return fila


def descargar_dia(sesion: requests.Session, dia: date, tz, pausa_s: float, forzar: bool) -> None:
    """Un día de Chile [00:00, 24:00) → un CSV. Se salta si ya existe."""
    destino = CARPETA_SALIDA / f"posiciones_{dia.isoformat()}.csv"
    if destino.exists() and not forzar:
        print(f"• {dia}: ya existe {destino.name} — omitido (usa --forzar para rehacer)")
        return

    inicio = datetime.combine(dia, dtime.min, tzinfo=tz)
    fin = inicio + timedelta(days=1)
    inicio_utc, fin_utc = inicio.astimezone(timezone.utc), fin.astimezone(timezone.utc)

    cursor = iso_utc(inicio_utc)
    filas: dict[tuple, dict] = {}  # dedupe por (esn, posTime)
    paginas = 0

    while paginas < MAX_PAGINAS_POR_DIA:
        datos = post_nexe(sesion, "position/affjson/get", cuerpo_nexe(cursor))
        features = datos.get("features") or []
        paginas += 1

        max_ctr = cursor
        for feature in features:
            fila = aplanar_feature(feature)
            ctr = str(fila.get("dataCtrTime") or "")
            if ctr > max_ctr:
                max_ctr = ctr
            pos_time = str(fila.get("posTime") or "")
            if not pos_time:
                continue
            momento = datetime.fromisoformat(pos_time.replace("Z", "+00:00"))
            if inicio_utc <= momento < fin_utc:
                filas[(fila.get("esn"), pos_time)] = fila

        print(f"  página {paginas}: {len(features)} features · en el día: {len(filas)}")

        if max_ctr <= cursor:          # sin avance posible
            break
        cursor = max_ctr
        if len(features) < UMBRAL_PAGINA_LLENA:   # última página disponible
            break
        cursor_dt = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
        if cursor_dt > fin_utc + timedelta(seconds=MARGEN_REZAGADOS_S):
            break                       # ya pasamos el día (más margen de rezagados)
        time.sleep(pausa_s)             # pausa de cortesía entre páginas

    if paginas >= MAX_PAGINAS_POR_DIA:
        print(f"  ⚠ tope de {MAX_PAGINAS_POR_DIA} páginas alcanzado: día posiblemente incompleto")

    # Día sin posiciones: NO crear archivo — así una corrida futura lo reintenta
    # (en staging la copia de datos corre días detrás del presente, CLAUDE.md §2).
    if not filas:
        print(f"• {dia}: sin posiciones (¿día aún no disponible en staging?) — no se crea archivo")
        return

    CARPETA_SALIDA.mkdir(exist_ok=True)
    with destino.open("w", newline="", encoding="utf-8-sig") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS, extrasaction="ignore")
        escritor.writeheader()
        for _, fila in sorted(filas.items()):
            escritor.writerow(fila)
    print(f"✔ {dia}: {len(filas)} posiciones → {destino.relative_to(RAIZ)}")


def descargar_catalogo(sesion: requests.Session, pausa_s: float) -> None:
    """Última posición + metadatos hg* de cada recurso (1 sola llamada)."""
    time.sleep(pausa_s)
    hace_30d = iso_utc(datetime.now(timezone.utc) - timedelta(days=30))
    datos = post_nexe(sesion, "position/affjson/get_lastpositions", cuerpo_nexe(hace_30d))
    features = [aplanar_feature(f) for f in (datos.get("features") or [])]

    destino = CARPETA_SALIDA / "catalogo_recursos.csv"
    CARPETA_SALIDA.mkdir(exist_ok=True)
    with destino.open("w", newline="", encoding="utf-8-sig") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS_CATALOGO, extrasaction="ignore")
        escritor.writeheader()
        for fila in sorted(features, key=lambda f: str(f.get("esn"))):
            escritor.writerow(fila)
    print(f"✔ catálogo: {len(features)} recursos → {destino.relative_to(RAIZ)}")


def main() -> None:
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

    sesion = requests.Session()
    sesion.headers.update({"api-key": leer_api_key(), "Content-Type": "application/json"})

    print(f"Rango: {desde} → {hasta} (días de Chile) · pausa {args.pausa}s · {BASE_URL}")
    dia = desde
    while dia <= hasta:
        descargar_dia(sesion, dia, tz, args.pausa, args.forzar)
        dia += timedelta(days=1)
        if dia <= hasta:
            time.sleep(args.pausa)

    if not args.sin_catalogo:
        descargar_catalogo(sesion, args.pausa)


if __name__ == "__main__":
    main()


# ── Análisis posterior (ejemplo con pandas) ──────────────────────────────────
# import pandas as pd
# from pathlib import Path
#
# archivos = sorted(Path("datos_historicos").glob("posiciones_*.csv"))
# df = pd.concat((pd.read_csv(a, parse_dates=["posTime", "dataCtrTime"]) for a in archivos))
# catalogo = pd.read_csv("datos_historicos/catalogo_recursos.csv")
#
# df.groupby("hgExtName").agg(
#     posiciones=("posTime", "count"),
#     primera=("posTime", "min"),
#     ultima=("posTime", "max"),
#     vel_max=("speed", "max"),
# )
