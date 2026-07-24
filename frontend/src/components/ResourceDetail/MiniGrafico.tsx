/**
 * Sparkline SVG de UNA serie vs tiempo (CLAUDE.md §11 Fase 2-9). Cada medida
 * va en su propio gráfico con su propia escala — nunca doble eje. El título
 * nombra la serie (sin leyenda); el punto final va enfatizado y el último
 * valor se lee como texto (la identidad nunca es solo color).
 */
import type { CSSProperties } from 'react'
import styles from './MiniGrafico.module.css'

export interface PuntoSerie {
  t: number // ms epoch
  v: number
}

interface Props {
  titulo: string
  unidad: string
  puntos: PuntoSerie[]
  /** decimales del valor mostrado */
  decimales?: number
}

const ANCHO = 260
const ALTO = 48
const MARGEN = 3

export function MiniGrafico({ titulo, unidad, puntos, decimales = 0 }: Props) {
  if (puntos.length < 2) return null

  const tMin = puntos[0]!.t
  const tMax = puntos[puntos.length - 1]!.t
  let vMin = Math.min(...puntos.map((p) => p.v))
  let vMax = Math.max(...puntos.map((p) => p.v))
  if (vMin === vMax) {
    vMin -= 1
    vMax += 1
  }

  const x = (t: number) =>
    MARGEN + ((t - tMin) / Math.max(1, tMax - tMin)) * (ANCHO - 2 * MARGEN)
  const y = (v: number) =>
    ALTO - MARGEN - ((v - vMin) / (vMax - vMin)) * (ALTO - 2 * MARGEN)

  const linea = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${linea} L${x(tMax).toFixed(1)},${ALTO - MARGEN} L${x(tMin).toFixed(1)},${ALTO - MARGEN} Z`
  const ultimo = puntos[puntos.length - 1]!

  return (
    <figure className={styles.grafico} style={{ '--serie': 'var(--accent)' } as CSSProperties}>
      <figcaption className={styles.cabecera}>
        <span className={styles.titulo}>{titulo}</span>
        <span className={styles.valorActual}>
          {ultimo.v.toFixed(decimales)} {unidad}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className={styles.lienzo}
        role="img"
        aria-label={`${titulo}: mínimo ${vMin.toFixed(decimales)}, máximo ${vMax.toFixed(decimales)} ${unidad}`}
      >
        {/* grilla recesiva */}
        <line x1={MARGEN} y1={y(vMax)} x2={ANCHO - MARGEN} y2={y(vMax)} className={styles.grilla} />
        <line x1={MARGEN} y1={y(vMin)} x2={ANCHO - MARGEN} y2={y(vMin)} className={styles.grilla} />
        <path d={area} className={styles.area} />
        <path d={linea} className={styles.linea} />
        {/* punto final enfatizado */}
        <circle cx={x(ultimo.t)} cy={y(ultimo.v)} r={2.8} className={styles.punto} />
      </svg>
      <div className={styles.rango}>
        <span>
          mín {vMin.toFixed(decimales)}
        </span>
        <span>
          máx {vMax.toFixed(decimales)}
        </span>
      </div>
    </figure>
  )
}
