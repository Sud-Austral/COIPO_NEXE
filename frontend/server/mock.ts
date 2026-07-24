/**
 * Servidor simulado de Nexe (CLAUDE.md §9) — para desarrollar sin key ni staging.
 *
 * La generación de datos vive en src/demo/simuladorNexe.ts (módulo puro,
 * compartido con el modo demo del navegador). Aquí solo queda la capa HTTP:
 * header `api-key`, 422 estilo Pydantic, 500 con listas vacías, y los flags
 * MOCK_FAIL_RATE / MOCK_LATENCY_MS.
 */
import 'dotenv/config'
import express from 'express'
import {
  FLOTA,
  extraerCampo,
  extraerDomain,
  feature,
  featureCollection,
  posicionesLlegadasDesde,
  ultimasPosiciones,
} from '../src/demo/simuladorNexe'
import { validarBodyNexe } from './validacionNexe'

const app = express()
app.use(express.json())

const PORT = Number(process.env.MOCK_PORT ?? 3002)
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE ?? 0)
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0)

function manejar(modo: 'get' | 'last'): express.RequestHandler {
  return (req, res) => {
    const responder = () => {
      // auth: header exacto `api-key`, cualquier valor no vacío
      const key = req.header('api-key')
      if (!key) {
        res.status(401).json({ detail: 'Incorrect api key or JWT Token' })
        return
      }

      const validacion = validarBodyNexe(req.body)
      if (!validacion.ok) {
        if (validacion.status === 422) {
          res.status(422).json({ detail: validacion.detail })
        } else {
          res.status(500).type('text/plain').send('Internal Server Error')
        }
        return
      }

      if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
        res.status(500).type('text/plain').send('Internal Server Error')
        return
      }

      const ahora = Date.now()
      if (modo === 'last') {
        // el `domain` real es una lista (422 confirmado); a diferencia del
        // servidor real (que hoy devuelve 500 — bug escalado), el mock
        // implementa el filtro según la intención documentada
        const domains = extraerDomain(validacion.msgRequest)
        const posiciones = ultimasPosiciones(ahora, domains)
        res.json(featureCollection(posiciones.map((p) => feature(p, true))))
        return
      }

      const desdeTexto = extraerCampo(validacion.msgRequest, ['dataCtrTime'])
      const desdeMs = desdeTexto !== null ? Date.parse(desdeTexto) : NaN
      const desde = Number.isNaN(desdeMs) ? ahora - 2 * 3600_000 : desdeMs
      const posiciones = posicionesLlegadasDesde(desde, ahora)
      res.json(featureCollection(posiciones.map((p) => feature(p, false))))
    }
    if (LATENCY_MS > 0) setTimeout(responder, LATENCY_MS)
    else responder()
  }
}

app.post('/api/v1/monitor/position/affjson/get', manejar('get'))
app.post('/api/v1/monitor/position/affjson/get_lastpositions', manejar('last'))

// método incorrecto → 405, como el servidor real
app.all('/api/v1/monitor/position/affjson/:resto', (_req, res) => {
  res.status(405).json({ detail: 'Method Not Allowed' })
})

app.listen(PORT, () => {
  console.log(
    `[mock] Nexe simulado en http://localhost:${PORT}/api/v1/monitor (flota: ${FLOTA.length} medios)`,
  )
})
