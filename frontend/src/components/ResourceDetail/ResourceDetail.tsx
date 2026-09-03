/**
 * Ficha de un recurso: identidad compacta + telemetría en celdas monoespaciadas;
 * timestamps en hora de Chile con tooltip UTC (CLAUDE.md §10.3). La barra
 * superior replica el color del estado — redundante con el chip ícono+texto.
 *
 * Es un panel FLOTANTE anclado al área del mapa, no un popup de Leaflet: los
 * popups viven dentro del pane transformado y se arrastran con el mapa. Acá el
 * operador lee la ficha mientras sigue moviendo el mapa por detrás.
 *
 * `role="region"` y NO `role="dialog"`: el panel no es modal — el mapa sigue vivo
 * y arrastrable — así que no se atrapa el foco ni se bloquea el fondo.
 */
import { useEffect, type CSSProperties } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { FleetResource } from '../../domain/types'
import {
  altitud,
  coordenadas,
  fechaHoraChile,
  MS_A_KMH,
  rumbo,
  utcCrudo,
  velocidad,
} from '../../lib/format'
import { COLOR_ESTADO, estadoVisual } from '../../ui/estadoVisual'
import { STRINGS } from '../../ui/strings'
import { EstadoChip } from '../EstadoChip/EstadoChip'
import { MiniGrafico, type PuntoSerie } from './MiniGrafico'
import styles from './ResourceDetail.module.css'

// `spd` viene en m/s (confirmado con datos reales, ver lib/format.ts).

interface Props {
  recurso: FleetResource
  /** Sin handler, la ficha se pinta sin botón de cerrar (uso embebido). */
  onCerrar?: () => void
}

/** Serie temporal de una medida de la trail (solo puntos con el dato). */
function serie(
  recurso: FleetResource,
  valor: (p: FleetResource['trail'][number]) => number | undefined,
): PuntoSerie[] {
  const puntos: PuntoSerie[] = []
  for (const p of recurso.trail) {
    const v = valor(p)
    if (v !== undefined) puntos.push({ t: Date.parse(p.posTime), v })
  }
  return puntos
}

export function ResourceDetail({ recurso, onCerrar }: Props) {
  const { last } = recurso
  const t = STRINGS.detalle

  // Escape cierra. Se registra en el documento porque el foco suele estar en el
  // mapa o en la lista, no dentro de la ficha.
  useEffect(() => {
    if (!onCerrar) return
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  const serieVelocidad = serie(recurso, (p) =>
    p.speed === undefined ? undefined : p.speed * MS_A_KMH,
  )
  const serieAltitud = serie(recurso, (p) => p.altitude)

  const identidad: Array<[string, string]> = [
    [t.modelo, last.hgAssetModel ?? '—'],
    [t.familia, last.hgAssetFamily ?? '—'],
    [t.compania, last.hgCompany ?? '—'],
    [t.fuente, last.hgSource ?? '—'],
    [t.esn, recurso.esn],
  ]

  const telemetria: Array<[string, string, string?]> = [
    [t.velocidad, velocidad(last.speed)],
    [t.altitud, altitud(last.altitude)],
    [t.rumbo, rumbo(last.heading)],
    [
      t.calidadGps,
      `${last.fixType ?? '—'} · PDOP ${last.pdop ?? '—'} · HDOP ${last.hdop ?? '—'}`,
    ],
    [t.ultimaPosicion, fechaHoraChile(last.posTime), utcCrudo(last.posTime)],
    [t.llegadaServidor, fechaHoraChile(last.dataCtrTime), utcCrudo(last.dataCtrTime)],
  ]

  return (
    <aside
      className={styles.panel}
      role="region"
      aria-label={t.tituloRegion(recurso.label)}
      style={{ '--estado-color': COLOR_ESTADO[estadoVisual(recurso)] } as CSSProperties}
    >
      <article className={styles.ficha}>
        <header className={styles.cabecera}>
          <div className={styles.identificacion}>
            <h3 className={styles.titulo}>{recurso.label}</h3>
            {last.hgAsset && <span className={styles.patente}>{last.hgAsset}</span>}
          </div>
          <div className={styles.acciones}>
            <EstadoChip recurso={recurso} />
            {onCerrar && (
              <button
                type="button"
                className={styles.cerrar}
                onClick={onCerrar}
                aria-label={t.cerrar}
              >
                <X size={18} strokeWidth={2.25} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <p className={styles.coordenadas} title={`${t.posicion} (WGS84)`}>
          {coordenadas(last.latitude, last.longitude)}
        </p>

        <div className={styles.grilla}>
          {telemetria.map(([etiqueta, valor, tooltip]) => (
            <div key={etiqueta} className={styles.celda} title={tooltip}>
              <span className={styles.celdaEtiqueta}>{etiqueta}</span>
              <span className={styles.celdaValor}>{valor}</span>
            </div>
          ))}
        </div>

        {(serieVelocidad.length >= 2 || serieAltitud.length >= 2) && (
          <div className={styles.graficos}>
            <MiniGrafico
              titulo={`${t.velocidad} (km/h)`}
              unidad="km/h"
              puntos={serieVelocidad}
            />
            <MiniGrafico titulo={`${t.altitud} (m)`} unidad="m" puntos={serieAltitud} />
          </div>
        )}

        <dl className={styles.identidadLista}>
          {identidad.map(([etiqueta, valor]) => (
            <div key={etiqueta} className={styles.filaDato}>
              <dt>{etiqueta}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>

        {recurso.posicionesInvalidas > 0 && (
          <p className={styles.badgeInvalidos}>
            <AlertTriangle size={13} strokeWidth={2.25} aria-hidden="true" />
            {STRINGS.fleetPanel.fixInvalidos(recurso.posicionesInvalidas)}
          </p>
        )}
      </article>
    </aside>
  )
}
