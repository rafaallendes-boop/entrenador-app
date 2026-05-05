#!/usr/bin/env node
/**
 * Loadtest for week_creator against a running netlify dev (default :8888).
 *
 *   npm run dev          # in another terminal (or `netlify dev`)
 *   npm run loadtest:week-creator
 *
 * Notes:
 * - Sequential, NOT concurrent. Gemini Flash free tier rate-limits hard.
 * - Reports success rate, p50/p95 duration, error class distribution.
 * - Uses a minimal "create a week" user message; the server validates auth so
 *   you may need to set COACH_PROXY_REQUIRE_AUTH=false in .env (dev only) or
 *   pass an auth token via COACH_AUTH_TOKEN.
 */

const ENDPOINT = process.env.COACH_ENDPOINT ?? 'http://localhost:8888/.netlify/functions/coach'
const N = Number(process.env.LOADTEST_N ?? 10)
const AUTH_TOKEN = process.env.COACH_AUTH_TOKEN

const SYSTEM_PROMPT = `Eres el coach de un atleta de squash competitivo.
INSTRUCCIONES DE WEEK_CREATOR:
- Devuelve <actions> con un solo create_week.
- targetDate=lunes ISO de la semana solicitada.
- 5 sesiones: 2 squash, 1 running z2, 1 strength full-body, 1 mobility 30min.
- Cierra el bloque con </actions>.`

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
    const hasActions = typeof data.text === 'string' && /<actions>[\s\S]*<\/actions>/i.test(data.text)
    const hasCreateWeek = hasActions && /"type"\s*:\s*"create_week"/.test(data.text)
    return {
      ok: hasCreateWeek,
      dur,
      provider: data.provider,
      retryUsed: data.retryUsed,
      fallbackUsed: data.fallbackUsed,
      errorClass: hasCreateWeek ? null : 'invalid_payload',
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
  if (!AUTH_TOKEN) {
    console.log('No COACH_AUTH_TOKEN set — make sure COACH_PROXY_REQUIRE_AUTH=false in dev .env, or expect 401s.')
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

  // Exit code mirrors the success criterion in the plan: ≥90% and p95 < 20s.
  const passed = ok.length / N >= 0.9 && summary.p95ms < 20000
  process.exit(passed ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
