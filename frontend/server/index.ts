/**
 * Proxy backend hacia Nexe (CLAUDE.md §3) — el frontend NUNCA llama a Nexe directo.
 *
 * - Allowlist estricta: solo /api/nexe/get y /api/nexe/lastpositions.
 * - Inyecta el header `api-key` desde NEXE_API_KEY. La key jamás se loguea ni
 *   se devuelve al cliente ni aparece en errores.
 * - Timeout 30 s hacia Nexe; error de red → 502 {error:"upstream_unreachable"}.
 * - Propaga status y body de Nexe en 4xx/5xx (los 422 son diagnósticos valiosos).
 * - Rate-limit defensivo: máx. 4 req/s hacia Nexe.
 */
import 'dotenv/config'
import express from 'express'

const app = express()
app.use(express.json())

const NEXE_BASE_URL =
  process.env.NEXE_BASE_URL ?? 'https://staging.nexe.online/api/v1/monitor'
const NEXE_API_KEY = process.env.NEXE_API_KEY
const PORT = Number(process.env.PORT ?? 3001)
const TIMEOUT_MS = 30_000

// Allowlist: ruta local → ruta Nexe. Nada de proxy genérico.
const RUTAS: Record<string, string> = {
  '/api/nexe/get': '/position/affjson/get',
  '/api/nexe/lastpositions': '/position/affjson/get_lastpositions',
}

// Rate-limit defensivo: cubeta de 4 tokens repuesta cada segundo.
let tokensDisponibles = 4
setInterval(() => {
  tokensDisponibles = 4
}, 1000).unref()

app.post(Object.keys(RUTAS), async (req, res) => {
  const rutaNexe = RUTAS[req.path]
  if (!rutaNexe) {
    res.status(404).json({ error: 'ruta_no_permitida' })
    return
  }
  if (!NEXE_API_KEY) {
    res.status(500).json({
      error: 'missing_api_key',
      mensaje: 'NEXE_API_KEY no está configurada en el servidor (.env)',
    })
    return
  }
  if (tokensDisponibles <= 0) {
    res.status(429).json({ error: 'rate_limited' })
    return
  }
  tokensDisponibles -= 1

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS)
  try {
    const upstream = await fetch(NEXE_BASE_URL + rutaNexe, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': NEXE_API_KEY,
      },
      body: JSON.stringify(req.body ?? {}),
      signal: control.signal,
    })
    const cuerpo = await upstream.text()
    const contentType = upstream.headers.get('content-type') ?? 'application/json'
    res
      .status(upstream.status)
      .type(contentType.includes('json') ? 'application/json' : 'text/plain')
      .send(cuerpo)
  } catch {
    // No propagar el error crudo: podría describir la request (nunca la key,
    // pero tampoco damos pistas). El frontend solo necesita saber que no hay upstream.
    res.status(502).json({ error: 'upstream_unreachable' })
  } finally {
    clearTimeout(temporizador)
  }
})

app.listen(PORT, () => {
  // Nunca loguear la key; solo la URL base (no contiene secretos).
  console.log(`[proxy] escuchando en http://localhost:${PORT} → ${NEXE_BASE_URL}`)
  if (!NEXE_API_KEY) {
    console.warn('[proxy] ADVERTENCIA: NEXE_API_KEY no configurada — las llamadas fallarán con 500')
  }
})
