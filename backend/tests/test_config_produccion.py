"""`validar_para_produccion()`: lo que impide desplegar (CLAUDE.md §6, guía 8 §11).

Regresión del agujero más caro que describe la guía: un fallo de datos que NO se
ve como tal. Con `NEXE_API_KEY` vacía el backend arrancaba, `/health` devolvía
200, el healthcheck de compose pasaba, `app` levantaba y el smoke test del
despliegue salía VERDE — con la base vacía y el visor sin flota. Estas pruebas
fijan que ese caso deje el arranque ROJO.
"""

from app.config import Settings

BASE_PRODUCCION = {
    "app_env": "production",
    "database_host": "172.31.2.40",
    "database_password": "una-contrasena-real",
    "nexe_api_key": "ce85bd6b-0000-0000-0000-000000000000",
}


def settings(**cambios) -> Settings:
    """Settings de producción válido, con los campos que pida el test cambiados.

    `_env_file=None` es imprescindible: sin él, pydantic-settings leería el .env
    del directorio de trabajo y el resultado dependería de la máquina.
    """
    return Settings(_env_file=None, **{**BASE_PRODUCCION, **cambios})


class TestProduccionValida:
    def test_configuracion_completa_no_reporta_problemas(self):
        assert settings().validar_para_produccion() == []

    def test_en_desarrollo_no_valida_nada(self):
        # Los defaults son cómodos en dev: la validación solo aplica en producción.
        flojo = Settings(_env_file=None, app_env="development")
        assert flojo.validar_para_produccion() == []


class TestNexeApiKey:
    def test_key_vacia_impide_arrancar(self):
        problemas = settings(nexe_api_key="").validar_para_produccion()
        assert any("NEXE_API_KEY" in p for p in problemas)

    def test_key_solo_espacios_impide_arrancar(self):
        # Un .env con `NEXE_API_KEY= ` es indistinguible de uno sin la variable.
        problemas = settings(nexe_api_key="   ").validar_para_produccion()
        assert any("NEXE_API_KEY" in p for p in problemas)

    def test_en_desarrollo_la_key_vacia_no_estorba(self):
        flojo = Settings(_env_file=None, app_env="development", nexe_api_key="")
        assert flojo.validar_para_produccion() == []


class TestBaseDeDatos:
    def test_contrasena_por_defecto_impide_arrancar(self):
        problemas = settings(database_password="coipo").validar_para_produccion()
        assert any("DATABASE_PASSWORD" in p for p in problemas)

    def test_host_de_desarrollo_impide_arrancar(self):
        problemas = settings(database_host="postgres-dev").validar_para_produccion()
        assert any("DATABASE_HOST" in p for p in problemas)

    def test_se_reportan_TODOS_los_problemas_de_una_vez(self):
        # Que no haya que desplegar tres veces para descubrir tres variables mal.
        problemas = settings(
            database_password="coipo", database_host="localhost", nexe_api_key=""
        ).validar_para_produccion()
        assert len(problemas) == 3
