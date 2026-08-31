"""El body de Nexe: forma exacta del ejemplo oficial (CLAUDE.md §7.2).

Estos tests son regresiones directas de errores reales del servidor: 422 por campos
omitidos, y 500 por listas vacías.
"""

import re
from datetime import datetime, timedelta, timezone

import pytest

from app.nexe.cliente import PLACEHOLDER, cuerpo_data_request, iso_utc

CURSOR = datetime(2026, 6, 19, 0, 0, 0, tzinfo=timezone.utc)
FORMATO_NEXE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


class TestIsoUtc:
    def test_formato_con_milisegundos_y_z(self):
        assert FORMATO_NEXE.match(iso_utc(CURSOR))
        assert iso_utc(CURSOR) == "2026-06-19T00:00:00.000Z"

    def test_convierte_desde_otra_zona(self):
        """La UI trabaja en hora de Chile; el intercambio es siempre UTC (§14.9)."""
        chile = timezone(timedelta(hours=-4))
        momento = datetime(2026, 7, 8, 10, 0, 0, tzinfo=chile)
        assert iso_utc(momento) == "2026-07-08T14:00:00.000Z"

    def test_conserva_los_milisegundos(self):
        con_micro = CURSOR.replace(microsecond=561041)
        assert iso_utc(con_micro) == "2026-06-19T00:00:00.561Z"


class TestCuerpoDataRequest:
    def test_los_tres_campos_raiz(self):
        cuerpo = cuerpo_data_request(CURSOR)
        assert set(cuerpo) == {"type", "dataCenter", "msgRequest"}

    def test_type_literal_exacto(self):
        assert cuerpo_data_request(CURSOR)["type"] == "dataRequest"

    def test_nunca_produce_listas_vacias(self):
        """Regresión del 500 real: dataCenter/msgRequest vacíos rompen el servidor."""
        cuerpo = cuerpo_data_request(CURSOR)
        assert len(cuerpo["dataCenter"]) == 1
        assert len(cuerpo["msgRequest"]) == 1

    def test_data_center_completo(self):
        """Los tres campos son obligatorios: omitirlos da 422 Field required."""
        item = cuerpo_data_request(CURSOR)["dataCenter"][0]
        assert set(item) == {"affVer", "name", "reqTime"}
        assert item["affVer"] == PLACEHOLDER
        assert item["name"] == PLACEHOLDER
        assert FORMATO_NEXE.match(item["reqTime"])

    def test_msg_request_completo_y_con_el_filtro(self):
        item = cuerpo_data_request(CURSOR)["msgRequest"][0]
        assert set(item) == {"to", "from", "msgType", "dataCtrTime"}
        assert item["to"] == item["from"] == item["msgType"] == PLACEHOLDER
        assert item["dataCtrTime"] == "2026-06-19T00:00:00.000Z"

    def test_acepta_el_cursor_ya_como_texto(self):
        """El collector persiste el cursor y lo reinyecta tal cual."""
        crudo = "2026-06-19T00:37:09.561041Z"
        assert cuerpo_data_request(crudo)["msgRequest"][0]["dataCtrTime"] == crudo

    def test_req_time_es_la_hora_de_la_solicitud(self):
        ahora = datetime(2026, 7, 8, 15, 30, 0, tzinfo=timezone.utc)
        cuerpo = cuerpo_data_request(CURSOR, ahora=ahora)
        assert cuerpo["dataCenter"][0]["reqTime"] == "2026-07-08T15:30:00.000Z"
        # el filtro y la hora de la solicitud son cosas distintas
        assert cuerpo["msgRequest"][0]["dataCtrTime"] != cuerpo["dataCenter"][0]["reqTime"]


class TestDomain:
    def test_sin_domain_el_parametro_no_va(self):
        """Indicación explícita de Nexe: si no se filtra, eliminarlo de la llamada."""
        assert "domain" not in cuerpo_data_request(CURSOR)["msgRequest"][0]

    @pytest.mark.parametrize("familias", [["ground"], ["rotary", "fixed"]])
    def test_domain_va_como_lista(self, familias):
        """Con string devuelve 422 'Input should be a valid list'."""
        item = cuerpo_data_request(CURSOR, domain=familias)["msgRequest"][0]
        assert item["domain"] == familias
