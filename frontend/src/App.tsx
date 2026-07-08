/**
 * Composición de la app (layout de CLAUDE.md §10.2):
 * StatusBar arriba · FleetPanel a la izquierda (drawer inferior bajo 900 px)
 * · MapView al centro · TimeRangeBar abajo.
 */
import { useMemo, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { usePolling } from './hooks/usePolling'
import { STRINGS } from './ui/strings'
import { FleetPanel } from './components/FleetPanel/FleetPanel'
import { MapView } from './components/MapView/MapView'
import { StatusBar } from './components/StatusBar/StatusBar'
import { TimeRangeBar } from './components/TimeRangeBar/TimeRangeBar'
import styles from './App.module.css'

export default function App() {
  const [rangoHoras, setRangoHoras] = useState(2)
  const estado = usePolling(rangoHoras)

  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [panelAbierto, setPanelAbierto] = useState(true)

  // trazas: "todas" (default) o selección manual por ESN
  const [trailsTodas, setTrailsTodas] = useState(true)
  const [trailsPorEsn, setTrailsPorEsn] = useState<ReadonlySet<string>>(new Set())

  const trailsVisibles = useMemo<ReadonlySet<string>>(
    () => (trailsTodas ? new Set(estado.fleet.map((r) => r.esn)) : trailsPorEsn),
    [trailsTodas, trailsPorEsn, estado.fleet],
  )

  const alternarTrail = (esn: string) => {
    if (trailsTodas) {
      const conjunto = new Set(estado.fleet.map((r) => r.esn))
      conjunto.delete(esn)
      setTrailsTodas(false)
      setTrailsPorEsn(conjunto)
      return
    }
    const conjunto = new Set(trailsPorEsn)
    if (conjunto.has(esn)) conjunto.delete(esn)
    else conjunto.add(esn)
    setTrailsPorEsn(conjunto)
  }

  const alternarTodas = () => {
    setTrailsTodas((previo) => !previo)
    setTrailsPorEsn(new Set())
  }

  const simulacion = estado.fleet.some((r) => r.last.hgCompany === 'SIMULADO')

  return (
    <div className={styles.app}>
      <StatusBar estado={estado} simulacion={simulacion} />

      <div className={styles.cuerpo}>
        <aside
          className={panelAbierto ? styles.panel : `${styles.panel} ${styles.panelCerrado}`}
        >
          <FleetPanel
            recursos={estado.fleet}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
            trailsVisibles={trailsVisibles}
            onAlternarTrail={alternarTrail}
            onAlternarTodas={alternarTodas}
            todasActivas={trailsTodas}
          />
        </aside>

        <main className={styles.mapa}>
          <MapView
            recursos={estado.fleet}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
            trailsVisibles={trailsVisibles}
          />
          <button
            type="button"
            className={styles.togglePanel}
            onClick={() => setPanelAbierto((previo) => !previo)}
            aria-expanded={panelAbierto}
            aria-label={
              panelAbierto ? STRINGS.fleetPanel.cerrarPanel : STRINGS.fleetPanel.abrirPanel
            }
          >
            {panelAbierto ? (
              <PanelLeftClose size={18} strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={18} strokeWidth={2.25} aria-hidden="true" />
            )}
          </button>
        </main>
      </div>

      <TimeRangeBar rangoHoras={rangoHoras} onCambiarRango={setRangoHoras} />
    </div>
  )
}
