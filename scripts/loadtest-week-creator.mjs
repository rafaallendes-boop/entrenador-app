#!/usr/bin/env node
/**
 * Loadtest for week_creator against the local dev coach proxy.
 *
 *   npm run dev          # in another terminal
 *   npm run loadtest:week-creator
 *
 * Notes:
 * - Sequential, NOT concurrent. Gemini Flash free tier rate-limits hard.
 * - Reports success rate, p50/p95 duration, error class distribution.
 * - Defaults to the Vite dev proxy on :5173. If you intentionally use
 *   `netlify dev`, pass COACH_ENDPOINT=http://localhost:8888/.netlify/functions/coach.
 */

const ENDPOINT = process.env.COACH_ENDPOINT ?? 'http://localhost:5173/.netlify/functions/coach'
const N = Number(process.env.LOADTEST_N ?? 10)
const AUTH_TOKEN = process.env.COACH_AUTH_TOKEN

const SYSTEM_PROMPT = `Eres un generador de semanas de entrenamiento.
Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga UNA acción create_week.
Tu primer caracter debe ser "<" y tu último texto debe ser "</actions>".
No expliques nada fuera del bloque <actions>. Nada de texto previo ni posterior.
Dentro de <actions> debe haber un JSON array válido parseable con JSON.parse.
PROHIBIDO usar <action>, XML, atributos HTML/XML, timeBlock="evening", horarios tipo "18:00 - 19:00", markdown o comentarios.
La acción create_week debe tener exactamente "type": "create_week", targetDate, reason, sessions[] y weekObjectives[].
Cada sesión debe tener date, timeBlock, sessionType, title, durationMin y objective.
timeBlock acepta SOLO "AM" o "PM".
Planifica exactamente 5 sesiones: 2 squash, 1 running z2, 1 strength full-body y 1 mobility 30min.
Formato exacto esperado:
<actions>[{"type":"create_week","targetDate":"YYYY-MM-DD","reason":"loadtest","weekObjectives":["semana completa"],"sessions":[{"date":"YYYY-MM-DD","timeBlock":"AM","sessionType":"squash","title":"Squash tecnico","durationMin":60,"objective":"tecnica y control"}]}]</actions>
Cierra siempre el bloque con </actions>.`

const TARGET = nextMonday()

function nextMonday() {
  const d = new Date()
  const offset = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function pXX(arr, p) {
  if (!arr.length) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  return sorted[idx]
}

function stripCodeFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(stripCodeFences(text))
  } catch {
    return null
  }
}

function extractJsonArray(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function extractJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function normalizeActionsPayload(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { actions: null, reason: 'empty_response' }
  }

  const actionsMatch = text.match(/<actions>([\s\S]*?)<\/actions>/i)
  if (actionsMatch?.[1]) {
    if (/<\/?action(?:\s|>)/i.test(actionsMatch[1])) {
      return { actions: null, reason: 'pseudo_xml_action_tag' }
    }
    const parsed = parseJsonSafely(actionsMatch[1])
    return {
      actions: Array.isArray(parsed) ? parsed : parsed ? [parsed] : null,
      reason: parsed ? undefined : 'malformed_actions_json',
    }
  }

  const wholeParsed = parseJsonSafely(text)
  if (Array.isArray(wholeParsed)) return { actions: wholeParsed }
  if (wholeParsed && typeof wholeParsed === 'object') return { actions: [wholeParsed] }

  const jsonArray = extractJsonArray(text)
  if (jsonArray) {
    const parsed = parseJsonSafely(jsonArray)
    if (Array.isArray(parsed)) return { actions: parsed }
  }

  const jsonObject = extractJsonObject(text)
  if (jsonObject) {
    const parsed = parseJsonSafely(jsonObject)
    if (parsed && typeof parsed === 'object') return { actions: [parsed] }
  }

  return { actions: null, reason: /<\/?\w+[\s>]/.test(text) ? 'xml_like_payload' : 'missing_json_payload' }
}

