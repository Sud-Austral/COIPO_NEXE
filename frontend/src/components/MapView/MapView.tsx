/**
 * Mapa Leaflet: marcadores rotados por heading con pulso de frescura, trails
 * por ESN coloreadas por estado, popup con la ficha del recurso
 * (CLAUDE.md §10.2, §11 MVP-2/4).
 */
import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from 'react-leaflet'
import type { FleetResource } from '../../domain/types'
import { estadoVisual, TEXTO_ESTADO, type EstadoVisual } from '../../ui/estadoVisual'
import { STRINGS } from '../../ui/strings'
import { ResourceDetail } from '../ResourceDetail/ResourceDetail'
import { iconoRecurso } from './marcador'
import './marcadores.css'
import styles from './MapView.module.css'

const CENTRO_INICIAL: [number, number] = [-35.8, -71.9] // zona centro-sur de Chile
const ZOOM_INICIAL = 7
const ZOOM_SEGUIMIENTO = 11

interface Props {
  recursos: FleetResource[]
  seleccionado: string | null
  onSeleccionar: (esn: string) => void
  trailsVisibles: ReadonlySet<string>
}

/** Vuela hacia el recurso cuando cambia la selección (no en cada poll). */
function CentrarEnSeleccion({ recurso }: { recurso: FleetResource | null }) {
  const mapa = useMap()
  const esn = recurso?.esn ?? null
  useEffect(() => {
    if (recurso) {
      mapa.flyTo(
        [recurso.last.latitude, recurso.last.longitude],
        Math.max(mapa.getZoom(), ZOOM_SEGUIMIENTO),
        { duration: 0.8 },
      )
    }
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

export function MapView({ recursos, seleccionado, onSeleccionar, trailsVisibles }: Props) {
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

      <CentrarEnSeleccion recurso={recursoSeleccionado} />

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
              mouse, y fijo para el seleccionado */}
          <Tooltip
            className="mk-etiqueta"
            direction="top"
            offset={[0, -14]}
            opacity={1}
            permanent={recurso.esn === seleccionado}
          >
            {recurso.label} · {TEXTO_ESTADO[estadoVisual(recurso)]}
          </Tooltip>
          <Popup>
            <ResourceDetail recurso={recurso} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
