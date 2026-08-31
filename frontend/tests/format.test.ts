/**
 * Unidades de presentación. La velocidad tiene test propio porque su unidad fue
 * una hipótesis equivocada durante semanas: `spd` viene en METROS POR SEGUNDO,
 * confirmado el 30-jul-2026 comparando 1.287 pares de posiciones reales
 * consecutivas contra la distancia haversine recorrida (mediana del ratio 0,90;
 * tramos de 30 s ~1,00 — nudos habría dado 0,51 y km/h 0,28).
 */
import { describe, expect, it } from 'vitest'
import { altitud, haceCuanto, rumbo, velocidad } from '../src/lib/format'

describe('velocidad — `spd` en m/s', () => {
  it('convierte m/s a km/h y muestra nudos entre paréntesis (§10.3)', () => {
    // 48 m/s es la máxima real observada en el AT-802F "AC-02" en vuelo
    expect(velocidad(48)).toBe('173 km/h (93 kn)')
  })

  it('un vehículo terrestre lento da una cifra plausible', () => {
    // 3 m/s es la máxima real del camión "MC-HC20"
    expect(velocidad(3)).toBe('11 km/h (6 kn)')
  })

  it('detenido', () => {
    expect(velocidad(0)).toBe('0 km/h (0 kn)')
  })

  it('sin dato', () => {
    expect(velocidad(undefined)).toBe('—')
  })

  it('NO interpreta el valor como nudos (regresión de la hipótesis anterior)', () => {
    // con la conversión vieja (×1,852) esto daba 89 km/h: un AT-802F no vuela así
    expect(velocidad(48)).not.toContain('89 km/h')
  })
})

describe('altitud y rumbo', () => {
  it('altitud en metros', () => {
    expect(altitud(1311)).toBe('1311 m') // máxima real observada en AC-02
    expect(altitud(undefined)).toBe('—')
  })

  it('rumbo en grados', () => {
    expect(rumbo(198)).toBe('198°')
    expect(rumbo(undefined)).toBe('—')
  })
})

describe('haceCuanto', () => {
  it.each([
    [30, 'hace 30 s'],
    [200, 'hace 3 min'],
    [3600 * 5, 'hace 5 h 00 min'],
    [3600 * 30, 'hace 1 d 6 h'],
  ])('%i s -> %s', (segundos, esperado) => {
    expect(haceCuanto(segundos)).toBe(esperado)
  })
})
