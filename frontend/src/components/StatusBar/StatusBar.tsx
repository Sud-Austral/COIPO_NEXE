/**
 * Barra superior: estado de conexión, frescura del último dato, cuenta
 * regresiva del próximo poll, cursor actual y banners de error/simulación
 * (CLAUDE.md §10.2 y §8.3). Indicadores como pills: etiqueta muted + valor
 * en monoespaciada (el color queda reservado al estado).
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, FlaskConical, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import type { EstadoPolling } from '../../hooks/usePolling'
import { fechaHoraChile, haceCuanto, utcCrudo } from '../../lib/format'
import { STRINGS } from '../../ui/strings'
import styles from './StatusBar.module.css'

interface Props {
  estado: EstadoPolling
  simulacion: boolean
}

/** Segundos que faltan para `timestamp`, refrescado cada segundo. */
function useCuentaRegresiva(timestamp: number | null): number | null {
  const [restante, setRestante] = useState<number | null>(null)
  useEffect(() => {
    if (timestamp === null) {
      setRestante(null)
      return
    }
    const calcular = () => setRestante(Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)))
    calcular()
    const intervalo = setInterval(calcular, 1000)
    return () => clearInterval(intervalo)
  }, [timestamp])
  return restante
}

export function StatusBar({ estado, simulacion }: Props) {
  const restante = useCuentaRegresiva(estado.proximoPollMs)

  const masFresco = estado.fleet.length
    ? Math.min(...estado.fleet.map((r) => r.staleSeconds))
    : null

  const conexion =
    estado.fase === 'ok'
      ? { Icono: Wifi, texto: STRINGS.conexion.conectado, clase: styles.ok }
      : estado.fase === 'reintentando'
        ? { Icono: RefreshCw, texto: STRINGS.conexion.reintentando, clase: styles.alerta }
        : estado.fase === 'detenido'
          ? { Icono: WifiOff, texto: STRINGS.conexion.detenido, clase: styles.peligro }
          : { Icono: RefreshCw, texto: STRINGS.conexion.cargando, clase: styles.neutro }

  return (
    <header className={styles.barra}>
      <div className={styles.fila}>
        <h1 className={styles.marca}>
          {STRINGS.app.titulo}
          <span className={styles.submarca}>{STRINGS.app.subtitulo}</span>
        </h1>

        <div className={styles.indicadores}>
          <span className={`${styles.pill} ${styles.conexion} ${conexion.clase}`}>
            <conexion.Icono size={14} strokeWidth={2.25} aria-hidden="true" />
            {conexion.texto}
          </span>

          <span className={styles.pill}>
            <span className={styles.etiqueta}>{STRINGS.statusBar.ultimoDato}</span>
            <span className={styles.valor}>
              {masFresco === null ? STRINGS.statusBar.sinDatos : haceCuanto(masFresco)}
            </span>
          </span>

          {restante !== null && estado.fase !== 'detenido' && (
            <span className={styles.pill}>
              <span className={styles.etiqueta}>{STRINGS.statusBar.proximoPoll}</span>
              <span className={styles.valor}>{restante} s</span>
            </span>
          )}

          {estado.cursor && (
            <span className={styles.pill} title={utcCrudo(estado.cursor)}>
              <span className={styles.etiqueta}>{STRINGS.statusBar.cursor}</span>
              <span className={styles.valor}>{fechaHoraChile(estado.cursor)}</span>
            </span>
          )}

          <span className={styles.pill}>
            <span className={styles.etiqueta}>{STRINGS.statusBar.polls}</span>
            <span className={styles.valor}>{estado.contadorPolls}</span>
          </span>
        </div>
      </div>

      {simulacion && (
        <p className={styles.bannerSimulacion} role="status">
          <FlaskConical size={15} strokeWidth={2.25} aria-hidden="true" />
          {STRINGS.banners.modoSimulacion}
        </p>
      )}

      {estado.error && (
        <div
          className={
            estado.error.tipo === 'red' ? styles.bannerAlerta : styles.bannerPeligro
          }
          role="alert"
        >
          <AlertTriangle size={15} strokeWidth={2.25} aria-hidden="true" />
          <span>
            {estado.error.tipo === 'auth' && STRINGS.banners.credencialesInvalidas}
            {estado.error.tipo === 'contrato' && STRINGS.banners.contratoDesalineado}
            {estado.error.tipo === 'respuesta' && STRINGS.banners.respuestaDesconocida}
            {estado.error.tipo === 'red' &&
              STRINGS.banners.reintentando(restante ?? 0)}
          </span>
          {estado.error.detalle !== undefined && (
            <details className={styles.detalleTecnico}>
              <summary>{STRINGS.banners.verDetalle}</summary>
              <pre>{JSON.stringify(estado.error.detalle, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </header>
  )
}
