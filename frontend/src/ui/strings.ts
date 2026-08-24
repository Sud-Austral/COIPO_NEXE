/** Textos de la UI, centralizados y SIEMPRE en español (CLAUDE.md §13). */

export const STRINGS = {
  app: {
    titulo: 'Visor Táctico de Flota Aérea',
    subtitulo: 'CONAF · Nexe AFF',
  },

  estados: {
    enRuta: 'En ruta',
    emitiendoTierra: 'Emitiendo en tierra',
    parado: 'Parado',
    sinSenal: 'Sin señal reciente',
    desconocido: 'Estado desconocido',
  },

  frescura: {
    live: 'En vivo',
    delayed: 'Con retraso',
    stale: 'Sin señal',
  },

  conexion: {
    conectado: 'Conectado',
    reintentando: 'Reintentando',
    detenido: 'Detenido',
    cargando: 'Conectando…',
  },

  statusBar: {
    ultimoDato: 'último dato',
    proximoPoll: 'próximo poll en',
    cursor: 'cursor',
    polls: 'polls',
    sinDatos: 'sin datos aún',
  },

  banners: {
    reintentando: (segundos: number) =>
      `Sin conexión con el servidor del visor — reintentando en ${segundos} s`,
    consultaRechazada:
      'El servidor rechazó la consulta: frontend y backend no coinciden. Actualización detenida (detalle técnico abajo).',
    modoSimulacion: 'MODO SIMULACIÓN — datos ficticios generados en el navegador',
    verDetalle: 'Detalle técnico',
  },

  fleetPanel: {
    titulo: 'Recursos',
    buscar: 'Buscar por alias o patente…',
    buscarLabel: 'Buscar recurso por alias o patente',
    recursos: (n: number) => (n === 1 ? '1 recurso' : `${n} recursos`),
    vacio:
      'Aún no llegan posiciones para este rango. Amplía el rango o verifica que la flota esté operando.',
    sinResultados: (filtro: string) => `Ningún recurso coincide con “${filtro}”.`,
    sinResultadosEstado: 'Ningún recurso en este estado ahora. Quita el filtro para ver toda la flota.',
    kpi: {
      enruta: 'En ruta',
      tierra: 'En tierra',
      parado: 'Parado',
      stale: 'Sin señal',
    },
    filtrarPor: (estado: string, n: number) => `Filtrar por estado: ${estado} (${n})`,
    quitarFiltro: (estado: string) => `Quitar filtro de estado: ${estado}`,
    trazas: 'Trazas',
    todas: 'Todas',
    ninguna: 'Ninguna',
    verTraza: 'Mostrar traza',
    ocultarTraza: 'Ocultar traza',
    centrarEn: (label: string) => `Centrar el mapa en ${label}`,
    fixInvalidos: (n: number) => `${n} fix inválidos`,
    abrirPanel: 'Mostrar lista de recursos',
    cerrarPanel: 'Ocultar lista de recursos',
  },

  detalle: {
    patente: 'Patente',
    modelo: 'Modelo',
    familia: 'Familia',
    compania: 'Compañía',
    fuente: 'Fuente',
    esn: 'ESN',
    posicion: 'Posición',
    ultimaPosicion: 'Última posición',
    llegadaServidor: 'Llegada al servidor',
    velocidad: 'Velocidad',
    altitud: 'Altitud (MSL)',
    rumbo: 'Rumbo',
    calidadGps: 'Calidad GPS',
  },

  rango: {
    titulo: 'Rango',
    ultimas2h: 'Últimas 2 h',
    ultimas6h: 'Últimas 6 h',
    desde: 'Desde',
    hasta: 'Hasta',
    consultar: 'Consultar histórico',
    consultando: 'Consultando…',
    volverEnVivo: 'Volver a en vivo',
    horaLocalNota: 'Fechas en hora de Chile',
    rangoInvalido: 'El inicio del rango debe ser anterior al fin.',
  },

  historico: {
    banner: (desde: string, hasta: string, n: number) =>
      `MODO HISTÓRICO — ${desde} → ${hasta} · ${n} posiciones`,
    truncado: (posiciones: number) =>
      `Rango muy denso: se muestran las primeras ${posiciones.toLocaleString('es-CL')} posiciones. Acota el rango para verlo completo.`,
    vacio: 'Sin posiciones en ese rango. Prueba con otras fechas.',
    error: 'La consulta histórica falló. Reintenta o acota el rango.',
  },

  exportar: {
    titulo: 'Exportar',
    geojson: 'GeoJSON',
    csv: 'CSV',
    ayudaGeojson: 'Descargar lo visible como GeoJSON (QGIS, kepler.gl)',
    ayudaCsv: 'Descargar lo visible como CSV',
  },

  alertas: {
    tituloRegion: 'Alertas de la flota',
    sinSenal: (label: string) => `${label} perdió señal (> 5 min sin reportar)`,
    recuperado: (label: string) => `${label} recuperó señal`,
    cerrar: 'Descartar alerta',
  },

  mapa: {
    atribucion:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
} as const
