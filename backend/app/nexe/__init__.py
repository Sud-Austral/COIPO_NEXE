"""Integración con Nexe (AFF JSON): cliente HTTP y aplanado de la respuesta.

Este paquete es el único que habla el vocabulario de Nexe. Lo importan el collector
(`collector/ingesta.py`) y el extractor batch (`descargar_historico_nexe.py`); el
backend NO lo usa: sirve exclusivamente desde nuestra base de datos.
"""

from .aplanado import (
    CAMPOS_POSICION,
    CAMPOS_RECURSO,
    aplanar_coleccion,
    aplanar_feature,
    max_data_ctr_time,
    solo_metadatos,
    solo_posicion,
)
from .cliente import (
    ClaveRechazada,
    ClienteNexe,
    ContratoRechazado,
    NexeError,
    NexeNoDisponible,
    Pagina,
    cuerpo_data_request,
    iso_utc,
)

__all__ = [
    "CAMPOS_POSICION",
    "CAMPOS_RECURSO",
    "ClaveRechazada",
    "ClienteNexe",
    "ContratoRechazado",
    "NexeError",
    "NexeNoDisponible",
    "Pagina",
    "aplanar_coleccion",
    "aplanar_feature",
    "cuerpo_data_request",
    "iso_utc",
    "max_data_ctr_time",
    "solo_metadatos",
    "solo_posicion",
]
