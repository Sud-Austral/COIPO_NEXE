/**
 * §12: FleetPanel renderiza los 3 estados + stale con ícono Y texto
 * (el estado nunca se comunica solo por color — §10.3), y la fila de KPIs
 * cuenta por estado y filtra la lista.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FleetPanel } from '../src/components/FleetPanel/FleetPanel'
import type { FleetResource, Freshness, NavState } from '../src/domain/types'

function recurso(
  esn: string,
  label: string,
  navState: NavState | null,
  freshness: Freshness,
): FleetResource {
  return {
    esn,
    label,
    last: {
      esn,
      posTime: '2026-07-03T12:00:00Z',
      dataCtrTime: '2026-07-03T12:00:10Z',
      latitude: -35.5,
      longitude: -71.5,
      hgExtName: label,
      hgNavstate: navState ?? undefined,
    },
    trail: [],
    navState,
    staleSeconds: freshness === 'live' ? 30 : freshness === 'delayed' ? 200 : 700,
    freshness,
    posicionesInvalidas: 0,
  }
}

const FLOTA: FleetResource[] = [
  recurso('1', 'HT-01', 5, 'live'), // En ruta
  recurso('2', 'HT-02', 4, 'live'), // Emitiendo en tierra
  recurso('3', 'MV-01', 2, 'delayed'), // Parado
  recurso('4', 'AT-02', 5, 'stale'), // Sin señal reciente (manda sobre navState)
]

function montar(recursos: FleetResource[] = FLOTA) {
  return render(
    <FleetPanel
      recursos={recursos}
      seleccionado={null}
      onSeleccionar={vi.fn()}
      trailsVisibles={new Set()}
      onAlternarTrail={vi.fn()}
      onAlternarTodas={vi.fn()}
      todasActivas={false}
    />,
  )
}

describe('FleetPanel — estados con ícono y texto', () => {
  it.each([
    ['En ruta'],
    ['Emitiendo en tierra'],
    ['Parado'],
    ['Sin señal reciente'],
  ])('muestra el estado "%s" como texto acompañado de un ícono', (texto) => {
    montar()
    const lista = screen.getByRole('list')
    const etiqueta = within(lista).getByText(texto)
    expect(etiqueta).toBeInTheDocument()
    // el ícono lucide (svg) vive en el mismo chip que el texto
    const chip = etiqueta.parentElement
    expect(chip?.querySelector('svg')).not.toBeNull()
  })

  it('la frescura stale manda por sobre el último navState conocido', () => {
    montar()
    const lista = screen.getByRole('list')
    // AT-02 tiene navState 5 pero está stale → NO debe decir "En ruta" dos veces
    expect(within(lista).getAllByText('En ruta')).toHaveLength(1)
    expect(within(lista).getByText('Sin señal reciente')).toBeInTheDocument()
  })

  it('estado vacío accionable cuando no hay recursos', () => {
    montar([])
    expect(screen.getByText(/Aún no llegan posiciones/)).toBeInTheDocument()
  })

  it('la búsqueda está presente y la lista muestra los recursos', () => {
    montar()
    expect(screen.getByLabelText('Buscar recurso por alias o patente')).toBeInTheDocument()
    expect(screen.getByText('HT-01')).toBeInTheDocument()
  })
})

describe('FleetPanel — KPIs por estado', () => {
  it('cuenta recursos por estado (1/1/1/1 para la flota de prueba)', () => {
    montar()
    const tiles = [
      screen.getByRole('button', { name: 'Filtrar por estado: En ruta (1)' }),
      screen.getByRole('button', { name: 'Filtrar por estado: En tierra (1)' }),
      screen.getByRole('button', { name: 'Filtrar por estado: Parado (1)' }),
      screen.getByRole('button', { name: 'Filtrar por estado: Sin señal (1)' }),
    ]
    for (const tile of tiles) {
      expect(tile).toHaveTextContent('1')
      expect(tile).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('el tile filtra la lista y un segundo clic quita el filtro', () => {
    montar()
    const tile = screen.getByRole('button', { name: 'Filtrar por estado: Sin señal (1)' })
    fireEvent.click(tile)

    let lista = screen.getByRole('list')
    expect(within(lista).getByText('AT-02')).toBeInTheDocument()
    expect(within(lista).queryByText('HT-01')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro de estado: Sin señal' }))
    lista = screen.getByRole('list')
    expect(within(lista).getByText('HT-01')).toBeInTheDocument()
  })
})
