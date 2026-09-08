import { createHash } from 'node:crypto'

/**
 * Normalización y agregados del probe de selección deportiva (E0).
 *
 * Funciones puras, sin Vite ni Dexie, para que la parte del probe que decide
 * *qué* se compara entre dos corridas tenga sus propias pruebas. El artefacto
 * congelado es caracterización: describe lo que hoy ocurre, incluido lo que el
 * audit considera defectuoso.
 */

/**
 * Orden total de claves, recursivo. Sin esto el SHA-256 dependería del orden de
 * inserción de cada objeto y dos corridas idénticas podrían diferir.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry === undefined) continue
    out[key] = canonicalize(entry)
  }
  return out
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value), null, 2)
}

export function sha256Of(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

/**
 * Duración de una lista de bloques o drills.
 *
 * `unknownBlocks` no es cosmético: un bloque por distancia sin ritmo **no tiene
 * duración**, y sumarlo como cero haría que un total incompleto pareciera
 * cerrado. Es exactamente el vacío que E1 tiene que resolver, así que el probe
 * lo cuenta en vez de esconderlo.
 */
export function summarizeDose(items, { durationKey = 'durationMin' } = {}) {
  let knownMin = 0
  let unknownBlocks = 0
  for (const item of items ?? []) {
    const raw = item?.[durationKey]
    const repetitions = typeof item?.repetitions === 'number' ? item.repetitions : 1
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      knownMin += Math.round(raw * 60) * repetitions / 60
    } else {
      unknownBlocks += 1
    }
  }
  knownMin = Math.round(knownMin * 60) / 60
  return { knownMin, unknownBlocks, itemCount: (items ?? []).length }
}

/**
 * Contraste entre la duración pedida y la dosificada.
 *
 * `verdict` es descriptivo, no un criterio de aceptación: `unknown` significa
 * que el total no es computable con el modelo actual, que es distinto de
 * cuadrar o de no cuadrar.
 */
export function compareDuration(requestedMin, dose) {
  if (dose.unknownBlocks > 0) {
    return { requestedMin, ...dose, deltaMin: null, verdict: 'unknown' }
  }
  const deltaMin = dose.knownMin - requestedMin
  return {
    requestedMin,
    ...dose,
    deltaMin,
    verdict: deltaMin === 0 ? 'exact' : deltaMin > 0 ? 'over' : 'under',
  }
}

/** Ritmos por rol de bloque: detecta el calentamiento que hereda ritmo de trabajo (R7). */
export function analysePaceRoles(blocks) {
  const rows = (blocks ?? []).map((block) => ({
    label: block?.label ?? null,
    targetPace: block?.targetPace ?? null,
    role: classifyBlockRole(block?.label),
  }))
  const work = rows.filter((row) => row.role === 'work').map((row) => row.targetPace)
  const easy = rows.filter((row) => row.role !== 'work').map((row) => row.targetPace)
  const shared = easy.filter((pace) => pace != null && work.includes(pace))
  return { rows, sharedPaceWithWork: shared.length > 0, distinctPaces: [...new Set(rows.map((r) => r.targetPace))].length }
}

function classifyBlockRole(label) {
  const text = String(label ?? '').toLowerCase()
  if (text.includes('calentamiento') || text.includes('entrada')) return 'warmup'
  if (text.includes('enfriamiento') || text.includes('vuelta a la calma')) return 'cooldown'
  return 'work'
}

/**
 * Recuperaciones declaradas como texto en `notes` en vez de como estructura.
 * Es la métrica que dimensiona la extensión de tipos de E1.
 */
export function detectTextualRecoveries(blocks) {
  const pattern = /(recuper|trotando|descans|caminando)/i
  return (blocks ?? [])
    .filter((block) => typeof block?.notes === 'string' && pattern.test(block.notes))
    .map((block) => block.label ?? null)
}

/** Agregado por hallazgo: cuántos casos lo reprodujeron y en qué ruta. */
export function summarizeCoverage(sections) {
  const byFinding = {}
  for (const [section, cases] of Object.entries(sections)) {
    for (const item of cases ?? []) {
      for (const finding of item.covers ?? []) {
        const entry = (byFinding[finding] ??= { finding, sections: [], caseCount: 0 })
        entry.caseCount += 1
        if (!entry.sections.includes(section)) entry.sections.push(section)
      }
    }
  }
  for (const entry of Object.values(byFinding)) entry.sections.sort()
  return Object.keys(byFinding).sort().map((key) => byFinding[key])
}
