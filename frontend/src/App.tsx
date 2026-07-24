/**
 * Composición de la app (layout de CLAUDE.md §10.2):
 * StatusBar arriba · FleetPanel a la izquierda (drawer inferior bajo 900 px)
 * · MapView al centro · TimeRangeBar abajo (presets en vivo + rango histórico
 * + export) · Alertas flotantes sobre el mapa.
 */
import { useMemo, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { usePolling, POLL_INTERVAL_MS } from './hooks/usePolling'
import { useHistorico } from './hooks/useHistorico'
import { useAlertas } from './hooks/useAlertas'
import { aCSV, aGeoJSON, descargar, nombreArchivo } from './lib/exportar'
import { STRINGS } from './ui/strings'
import { Alertas } from './components/Alertas/Alertas'
import { FleetPanel } from './components/FleetPanel/FleetPanel'
import { MapView } from './components/MapView/MapView'
import { StatusBar } from './components/StatusBar/StatusBar'
import { TimeRangeBar } from './components/TimeRangeBar/TimeRangeBar'
import styles from './App.module.css'

export default function App() {
  const [rangoHoras, setRangoHoras] = useState(2)
  const [modo, setModo] = useState<'vivo' | 'historico'>('vivo')
  const enHistorico = modo === 'historico'

  const estadoVivo = usePolling(rangoHoras, POLL_INTERVAL_MS, !enHistorico)
  const { estado: historico, consultar, limpiar } = useHistorico()
  const fleet = enHistorico ? historico.fleet : estadoVivo.fleet

  const { alertas, descartar } = useAlertas(estadoVivo.fleet, !enHistorico)

  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [panelAbierto, setPanelAbierto] = useState(true)

  // trazas: "todas" (default) o selección manual por ESN
  const [trailsTodas, setTrailsTodas] = useState(true)
  const [trailsPorEsn, setTrailsPorEsn] = useState<ReadonlySet<string>>(new Set())

  const trailsVisibles = useMemo<ReadonlySet<string>>(
    () => (trailsTodas ? new Set(fleet.map((r) => r.esn)) : trailsPorEsn),
    [trailsTodas, trailsPorEsn, fleet],
  )

  const alternarTrail = (esn: string) => {
    if (trailsTodas) {
      const conjunto = new Set(fleet.map((r) => r.esn))
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

  const consultarHistorico = (desdeIso: string, hastaIso: string) => {
    setModo('historico')
    void consultar(desdeIso, hastaIso)
  }

  const volverEnVivo = () => {
    limpiar()
    setModo('vivo')
  }

  const alCambiarRango = (horas: number) => {
    setRangoHoras(horas)
    if (enHistorico) volverEnVivo()
  }

  const exportar = (formato: 'geojson' | 'csv') => {
    if (fleet.length === 0) return
    if (formato === 'geojson') {
      descargar(nombreArchivo('geojson', enHistorico), aGeoJSON(fleet), 'application/geo+json')
    } else {
      descargar(nombreArchivo('csv', enHistorico), aCSV(fleet), 'text/csv')
    }
  }

  const simulacion = fleet.some((r) => r.last.hgCompany === 'SIMULADO')

  return (
    <div className={styles.app}>
      <StatusBar
        estado={estadoVivo}
        simulacion={simulacion}
        historico={enHistorico ? historico : null}
      />

      <div className={styles.cuerpo}>
        <aside
          className={panelAbierto ? styles.panel : `${styles.panel} ${styles.panelCerrado}`}
        >
          <FleetPanel
            recursos={fleet}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
            trailsVisibles={trailsVisibles}
            onAlternarTrail={alternarTrail}
            onAlternarTodas={alternarTodas}
            todasActivas={trailsTodas}
            cargando={
              enHistorico ? historico.fase === 'cargando' : estadoVivo.fase === 'cargando'
            }
          />
        </aside>

        <main className={styles.mapa}>
          <MapView
            recursos={fleet}
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
          <Alertas alertas={alertas} onDescartar={descartar} onSeleccionar={setSeleccionado} />
        </main>
      </div>

      <TimeRangeBar
        modo={modo}
        rangoHoras={rangoHoras}
        consultando={enHistorico && historico.fase === 'cargando'}
        exportarDeshabilitado={fleet.length === 0}
        onCambiarRango={alCambiarRango}
        onConsultarHistorico={consultarHistorico}
        onVolverEnVivo={volverEnVivo}
        onExportar={exportar}
      />
    </div>
  )
}
