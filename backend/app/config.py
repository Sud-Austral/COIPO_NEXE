"""Configuración del backend y del collector (comparten el mismo `.env`).

Sigue `INSUMO_PRODUCCION2/fastapi-postgresql-conexion.md`: cinco variables de conexión
SEPARADAS, nunca una `DATABASE_URL` armada desde el entorno.

`NEXE_API_KEY` la usa EXCLUSIVAMENTE el collector: el backend nunca habla con Nexe
(sirve desde nuestra base). Vive aquí porque ambos procesos leen el mismo archivo.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    # ── Postgres compartido (172.31.2.40 en producción) ──────────────────────
    database_host: str = "localhost"
    database_port: int = 5432
    database_user: str = "coipo"
    database_password: str = "coipo"
    database_name: str = "coipo_nexe"

    # ── Nexe (solo el collector) ─────────────────────────────────────────────
    nexe_base_url: str = "https://staging.nexe.online/api/v1/monitor"
    nexe_api_key: str = ""
    # El paso a producción es SOLO cambiar nexe_base_url (confirmado por Nexe).

    # ── Ingesta ──────────────────────────────────────────────────────────────
    # supercronic no baja de 1 minuto; con esto una corrida hace N pasadas
    # espaciadas. Afecta la LATENCIA, nunca la completitud: el cursor por
    # dataCtrTime no pierde nada entre pasadas (CLAUDE.md §7.4).
    collector_pasadas_por_minuto: int = 1
    # Tope de páginas de /get por pasada. Lo que no entre queda para la siguiente.
    collector_max_paginas: int = 20
    # Ventana hacia atrás para get_lastpositions: 14 días es el almacenamiento
    # mínimo del estándar AFF, y la copia de staging corre días detrás del presente.
    collector_lookback_dias: int = 14
    # Punto de partida la PRIMERA vez (cursor vacío en estado_ingesta).
    collector_arranque_dias: int = 14

    # ── Ambiente ─────────────────────────────────────────────────────────────
    app_env: str = "development"  # "development" | "production"

    @property
    def sqlalchemy_database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.database_user}:{self.database_password}"
            f"@{self.database_host}:{self.database_port}/{self.database_name}"
        )

    def validar_para_produccion(self) -> list[str]:
        """Problemas que impiden desplegar (lista vacía = OK).

        Existe porque los defaults son cómodos en dev y peligrosos en producción, y
        sin esto el contenedor arranca igual y falla más tarde de forma opaca.
        """
        problemas: list[str] = []
        if self.app_env != "production":
            return problemas
        if self.database_password in ("", "coipo"):
            problemas.append(
                "DATABASE_PASSWORD tiene el valor por defecto de desarrollo."
            )
        if self.database_host in ("localhost", "postgres-dev"):
            problemas.append(
                "DATABASE_HOST apunta a un Postgres de desarrollo, no al compartido."
            )
        if not self.nexe_api_key.strip():
            # Sin esto el despliegue queda VERDE con la base vacía: el backend
            # arranca, /health da 200 y el smoke test pasa, mientras el collector
            # aborta cada corrida y el visor pinta un mapa sin flota (guía 8 §11).
            problemas.append(
                "NEXE_API_KEY vacía: el collector no puede ingerir de Nexe."
            )
        return problemas

    def advertencias(self) -> list[str]:
        """Riesgos que NO impiden arrancar pero deben verse en cada arranque."""
        avisos: list[str] = []
        if "staging" in self.nexe_base_url and self.app_env == "production":
            avisos.append(
                "NEXE_BASE_URL apunta a STAGING en un despliegue de producción: los "
                "datos son una copia que corre días detrás del presente."
            )
        return avisos


settings = Settings()
