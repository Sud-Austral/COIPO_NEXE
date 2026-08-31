# PROJECT EVIDENCE CONTEXT
PROJECT=target
FILES=114
GENERATED=2026-08-31T19:17:13.980260

## EVIDENCE_POLICY

This context contains repository evidence.
Signals are not guaranteed business features.
Do not infer unsupported functionality.
Prefer explicit files, dependencies and source evidence.
If evidence is insufficient, omit the claim.

## STACK
LANG=Python,TypeScript,CSS,React+TS,Markdown,JSON,YAML,HTML,Shell,Text,INI,SQL
TECH=Docker[high],Express[low],FastAPI[high],Leaflet[high],Node.js[high],Pandas[low],PostgreSQL[high],React[high],SQLAlchemy[high],Tailwind[low],Vite[high],Vue[low]

## STRUCTURE
ROOTS=frontend(60),backend(26),INSUMO(5),INSUMO_PRODUCCION(5),collector(4),.github(3),descargar_historico_nexe.py(1),docker-compose.dev.yml(1),CLAUDE.md(1),.gitignore(1),.gitattributes(1),docker-compose.yml(1),README.md(1),.env.example(1),.dockerignore(1),db(1),.claude(1)

## KEY_FILES
backend/Dockerfile,collector/Dockerfile,docker-compose.yml,frontend/Dockerfile,backend/requirements.txt,frontend/package.json,.env.example,README.md,frontend/.env.example,frontend/README.md,frontend/package-lock.json,.github/workflows/deploy-prod.yml,db/schema.sql,docker-compose.dev.yml,frontend/vite.config.ts,.dockerignore,.github/workflows/despliegue-pages.yml,.github/workflows/readme.yml,INSUMO_PRODUCCION/DOCKER.md,INSUMO_PRODUCCION/fastapi-postgresql-conexion.md,INSUMO_PRODUCCION/guia-8-prompt-checklist-pre-deploy.md,backend/app/config.py,backend/app/db/__init__.py,backend/app/db/bootstrap.py,backend/app/db/consultas.py,backend/app/db/session.py,backend/app/main.py,backend/app/routers/__init__.py,backend/app/routers/comun.py,backend/app/routers/estado.py,backend/app/routers/exportar.py,backend/app/routers/posiciones.py,backend/app/routers/recursos.py,backend/app/routers/salud.py,collector/docker-entrypoint.sh,frontend/src/api/client.ts,frontend/src/api/parse.ts,frontend/tsconfig.json

## API_EVIDENCE
GET /api/recursos [backend/app/routers/recursos.py:24]
GET /api/recursos/{esn} [backend/app/routers/recursos.py:35]
GET /health [backend/app/routers/salud.py:17]
GET /api/posiciones/incremental [backend/app/routers/posiciones.py:28]
GET /api/posiciones [backend/app/routers/posiciones.py:57]
GET /api/estado-ingesta [backend/app/routers/estado.py:28]
GET /api/exportar [backend/app/routers/exportar.py:28]
FETCH ${API_BASE}/${ruta}${sufijo} [frontend/src/api/client.ts:67]

## DATABASE_EVIDENCE
posicion [db/schema.sql:34]
recurso [db/schema.sql:75]
estado_ingesta [db/schema.sql:106]
usando [db/schema.sql:66]
compara [db/schema.sql:101]
estado_ingesta [db/schema.sql:118]

## ENV_EVIDENCE
NEXE_API_KEY [descargar_historico_nexe.py:73]
NEXE_BASE_URL [descargar_historico_nexe.py:92]
SCHEMA_SQL_PATH [backend/app/db/bootstrap.py:35]
VITE_API_BASE [frontend/src/api/client.ts:36]
VITE_DEMO [frontend/src/api/client.ts:43]

## CAPABILITY_SIGNALS
Autenticación [confidence=medium]
  logout [CLAUDE.md:1202]
  auth [CLAUDE.md:364]
  jwt [CLAUDE.md:34]
  token [CLAUDE.md:34]
  jwt [backend/tests/test_paginacion.py:183]
  token [backend/tests/test_paginacion.py:183]
  jwt [backend/tests/test_aplanado.py:182]
  token [backend/tests/test_aplanado.py:182]
Mapas / cartografía [confidence=medium]
  leaflet [CLAUDE.md:177]
  mapa [CLAUDE.md:177]
  mapa [backend/app/nexe/aplanado.py:123]
  mapa [INSUMO/plataforma_monitorizacion_mock.html:223]
  mapa [INSUMO/analisis_incidente_mock.html:210]
  leaflet [frontend/package.json:17]
  leaflet [frontend/package-lock.json:11]
  leaflet [frontend/src/main.tsx:3]
Exportación [confidence=medium]
  csv [descargar_historico_nexe.py:4]
  export [CLAUDE.md:211]
  exportar [CLAUDE.md:211]
  csv [CLAUDE.md:197]
  export [backend/app/main.py:21]
  exportar [backend/app/main.py:21]
  csv [backend/app/servicios/__init__.py:1]
  export [backend/app/servicios/geojson.py:6]
