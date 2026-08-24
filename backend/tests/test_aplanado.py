"""Aplanado de la respuesta real de Nexe.

Usa las MISMAS fixtures reales (anonimizadas) que los tests del frontend, en
frontend/tests/fixtures/: si Nexe cambia el contrato, ambos lados fallan a la vez.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.nexe.aplanado import (
    aplanar_coleccion,
    aplanar_feature,
    max_data_ctr_time,
    solo_metadatos,
    solo_posicion,
)

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures"


def _fixture(nombre: str) -> dict:
    return json.loads((FIXTURES / nombre).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def respuesta_get() -> dict:
    return _fixture("respuesta_get_real.json")


@pytest.fixture(scope="module")
def respuesta_lastpositions() -> dict:
    return _fixture("respuesta_lastpositions_real.json")


def _feature(**propiedades):
    """Feature mínima con coordenadas válidas, para probar casos borde."""
    base = {
        "esn": "X1",
        "posTime": "2026-07-08T12:00:00Z",
        "dataCtrTime": "2026-07-08T12:00:30Z",
    }
    base.update(propiedades)
    return {
        "type": "Feature",
        "properties": base,
        "geometry": {"type": "Point", "coordinates": [-71.5, -35.5]},
    }


class TestRespuestaGetReal:
    def test_aplana_las_cuatro_features_sin_descartes(self, respuesta_get):
        filas, descartadas = aplanar_coleccion(respuesta_get)
        assert len(filas) == 4
        assert descartadas == 0

    def test_invierte_las_coordenadas_geojson(self, respuesta_get):
        """geometry.coordinates viene [lon, lat] — el error clásico."""
        fila = aplanar_coleccion(respuesta_get)[0][0]
        assert fila["longitud"] == -71.542791
        assert fila["latitud"] == -32.946836

    def test_traduce_los_nombres_de_nexe(self, respuesta_get):
        fila = aplanar_coleccion(respuesta_get)[0][0]
        assert fila["esn"] == "860000000000001"
        assert fila["rumbo"] == 179  # cog
        assert fila["velocidad"] == 0.0  # spd, valor CRUDO sin convertir
        assert fila["fix_type"] == "2D"  # fix
        assert fila["src"] == "GPS"
        assert fila["pdop"] == 1.0
        assert fila["hg_ext_name"] == "Movil-A"

    def test_conserva_los_microsegundos_del_data_ctr_time(self, respuesta_get):
        """El cursor se compara con precisión de microsegundos: no se pueden perder."""
        fila = aplanar_coleccion(respuesta_get)[0][0]
        assert fila["data_ctr_time"] == datetime(
            2026, 6, 19, 0, 37, 9, 561041, tzinfo=timezone.utc
        )

    def test_los_tiempos_quedan_aware_en_utc(self, respuesta_get):
        fila = aplanar_coleccion(respuesta_get)[0][0]
        assert fila["pos_time"].tzinfo is not None
        assert fila["pos_time"].utcoffset().total_seconds() == 0

    def test_en_get_no_llegan_los_metadatos_del_recurso(self, respuesta_get):
        """Los hg* completos son exclusivos de get_lastpositions (§7.3)."""
        fila = aplanar_coleccion(respuesta_get)[0][0]
        assert fila["hg_asset"] is None
        assert fila["hg_navstate"] is None
        assert fila["hg_family_type"] is None


class TestRespuestaLastPositionsReal:
    def test_coerciona_hgnavstate_de_string_a_entero(self, respuesta_lastpositions):
        filas, _ = aplanar_coleccion(respuesta_lastpositions)
        movil = next(f for f in filas if f["esn"] == "860000000000002")
        assert movil["hg_navstate"] == 2  # llega como "2" en el JSON real

    def test_trae_los_metadatos_del_recurso(self, respuesta_lastpositions):
        filas, _ = aplanar_coleccion(respuesta_lastpositions)
        movil = next(f for f in filas if f["esn"] == "860000000000002")
        assert movil["hg_asset"] == "VG-XX01"
        assert movil["hg_asset_model"] == "Peugeot Boxer"
        assert movil["hg_asset_family"] == "Furgonetas"
        assert movil["hg_family_type"] == "ground"
        assert movil["hg_company"] == "CONAF"
        assert movil["unit_id"] == "VG-XX01"

    def test_separa_metadatos_y_posicion(self, respuesta_lastpositions):
        fila = aplanar_coleccion(respuesta_lastpositions)[0][0]
        metadatos, posicion = solo_metadatos(fila), solo_posicion(fila)
        assert "hg_asset" in metadatos and "latitud" not in metadatos
        assert "latitud" in posicion and "hg_asset" not in posicion
        assert metadatos["esn"] == posicion["esn"]


class TestCasosBorde:
    def test_descarta_features_sin_lo_esencial(self):
        sin_coordenadas = {
            "type": "Feature",
            "properties": {"esn": "X", "posTime": "2026-07-08T12:00:00Z"},
            "geometry": {"type": "Point", "coordinates": []},
        }
        sin_esn = _feature()
        del sin_esn["properties"]["esn"]

        assert aplanar_feature(sin_coordenadas) is None
        assert aplanar_feature(sin_esn) is None
        assert aplanar_feature({"properties": {}}) is None
        assert aplanar_feature("no soy una feature") is None

    def test_cuenta_los_descartes(self):
        coleccion = {"features": [_feature(), {"properties": {}}]}
        filas, descartadas = aplanar_coleccion(coleccion)
        assert len(filas) == 1 and descartadas == 1

    def test_sin_data_ctr_time_usa_pos_time(self):
        """Así el cursor nunca retrocede por un campo ausente."""
        fila = _feature()
        del fila["properties"]["dataCtrTime"]
        aplanada = aplanar_feature(fila)
        assert aplanada["data_ctr_time"] == aplanada["pos_time"]

    def test_pos_time_sin_microsegundos_tambien_parsea(self):
        fila = aplanar_feature(_feature(posTime="2026-06-19T00:37:02Z"))
        assert fila["pos_time"] == datetime(2026, 6, 19, 0, 37, 2, tzinfo=timezone.utc)

    @pytest.mark.parametrize(
        "propiedades, esperado",
        [({"alt": 832}, 832.0), ({"altitude": 640}, 640.0), ({}, None)],
    )
    def test_altitud_tolerante(self, propiedades, esperado):
        """La altitud no se ha observado nunca en datos reales (§2 PENDIENTE)."""
        assert aplanar_feature(_feature(**propiedades))["altitud"] == esperado

    def test_altitud_desde_la_tercera_coordenada(self):
        feature = _feature()
        feature["geometry"]["coordinates"] = [-71.5, -35.5, 915]
        assert aplanar_feature(feature)["altitud"] == 915.0

    @pytest.mark.parametrize("valor", ["3D", "2d", "Invalid"])
    def test_fix_normalizado(self, valor):
        assert aplanar_feature(_feature(fix=valor))["fix_type"] in {"3D", "2D", "Invalid"}

    def test_fix_desconocido_queda_nulo(self):
        assert aplanar_feature(_feature(fix="4D"))["fix_type"] is None

    def test_navstate_fuera_del_dominio_queda_nulo(self):
        """Nexe confirmó que solo existen 2, 4 y 5."""
        assert aplanar_feature(_feature(hgNavstate="7"))["hg_navstate"] is None

    def test_numeros_como_texto_se_coercionan(self):
        """pdop llega como 10.0 y spd como int en corridas reales."""
        fila = aplanar_feature(_feature(spd="33", pdop="10.0", cog="180"))
        assert fila["velocidad"] == 33.0
        assert fila["pdop"] == 10.0
        assert fila["rumbo"] == 180

    def test_respuesta_que_no_es_featurecollection(self):
        assert aplanar_coleccion({"detail": "Incorrect api key or JWT Token"}) == ([], 0)
        assert aplanar_coleccion(None) == ([], 0)


class TestMaxDataCtrTime:
    def test_devuelve_el_maximo(self):
        filas = [
            aplanar_feature(_feature(dataCtrTime="2026-07-08T12:00:00Z")),
            aplanar_feature(_feature(dataCtrTime="2026-07-08T12:05:00Z")),
            aplanar_feature(_feature(dataCtrTime="2026-07-08T12:02:00Z")),
        ]
        assert max_data_ctr_time(filas) == datetime(
            2026, 7, 8, 12, 5, 0, tzinfo=timezone.utc
        )

    def test_lista_vacia(self):
        assert max_data_ctr_time([]) is None