function validateCreateWeekPayload(text) {
  const { actions, reason } = normalizeActionsPayload(text)
  const createWeek = actions?.find((action) => action?.type === 'create_week')
  if (!createWeek) return { ok: false, reason: reason ?? 'missing_create_week' }
  if (createWeek.targetDate !== TARGET) return { ok: false, reason: 'wrong_targetDate' }
  if (!Array.isArray(createWeek.sessions) || createWeek.sessions.length === 0) {
    return { ok: false, reason: 'missing_sessions' }
  }
  return {
    ok: true,
    actionCount: actions.length,
    sessionCount: createWeek.sessions.length,
  }
}

function snippet(text, maxLength = 220) {
  if (typeof text !== 'string') return ''
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

async function runOne(i) {
  const t0 = Date.now()
  const headers = { 'Content-Type': 'application/json' }
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: `Crea la semana del ${TARGET} (loadtest #${i + 1})`,
        requestClass: 'week_creator',
        traceId: `loadtest-${Date.now()}-${i}`,
        maxTokens: 3500,
        temperature: 0.4,
        allowFallback: true,
      }),
    })
    const data = await res.json().catch(() => ({}))
    const dur = Date.now() - t0
    if (!res.ok) {
      return { ok: false, dur, errorClass: data.errorCode ?? `http_${res.status}`, message: data.error }
    }
    const payloadCheck = validateCreateWeekPayload(data.text)
    return {
      ok: payloadCheck.ok,
      dur,
      provider: data.provider,
      retryUsed: data.retryUsed,
      fallbackUsed: data.fallbackUsed,
      actionCount: payloadCheck.actionCount,
      sessionCount: payloadCheck.sessionCount,
      errorClass: payloadCheck.ok ? null : `invalid_payload:${payloadCheck.reason}`,
      sample: payloadCheck.ok ? undefined : snippet(data.text),
    }
  } catch (error) {
    return {
      ok: false,
      dur: Date.now() - t0,
      errorClass: 'network_error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  console.log(`Loadtest: ${N} sequential requests against ${ENDPOINT}`)
  console.log(`Target week start: ${TARGET}`)
  if (!AUTH_TOKEN && ENDPOINT.includes(':8888')) {
    console.log('No COACH_AUTH_TOKEN set — Netlify function auth may return 401 unless dev auth is disabled.')
  }
  const results = []
  for (let i = 0; i < N; i++) {
    process.stdout.write(`[${i + 1}/${N}] `)
    const r = await runOne(i)
    results.push(r)
    process.stdout.write(`${r.ok ? 'ok' : 'fail'} ${r.dur}ms${r.errorClass ? ` (${r.errorClass})` : ''}\n`)
  }

  const ok = results.filter((r) => r.ok)
  const durations = results.map((r) => r.dur)
  const errorBreakdown = results
    .filter((r) => !r.ok)
    .reduce((acc, r) => {
      const key = r.errorClass ?? 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})

  const summary = {
    n: N,
    successRate: `${((ok.length / N) * 100).toFixed(1)}%`,
    p50ms: pXX(durations, 0.5),
    p95ms: pXX(durations, 0.95),
    maxMs: Math.max(...durations),
    retriesUsed: results.filter((r) => r.retryUsed).length,
    fallbacksUsed: results.filter((r) => r.fallbackUsed).length,
    errorBreakdown,
  }

  console.log('\n=== Summary ===')
  console.log(JSON.stringify(summary, null, 2))

  const invalidSamples = results
    .filter((result) => !result.ok && result.sample)
    .slice(0, 3)

  if (invalidSamples.length > 0) {
    console.log('\n=== Invalid payload samples ===')
    invalidSamples.forEach((result, index) => {
      console.log(`[${index + 1}] ${result.errorClass}: ${result.sample}`)
    })
  }

  // Exit code mirrors the success criterion in the plan: ≥90% and p95 < 20s.
  const passed = ok.length / N >= 0.9 && summary.p95ms < 20000
  process.exit(passed ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
