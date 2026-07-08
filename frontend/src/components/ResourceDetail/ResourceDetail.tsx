/**
 * Ficha de un recurso (popup del mapa): identidad compacta + telemetría en
 * celdas monoespaciadas; timestamps en hora de Chile con tooltip UTC
 * (CLAUDE.md §10.3). La barra superior replica el color del estado —
 * redundante con el chip ícono+texto.
 */
import type { CSSProperties } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { FleetResource } from '../../domain/types'
import {
  altitud,
  coordenadas,
  fechaHoraChile,
  rumbo,
  utcCrudo,
  velocidad,
} from '../../lib/format'
import { COLOR_ESTADO, estadoVisual } from '../../ui/estadoVisual'
import { STRINGS } from '../../ui/strings'
import { EstadoChip } from '../EstadoChip/EstadoChip'
import styles from './ResourceDetail.module.css'

interface Props {
  recurso: FleetResource
}

export function ResourceDetail({ recurso }: Props) {
  const { last } = recurso
  const t = STRINGS.detalle

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
    <article
      className={styles.ficha}
      aria-label={recurso.label}
      style={{ '--estado-color': COLOR_ESTADO[estadoVisual(recurso)] } as CSSProperties}
    >
      <header className={styles.cabecera}>
        <div className={styles.identificacion}>
          <h3 className={styles.titulo}>{recurso.label}</h3>
          {last.hgAsset && <span className={styles.patente}>{last.hgAsset}</span>}
        </div>
        <EstadoChip recurso={recurso} />
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
  )
}