Carga de archivos [confidence=medium]
  archivo [descargar_historico_nexe.py:4]
  file [descargar_historico_nexe.py:39]
  file [docker-compose.dev.yml:5]
  archivo [CLAUDE.md:3]
  file [CLAUDE.md:203]
  document [CLAUDE.md:98]
  archivo [docker-compose.yml:6]
  file [docker-compose.yml:6]
Reportes / analítica [confidence=medium]
  report [CLAUDE.md:46]
  reporte [CLAUDE.md:397]
  dashboard [CLAUDE.md:954]
  analytics [CLAUDE.md:1286]
  report [INSUMO/revision_postincidente_mock.html:54]
  report [INSUMO/revision_postincidente_mock_1.html:54]
  report [frontend/src/domain/fleet.ts:150]
  reporte [frontend/src/domain/fleet.ts:150]
Procesamiento de datos [confidence=medium]
  pandas [descargar_historico_nexe.py:3]
  etl [collector/ingesta.py:46]
  etl [backend/app/main.py:26]
  etl [backend/app/nexe/cliente.py:30]
  etl [backend/app/db/bootstrap.py:18]
  pandas [backend/app/routers/exportar.py:5]

## PYTHON
descargar_historico_nexe.py|F=leer_api_key,leer_base_url,zona_chile,escribir_csv,descargar_dia,descargar_catalogo,main|I=__future__,argparse,csv,os,sys,time,datetime,pathlib,app.nexe,zoneinfo
collector/ingesta.py|F=guardar_filas,cursor_persistido,una_pasada,corrida,_registrar_fallo|I=__future__,logging,sys,time,datetime,sqlalchemy,sqlalchemy.orm,app.config,app.db,app.db.session,app.nexe.aplanado,app.nexe.cliente
backend/app/main.py|F=lifespan|I=logging,contextlib,fastapi,config,db,db.session,routers
backend/app/config.py|C=Settings|F=sqlalchemy_database_url,validar_para_produccion,advertencias|I=pydantic_settings
backend/app/nexe/__init__.py|I=aplanado,cliente
backend/app/nexe/cliente.py|C=NexeError,ClaveRechazada,ContratoRechazado,NexeNoDisponible,Pagina,ClienteNexe|F=iso_utc,cuerpo_data_request,__init__,llena,__init__,_post,pagina_desde,paginas_desde,ultimas_posiciones|I=__future__,logging,time,dataclasses,datetime,typing,aplanado,requests
backend/app/nexe/aplanado.py|F=_como_texto,_como_numero,_como_entero,_como_datetime,_como_fix,_como_navstate,aplanar_feature,aplanar_coleccion,solo_metadatos,solo_posicion,max_data_ctr_time|I=__future__,datetime,typing
backend/app/servicios/geojson.py|F=iso,fila_a_feature,coleccion|I=__future__,datetime,typing
backend/app/servicios/tabular.py|F=a_csv|I=__future__,csv,io,typing,geojson
backend/app/db/session.py|F=get_db|I=sqlalchemy,sqlalchemy.orm,config
backend/app/db/bootstrap.py|F=_ruta_esquema,ensure_schema|I=logging,os,pathlib,sqlalchemy
backend/app/db/consultas.py|F=_filas,posiciones_incremental,posiciones_por_rango,ultima_posicion_por_recurso,recurso_por_esn,estado_ingesta,resumen,ping|I=__future__,datetime,typing,sqlalchemy,sqlalchemy.orm
backend/app/routers/recursos.py|F=listar,detalle|I=__future__,typing,fastapi,sqlalchemy.orm,db,db.session,servicios
backend/app/routers/salud.py|F=health|I=fastapi,sqlalchemy.orm,db,db.session
backend/app/routers/posiciones.py|F=incremental,por_rango|I=__future__,datetime,typing,fastapi,sqlalchemy.orm,db,db.session,servicios,comun
backend/app/routers/estado.py|F=estado_ingesta|I=__future__,datetime,typing,fastapi,sqlalchemy.orm,db,db.session,servicios.geojson
backend/app/routers/comun.py|F=como_utc,validar_rango|I=__future__,datetime,fastapi
backend/app/routers/exportar.py|F=exportar|I=__future__,json,datetime,fastapi,fastapi.responses,sqlalchemy.orm,db,db.session,servicios,comun
backend/tests/test_contrato_nexe.py|C=TestIsoUtc,TestCuerpoDataRequest,TestDomain|F=test_formato_con_milisegundos_y_z,test_convierte_desde_otra_zona,test_conserva_los_milisegundos,test_los_tres_campos_raiz,test_type_literal_exacto,test_nunca_produce_listas_vacias,test_data_center_completo,test_msg_request_completo_y_con_el_filtro,test_acepta_el_cursor_ya_como_texto,test_req_time_es_la_hora_de_la_solicitud,test_sin_domain_el_parametro_no_va,test_domain_va_como_lista|I=re,datetime,pytest,app.nexe.cliente
backend/tests/test_paginacion.py|C=RespuestaFalsa,SesionFalsa,TestPaginacion,TestCabeceras,TestErrores,TestUltimasPosiciones|F=feature,coleccion,cliente,cursores_pedidos,__init__,json,__init__,post,test_pagina_llena_seguida_de_corta,test_la_segunda_pagina_pide_desde_el_maximo_de_la_primera,test_una_sola_pagina_corta_no_pide_mas,test_respuesta_vacia_termina_la_iteracion,test_cursor_que_no_avanza_no_provoca_bucle_infinito,test_respeta_el_tope_de_paginas_por_corrida,test_las_filas_vienen_ya_aplanadas,test_inyecta_la_api_key,test_url_del_endpoint,test_exige_api_key|I=datetime,pytest,app.nexe.cliente
backend/tests/test_aplanado.py|C=TestRespuestaGetReal,TestRespuestaLastPositionsReal,TestCasosBorde,TestMaxDataCtrTime|F=_fixture,respuesta_get,respuesta_lastpositions,_feature,test_aplana_las_cuatro_features_sin_descartes,test_invierte_las_coordenadas_geojson,test_traduce_los_nombres_de_nexe,test_conserva_los_microsegundos_del_data_ctr_time,test_los_tiempos_quedan_aware_en_utc,test_en_get_no_llegan_los_metadatos_del_recurso,test_coerciona_hgnavstate_de_string_a_entero,test_trae_los_metadatos_del_recurso,test_separa_metadatos_y_posicion,test_descarta_features_sin_lo_esencial,test_cuenta_los_descartes,test_sin_data_ctr_time_usa_pos_time,test_pos_time_sin_microsegundos_tambien_parsea,test_altitud_tolerante|I=json,datetime,pathlib,pytest,app.nexe.aplanado

