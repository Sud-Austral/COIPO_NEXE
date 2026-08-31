"""Paginación por dataCtrTime y manejo de errores del cliente Nexe.

Sin red: se inyecta una sesión falsa. Cubre el límite de 1000 posiciones por
respuesta, que el cursor nunca retroceda, y la distinción entre los tres fallos
(401 humano / 422 contrato / 5xx transitorio).
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.nexe.cliente import (
    UMBRAL_PAGINA_LLENA,
    ClaveRechazada,
    ClienteNexe,
    ContratoRechazado,
    NexeNoDisponible,
)

INICIO = datetime(2026, 6, 19, 0, 0, 0, tzinfo=timezone.utc)


class RespuestaFalsa:
    def __init__(self, status_code: int, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


class SesionFalsa:
    """Doble de requests.Session: sirve respuestas en orden y registra las llamadas."""

    def __init__(self, respuestas):
        self._respuestas = list(respuestas)
        self.llamadas = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.llamadas.append({"url": url, "cuerpo": json, "cabeceras": headers})
        if not self._respuestas:
            return RespuestaFalsa(200, coleccion([]))
        siguiente = self._respuestas.pop(0)
        return siguiente() if callable(siguiente) else siguiente


def feature(esn: str, segundos: int):
    momento = INICIO + timedelta(seconds=segundos)
    iso = momento.strftime("%Y-%m-%dT%H:%M:%SZ")
    llegada = (momento + timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    return {
        "type": "Feature",
        "properties": {"esn": esn, "posTime": iso, "dataCtrTime": llegada},
        "geometry": {"type": "Point", "coordinates": [-71.5, -35.5]},
    }


def coleccion(features):
    return {"type": "FeatureCollection", "dataInfo": [], "features": features}


def cliente(respuestas, **extra):
    sesion = SesionFalsa(respuestas)
    dormidas = []
    instancia = ClienteNexe(
        "https://staging.nexe.online/api/v1/monitor",
        "clave-de-prueba",
        sesion=sesion,
        dormir=dormidas.append,
        **extra,
    )
    return instancia, sesion, dormidas


def cursores_pedidos(sesion: SesionFalsa) -> list[str]:
    return [c["cuerpo"]["msgRequest"][0]["dataCtrTime"] for c in sesion.llamadas]


class TestPaginacion:
    def test_pagina_llena_seguida_de_corta(self):
        """El límite real son 1000 por respuesta: hay que pedir la siguiente."""
        llena = coleccion([feature("A", i) for i in range(UMBRAL_PAGINA_LLENA + 50)])
        corta = coleccion([feature("A", 5000)])
        api, sesion, _ = cliente([RespuestaFalsa(200, llena), RespuestaFalsa(200, corta)])

        paginas = list(api.paginas_desde(INICIO))

        assert len(paginas) == 2
        assert paginas[0].llena is True
        assert paginas[1].llena is False
        assert len(sesion.llamadas) == 2

    def test_la_segunda_pagina_pide_desde_el_maximo_de_la_primera(self):
        llena = coleccion([feature("A", i) for i in range(UMBRAL_PAGINA_LLENA + 50)])
        api, sesion, _ = cliente(
            [RespuestaFalsa(200, llena), RespuestaFalsa(200, coleccion([]))]
        )

        paginas = list(api.paginas_desde(INICIO))

        pedidos = cursores_pedidos(sesion)
        assert pedidos[0] == "2026-06-19T00:00:00.000Z"
        # el cursor de la 1ª página es el máximo dataCtrTime que trajo
        assert pedidos[1] == paginas[0].cursor.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        assert pedidos[1] > pedidos[0]

    def test_una_sola_pagina_corta_no_pide_mas(self):
        api, sesion, _ = cliente([RespuestaFalsa(200, coleccion([feature("A", 1)]))])
        assert len(list(api.paginas_desde(INICIO))) == 1
        assert len(sesion.llamadas) == 1

    def test_respuesta_vacia_termina_la_iteracion(self):
        api, sesion, _ = cliente([RespuestaFalsa(200, coleccion([]))])
        paginas = list(api.paginas_desde(INICIO))
        assert len(paginas) == 1
        assert paginas[0].filas == [] and paginas[0].cursor is None
        assert len(sesion.llamadas) == 1

    def test_cursor_que_no_avanza_no_provoca_bucle_infinito(self):
        """Si Nexe devuelve siempre lo mismo, la iteración debe cortar."""
        misma = coleccion([feature("A", i) for i in range(UMBRAL_PAGINA_LLENA + 10)])
        api, sesion, _ = cliente([lambda: RespuestaFalsa(200, misma)] * 10)

        paginas = list(api.paginas_desde(INICIO))

        assert len(paginas) == 2  # la 1ª trae datos; la 2ª repite y se detecta
        assert len(sesion.llamadas) == 2

    def test_respeta_el_tope_de_paginas_por_corrida(self):
        llena = coleccion([feature("A", i) for i in range(UMBRAL_PAGINA_LLENA + 50)])
        # cada llamada devuelve una página llena con dataCtrTime creciente
        contador = {"n": 0}

        def siguiente():
            contador["n"] += 1
            desplazamiento = contador["n"] * 10_000
            return RespuestaFalsa(
                200,
                coleccion(
                    [
                        feature("A", desplazamiento + i)
                        for i in range(UMBRAL_PAGINA_LLENA + 50)
                    ]
                ),
            )

        api, sesion, _ = cliente([siguiente] * 20)
        paginas = list(api.paginas_desde(INICIO, max_paginas=3))
        assert len(paginas) == 3
        assert len(sesion.llamadas) == 3
        assert llena is not None  # el tope no depende del contenido

    def test_las_filas_vienen_ya_aplanadas(self):
        api, _, _ = cliente([RespuestaFalsa(200, coleccion([feature("A", 0)]))])
        pagina = api.pagina_desde(INICIO)
        assert pagina.filas[0]["esn"] == "A"
        assert pagina.filas[0]["latitud"] == -35.5
        assert pagina.crudas == 1


class TestCabeceras:
    def test_inyecta_la_api_key(self):
        api, sesion, _ = cliente([RespuestaFalsa(200, coleccion([]))])
        api.pagina_desde(INICIO)
        assert sesion.llamadas[0]["cabeceras"]["api-key"] == "clave-de-prueba"
        assert sesion.llamadas[0]["cabeceras"]["Content-Type"] == "application/json"

    def test_url_del_endpoint(self):
        api, sesion, _ = cliente([RespuestaFalsa(200, coleccion([]))])
        api.pagina_desde(INICIO)
        assert sesion.llamadas[0]["url"].endswith("/position/affjson/get")

    def test_exige_api_key(self):
        with pytest.raises(ValueError):
            ClienteNexe("https://x", "", sesion=SesionFalsa([]))


class TestErrores:
    def test_401_no_se_reintenta(self):
        """Una key rotada es un arreglo humano: reintentar solo gasta llamadas."""
        api, sesion, dormidas = cliente(
            [RespuestaFalsa(401, text='{"detail": "Incorrect api key or JWT Token"}')]
        )
        with pytest.raises(ClaveRechazada):
            api.pagina_desde(INICIO)
        assert len(sesion.llamadas) == 1
        assert dormidas == []

    def test_422_no_se_reintenta_y_conserva_el_detalle(self):
        detalle = '{"detail":[{"loc":["body","msgRequest"],"msg":"Field required"}]}'
        api, sesion, _ = cliente([RespuestaFalsa(422, text=detalle)])
        with pytest.raises(ContratoRechazado) as error:
            api.pagina_desde(INICIO)
        assert "Field required" in error.value.detalle
        assert len(sesion.llamadas) == 1

    def test_500_reintenta_con_backoff_y_luego_falla(self):
        api, sesion, dormidas = cliente(
            [lambda: RespuestaFalsa(500, text="Internal Server Error")] * 6
        )
        with pytest.raises(NexeNoDisponible):
            api.pagina_desde(INICIO)
        assert len(sesion.llamadas) == 4  # 1 intento + 3 reintentos
        assert dormidas == [5, 10, 20]

    def test_500_transitorio_se_recupera(self):
        api, sesion, dormidas = cliente(
            [
                RespuestaFalsa(500, text="Internal Server Error"),
                RespuestaFalsa(200, coleccion([feature("A", 0)])),
            ]
        )
        pagina = api.pagina_desde(INICIO)
        assert len(pagina.filas) == 1
        assert len(sesion.llamadas) == 2
        assert dormidas == [5]

    def test_error_de_red_tambien_reintenta(self):
        def revienta():
            raise OSError("connection reset")

        api, sesion, dormidas = cliente([revienta, revienta, revienta, revienta])
        with pytest.raises(NexeNoDisponible):
            api.pagina_desde(INICIO)
        assert len(sesion.llamadas) == 4
        assert dormidas == [5, 10, 20]


class TestUltimasPosiciones:
    def test_devuelve_filas_con_metadatos(self):
        propiedades = {
            "esn": "B",
            "posTime": "2026-06-27T23:16:22Z",
            "dataCtrTime": "2026-06-27T23:16:30.931336Z",
            "hgExtName": "Movil-B",
            "hgAsset": "VG-XX01",
            "hgNavstate": "2",
            "hgFamilyType": "ground",
        }
        respuesta = coleccion(
            [
                {
                    "type": "Feature",
                    "properties": propiedades,
                    "geometry": {"type": "Point", "coordinates": [-71.5, -33.0]},
                }
            ]
        )
        api, sesion, _ = cliente([RespuestaFalsa(200, respuesta)])

        filas = api.ultimas_posiciones(INICIO)

        assert sesion.llamadas[0]["url"].endswith("/position/affjson/get_lastpositions")
        assert filas[0]["hg_asset"] == "VG-XX01"
        assert filas[0]["hg_navstate"] == 2
        assert filas[0]["hg_family_type"] == "ground"
