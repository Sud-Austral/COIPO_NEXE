/**
 * Mapa Leaflet: marcadores rotados por heading con pulso de frescura y trails
 * por ESN coloreadas por estado (CLAUDE.md §10.2, §11 MVP-2/4).
 *
 * La ficha del recurso NO se pinta acá: es un panel flotante que monta App sobre
 * el área del mapa. Un `<Popup>` de Leaflet vive dentro del pane transformado y
 * se arrastra con el mapa, que es justo lo que no se quiere.
 */
import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from 'react-leaflet'
import type { FleetResource } from '../../domain/types'
import { estadoVisual, TEXTO_ESTADO, type EstadoVisual } from '../../ui/estadoVisual'
import { STRINGS } from '../../ui/strings'
import { iconoRecurso } from './marcador'
import './marcadores.css'
import styles from './MapView.module.css'

const CENTRO_INICIAL: [number, number] = [-35.8, -71.9] // zona centro-sur de Chile
const ZOOM_INICIAL = 7
const ZOOM_SEGUIMIENTO = 11
/** Ancho de la ficha flotante + su margen (ResourceDetail.module.css `.panel`). */
const ANCHO_FICHA = 352

interface Props {
  recursos: FleetResource[]
  seleccionado: string | null
  onSeleccionar: (esn: string) => void
  trailsVisibles: ReadonlySet<string>
  /** La ficha tapa una franja a la izquierda: el vuelo la compensa. */
  fichaAbierta: boolean
}

/** Vuela hacia el recurso cuando cambia la selección (no en cada poll). */
function CentrarEnSeleccion({
  recurso,
  fichaAbierta,
}: {
  recurso: FleetResource | null
  fichaAbierta: boolean
}) {
  const mapa = useMap()
  const esn = recurso?.esn ?? null
  useEffect(() => {
    if (!recurso) return
    const destino: [number, number] = [recurso.last.latitude, recurso.last.longitude]
    const zoom = Math.max(mapa.getZoom(), ZOOM_SEGUIMIENTO)

    // Corre el centro a la izquierda para que el marcador caiga en la mitad
    // visible y no debajo de la ficha. Solo cuando el mapa es lo bastante ancho
    // para que la ficha sea una columna lateral: bajo ~900 px ocupa todo el
    // ancho y desplazar dejaría el marcador fuera de cuadro.
    if (fichaAbierta && mapa.getSize().x > ANCHO_FICHA * 2) {
      const punto = mapa.project(destino, zoom).subtract([ANCHO_FICHA / 2, 0])
      mapa.flyTo(mapa.unproject(punto, zoom), zoom, { duration: 0.8 })
      return
    }
    mapa.flyTo(destino, zoom, { duration: 0.8 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- volar solo al cambiar la selección
  }, [mapa, esn])
  return null
}

/**
 * Leaflet pinta las polilíneas como atributos SVG, donde var(--token) no
 * resuelve: se leen los tokens computados una vez (sin hex crudo en el código).
 */
function useColoresEstado(): Record<EstadoVisual, string> {
  return useMemo(() => {
    const raiz = getComputedStyle(document.documentElement)
    const leer = (variable: string) => raiz.getPropertyValue(variable).trim()
    return {
      enruta: leer('--state-enroute'),
      tierra: leer('--state-ground'),
      parado: leer('--state-stopped'),
      stale: leer('--state-stale'),
      desconocido: leer('--text-muted'),
    }
  }, [])
}

export function MapView({
  recursos,
  seleccionado,
  onSeleccionar,
  trailsVisibles,
  fichaAbierta,
}: Props) {
  const colores = useColoresEstado()
  const recursoSeleccionado = recursos.find((r) => r.esn === seleccionado) ?? null

  return (
    <MapContainer
      center={CENTRO_INICIAL}
      zoom={ZOOM_INICIAL}
      className={styles.mapa}
      zoomControl={false}
    >
      {/* abajo a la derecha: la esquina superior izquierda es del botón del panel */}
      <ZoomControl position="bottomright" />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={STRINGS.mapa.atribucion}
      />

      <CentrarEnSeleccion recurso={recursoSeleccionado} fichaAbierta={fichaAbierta} />

      {recursos.map(
        (recurso) =>
          trailsVisibles.has(recurso.esn) &&
          recurso.trail.length >= 2 && (
            <Polyline
              key={`trail-${recurso.esn}`}
              positions={recurso.trail.map((p) => [p.latitude, p.longitude] as [number, number])}
              pathOptions={{
                color: colores[estadoVisual(recurso)],
                weight: 2,
                opacity: 0.7,
              }}
            />
          ),
      )}

      {recursos.map((recurso) => (
        <Marker
          key={recurso.esn}
          position={[recurso.last.latitude, recurso.last.longitude]}
          icon={iconoRecurso(recurso, recurso.esn === seleccionado)}
          eventHandlers={{ click: () => onSeleccionar(recurso.esn) }}
        >
          {/* alias + estado en texto (§10.3: nunca solo color): al pasar el
              mouse, y fijo para el seleccionado.

              El `key` NO es decorativo: react-leaflet pasa `permanent` a
              bindTooltip al CREAR la capa y no la re-vincula cuando la prop
              cambia, así que la etiqueta fija del seleccionado nunca llegaba a
              abrirse (medido: 0 tooltips en el pane con 5 marcadores). Cambiar
              el key fuerza el remontaje y con él un bindTooltip nuevo. */}
          <Tooltip
            key={recurso.esn === seleccionado ? 'fija' : 'hover'}
            className="mk-etiqueta"
            direction="top"
            offset={[0, -14]}
            opacity={1}
            permanent={recurso.esn === seleccionado}
          >
            {recurso.label} · {TEXTO_ESTADO[estadoVisual(recurso)]}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  )
}