## COMPONENTS
frontend/src/App.tsx:App
frontend/src/domain/fleet.ts:MAX_TRAIL_PUNTOS,MAX_TRAIL_MS,UMBRAL_LIVE_S,UMBRAL_DELAYED_S,CAMPOS_META
frontend/src/demo/simuladorNexe.ts:PASO_REPORTE_MS,LIMITE_RESPUESTA,FLOTA
frontend/src/ui/estadoVisual.ts:TEXTO_ESTADO,ICONO_ESTADO,COLOR_ESTADO
frontend/src/ui/strings.ts:STRINGS
frontend/src/hooks/usePolling.ts:POLL_INTERVAL_MS,BACKOFF_MS,TICK_FRESCURA_MS,MAX_TANDAS_POR_CICLO,ESTADO_INICIAL
frontend/src/hooks/useAlertas.ts:EXPIRACION_MS,MAX_ALERTAS
frontend/src/hooks/useHistorico.ts:LIMITE_HISTORICO,ESTADO_INICIAL
frontend/src/api/parse.ts:CLAVES_CANDIDATAS,ALIAS
frontend/src/api/client.ts:API_BASE,MODO_DEMO
frontend/src/components/FleetPanel/FleetPanel.tsx:TILES,FleetPanel,Icono
frontend/src/components/EstadoChip/EstadoChip.tsx:EstadoChip,Icono
frontend/src/components/StatusBar/StatusBar.tsx:StatusBar
frontend/src/components/ResourceDetail/MiniGrafico.tsx:ANCHO,ALTO,MARGEN,MiniGrafico
frontend/src/components/ResourceDetail/ResourceDetail.tsx:ResourceDetail
frontend/src/components/TimeRangeBar/TimeRangeBar.tsx:PRESETS,TimeRangeBar
frontend/src/components/Alertas/Alertas.tsx:Alertas
frontend/src/components/MapView/MapView.tsx:CENTRO_INICIAL,ZOOM_INICIAL,ZOOM_SEGUIMIENTO,CentrarEnSeleccion,MapView
frontend/src/lib/exportar.ts:COLUMNAS
frontend/src/lib/format.ts:ZONA_CHILE,MS_A_KMH,MS_A_NUDOS
frontend/tests/usePolling.test.ts:T0,CURSOR_INICIAL
frontend/tests/alertas.test.ts:AHORA
frontend/tests/useHistorico.test.ts:DESDE,HASTA
frontend/tests/fleet.test.ts:BASE_MS
frontend/tests/FleetPanel.test.tsx:FLOTA

## EXISTING_README
# COIPO_NEXE

## DEPLOYMENT_FILES
.dockerignore,.github/workflows/deploy-prod.yml,.github/workflows/despliegue-pages.yml,.github/workflows/readme.yml,INSUMO_PRODUCCION/DOCKER.md,INSUMO_PRODUCCION/guia-8-prompt-checklist-pre-deploy.md,backend/Dockerfile,collector/Dockerfile,collector/docker-entrypoint.sh,docker-compose.dev.yml,docker-compose.yml,frontend/Dockerfile

## README_RULES

Generate README.md only from repository evidence.
Do not invent features.
Do not invent technologies.
Do not invent endpoints.
Do not invent database tables.
Do not invent environment variables.
Do not invent commands.
Do not infer production architecture from filenames alone.
Treat capability signals as signals, not confirmed features.
Prefer explicit source evidence.
Omit unsupported sections.