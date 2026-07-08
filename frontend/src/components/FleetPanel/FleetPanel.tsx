/**
 * Lista lateral de recursos ordenada por frescura, con búsqueda por
 * alias/patente y fila de KPIs por estado que además filtra la lista
 * (CLAUDE.md §11 MVP-3). El estado siempre viaja como color + ícono + texto.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, Route, Search } from 'lucide-react'
import type { FleetResource } from '../../domain/types'
import { haceCuanto } from '../../lib/format'
import {
  COLOR_ESTADO,
  ICONO_ESTADO,
  estadoVisual,
  type EstadoVisual,
} from '../../ui/estadoVisual'
import { STRINGS } from '../../ui/strings'
import { EstadoChip } from '../EstadoChip/EstadoChip'
import styles from './FleetPanel.module.css'

interface Props {
  recursos: FleetResource[]
  seleccionado: string | null
  onSeleccionar: (esn: string) => void
  trailsVisibles: ReadonlySet<string>
  onAlternarTrail: (esn: string) => void
  onAlternarTodas: () => void
  todasActivas: boolean
}

const TILES: Array<{ clave: EstadoVisual; etiqueta: string }> = [
  { clave: 'enruta', etiqueta: STRINGS.fleetPanel.kpi.enruta },
  { clave: 'tierra', etiqueta: STRINGS.fleetPanel.kpi.tierra },
  { clave: 'parado', etiqueta: STRINGS.fleetPanel.kpi.parado },
  { clave: 'stale', etiqueta: STRINGS.fleetPanel.kpi.stale },
]

export function FleetPanel({
  recursos,
  seleccionado,
  onSeleccionar,
  trailsVisibles,
  onAlternarTrail,
  onAlternarTodas,
  todasActivas,
}: Props) {
  const [filtro, setFiltro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoVisual | null>(null)

  const conteos = useMemo(() => {
    const resultado: Record<EstadoVisual, number> = {
      enruta: 0,
      tierra: 0,
      parado: 0,
      stale: 0,
      desconocido: 0,
    }
    for (const recurso of recursos) resultado[estadoVisual(recurso)] += 1
    return resultado
  }, [recursos])

  const filtrados = useMemo(() => {
    const texto = filtro.trim().toLowerCase()
    return recursos.filter((r) => {
      if (filtroEstado !== null && estadoVisual(r) !== filtroEstado) return false
      if (!texto) return true
      return [r.label, r.last.hgAsset, r.last.hgAlias, r.esn].some((campo) =>
        campo?.toLowerCase().includes(texto),
      )
    })
  }, [recursos, filtro, filtroEstado])

  const t = STRINGS.fleetPanel

  return (
    <section className={styles.panel} aria-label={t.titulo}>
      <header className={styles.cabecera}>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <span className={styles.contador}>{t.recursos(recursos.length)}</span>
      </header>

      <div className={styles.kpis} role="group" aria-label={t.titulo}>
        {TILES.map(({ clave, etiqueta }) => {
          const Icono = ICONO_ESTADO[clave]
          const activo = filtroEstado === clave
          return (
            <button
              key={clave}
              type="button"
              className={styles.kpi}
              style={{ '--kpi-color': COLOR_ESTADO[clave] } as CSSProperties}
              aria-pressed={activo}
              aria-label={
                activo ? t.quitarFiltro(etiqueta) : t.filtrarPor(etiqueta, conteos[clave])
              }
              onClick={() => setFiltroEstado(activo ? null : clave)}
            >
              <span className={styles.kpiValor}>{conteos[clave]}</span>
              <span className={styles.kpiEtiqueta}>
                <Icono size={12} strokeWidth={2.25} aria-hidden="true" />
                {etiqueta}
              </span>
            </button>
          )
        })}
      </div>

      <div className={styles.controles}>
        <label className={styles.busqueda}>
          <Search size={15} strokeWidth={2.25} aria-hidden="true" />
          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder={t.buscar}
            aria-label={t.buscarLabel}
          />
        </label>
        <button
          type="button"
          className={styles.botonTodas}
          onClick={onAlternarTodas}
          aria-pressed={todasActivas}
        >
          <Route size={15} strokeWidth={2.25} aria-hidden="true" />
          {t.trazas}: {todasActivas ? t.todas : t.ninguna}
        </button>
      </div>

      {recursos.length === 0 ? (
        <p className={styles.vacio}>{t.vacio}</p>
      ) : filtrados.length === 0 ? (
        <p className={styles.vacio}>
          {filtroEstado !== null && filtro.trim() === ''
            ? t.sinResultadosEstado
            : t.sinResultados(filtro.trim())}
        </p>
      ) : (
        <ul className={styles.lista}>
          {filtrados.map((recurso) => {
            const estado = estadoVisual(recurso)
            return (
              <li key={recurso.esn}>
                <div
                  className={
                    recurso.esn === seleccionado
                      ? `${styles.fila} ${styles.filaSeleccionada}`
                      : styles.fila
                  }
                  style={{ '--rail': COLOR_ESTADO[estado] } as CSSProperties}
                >
                  <button
                    type="button"
                    className={styles.botonRecurso}
                    onClick={() => onSeleccionar(recurso.esn)}
                    aria-label={t.centrarEn(recurso.label)}
                    aria-current={recurso.esn === seleccionado ? 'true' : undefined}
                  >
                    <span className={styles.datosRecurso}>
                      <span className={styles.etiqueta}>
                        <span className={styles.nombre}>{recurso.label}</span>
                        {recurso.last.hgAsset && (
                          <span className={styles.patente}>{recurso.last.hgAsset}</span>
                        )}
                      </span>
                      <EstadoChip recurso={recurso} compacto />
                    </span>
                    <span className={styles.frescura}>
                      <span className={styles.tiempo}>
                        <span
                          className={`${styles.punto} ${styles[`punto_${recurso.freshness}`]}`}
                          aria-hidden="true"
                        />
                        {haceCuanto(recurso.staleSeconds)}
                      </span>
                      {recurso.posicionesInvalidas > 0 && (
                        <span
                          className={styles.badgeInvalidos}
                          title={t.fixInvalidos(recurso.posicionesInvalidas)}
                        >
                          <AlertTriangle size={12} strokeWidth={2.25} aria-hidden="true" />
                          {recurso.posicionesInvalidas}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.botonTrail}
                    onClick={() => onAlternarTrail(recurso.esn)}
                    aria-pressed={trailsVisibles.has(recurso.esn)}
                    aria-label={
                      trailsVisibles.has(recurso.esn)
                        ? `${t.ocultarTraza} — ${recurso.label}`
                        : `${t.verTraza} — ${recurso.label}`
                    }
                    title={trailsVisibles.has(recurso.esn) ? t.ocultarTraza : t.verTraza}
                  >
                    <Route size={16} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
