import type { RunningIntervalBlock, RunningMaterializationIntent, RunningProfile } from '../../types'
import type { RunningEffort } from '../../types/runningTemplate'
import { findRunningSessionById, type RunningSessionDefinition } from './runningSessionLibrary'
import { sessionBudget } from './sessionTimeBudget'

export const RUNNING_MATERIALIZER_VERSION = 1

/**
 * Labels de los dos bloques de relleno que absorben el remanente de tiempo
 * antes de las repeticiones/cuestas o del tramo continuo. Van a ritmo fácil y
 * se etiquetan `role: 'work'` porque cuentan para el presupuesto total de la
 * sesión, no porque sean trabajo exigente — por eso consumidores como
 * `runningDoseDiff.ts` necesitan poder excluirlos por nombre. Exportados como
 * constante (no duplicados como literales) para que un futuro renombre de
 * copy los rompa en compilación, no en silencio.
 */
export const FILLER_BLOCK_LABEL = 'Rodaje suave'
export const FILLER_BLOCK_LABEL_WALK = 'Caminata suave'

function paceFromElapsed(value: string | undefined, km: number): number | undefined {
  const parts = value?.split(':').map(Number)
  if (!parts || parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)
    || parts.at(-1)! >= 60) return undefined
  const sec = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2]
  return sec > 0 ? Math.ceil(sec / km) : undefined
}
function paceSeconds(value?: string): number | undefined {
  return value && /^\d+:[0-5]\d$/.test(value) ? paceFromElapsed(value, 1) : undefined
}
function paceText(sec?: number): string | undefined {
  return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /km` : undefined
}
export function runningEffortPace(effort: RunningEffort, profile?: RunningProfile): number | undefined {
  switch (effort) {
    case 'easy': return paceSeconds(profile?.z2PaceMax ?? profile?.easyPaceMax ?? profile?.z2PaceMin ?? profile?.easyPaceMin)
    case 'threshold': return paceSeconds(profile?.thresholdPace)
    case 'five_k': return paceFromElapsed(profile?.fiveKTime, 5)
    case 'ten_k': return paceFromElapsed(profile?.tenKTime, 10)
    case 'half_marathon': return paceFromElapsed(profile?.halfMarathonTime, 21.0975)
    case 'marathon': return undefined
    default: return undefined
  }
}

const EFFORT_LABELS: Record<RunningEffort, string> = {
  easy: 'conversacional', steady: 'sostenido controlado', threshold: 'umbral controlado',
  five_k: 'esfuerzo de 5K', ten_k: 'esfuerzo de 10K', half_marathon: 'esfuerzo de media maratón',
  hill_hard: 'exigente en cuesta, mantener técnica', hill_sprint: 'rápido en cuesta, pausa completa entre salidas', marathon: 'esfuerzo de maratón', stride: 'aceleración fluida, sin sprint máximo',
}

export function materializeRunningTemplate(input: {
  template: string | RunningSessionDefinition
  durationMin: number
  profile?: RunningProfile
  intent?: RunningMaterializationIntent
  profileRevision?: number
}) {
  const definition = typeof input.template === 'string' ? findRunningSessionById(input.template) : input.template
  const failed = (message: string) => ({ ok: false as const, message })
  if (!definition) return failed('Plantilla de running desconocida.')
  const p = definition.prescription
  if (!Number.isFinite(input.durationMin) || input.durationMin < p.minimumMinutes) return failed(`${definition.name} requiere al menos ${p.minimumMinutes} min en esta composición.`)
  const budget = sessionBudget(input.durationMin)
  const easyPace = runningEffortPace('easy', input.profile)
  const workPace = p.terrain === 'hill' ? undefined : runningEffortPace(p.effort, input.profile)
  if (p.distanceKm && !workPace) return failed(`${definition.name} necesita un ritmo de referencia para estimar sus bloques por distancia; elige una variante por tiempo.`)
  const blocks: RunningIntervalBlock[] = []
  const push = (label: string, seconds: number, role: NonNullable<RunningIntervalBlock['role']>, effort: RunningEffort = 'easy', extra: Partial<RunningIntervalBlock> = {}) => {
    if (seconds > 0) blocks.push({ label, role, durationMin: seconds / 60, durationBasis: 'total', durationKind: 'prescribed',
      targetPace: paceText(effort === 'easy' ? easyPace : workPace), notes: `Esfuerzo ${EFFORT_LABELS[effort]}. Incluido en el tiempo total.`, ...extra })
  }
  push('Calentamiento Z2', budget.warmupSec, 'warmup')
  let main = budget.workSec
  if (p.techniqueSeconds) {
    main -= p.techniqueSeconds
    const steps = ['Marcha A: rodilla cómoda y tronco estable', 'Skipping bajo: contactos suaves debajo del cuerpo', 'Apoyos cortos: pasos relajados sin buscar velocidad']
    for (let i = 0; i < steps.length; i++) push(steps[i], Math.floor(p.techniqueSeconds / 3) + (i < p.techniqueSeconds % 3 ? 1 : 0), 'technique', 'easy', { targetPace: undefined })
  }
  if (p.kind === 'continuous' || p.kind === 'progressive') {
    const work = p.kind === 'progressive' ? Math.min(p.workSeconds ?? Math.floor(main * 0.35), main)
      : Math.min(p.workSeconds ?? main, main)
    const adjusted = input.intent === 'deload' && p.effort !== 'easy' ? Math.floor(work * 0.7) : work
    if (main > adjusted) push(FILLER_BLOCK_LABEL, main - adjusted, 'work')
    push(p.kind === 'progressive' ? 'Cierre progresivo controlado' : definition.name, adjusted, 'work', p.effort)
  } else {
    const baseSeconds = p.kind === 'run_walk' && input.profile?.experienceLevel === 'beginner' ? Math.min(p.workSeconds!, 60) : p.workSeconds!
    const sec = p.distanceKm ? Math.ceil(p.distanceKm * workPace!) : p.kind === 'run_walk' ? Math.max(30, baseSeconds + (input.intent === 'progress' ? 30 : input.intent === 'deload' ? -30 : 0)) : baseSeconds
    const rest = p.recoverySeconds ?? 0
    const available = main - (p.minimumEasySeconds ?? 0)
    const fits = Math.floor((available + rest) / (sec + rest))
    const maximum = Math.min(p.repetitions!.max, fits)
    if (maximum < p.repetitions!.min) return failed(`No caben trabajo y recuperaciones de ${definition.name} en ${input.durationMin} min.`)
    const count = Math.max(p.repetitions!.min, Math.floor(maximum * (input.intent === 'deload' ? 0.7 : input.intent === 'progress' ? 1 : 0.85)))
    const remainder = main - sec * count - rest * (count - 1)
    push(p.kind === 'run_walk' ? FILLER_BLOCK_LABEL_WALK : FILLER_BLOCK_LABEL, remainder, p.kind === 'run_walk' ? 'recovery' : 'work', 'easy', p.kind === 'run_walk' ? { targetPace: undefined } : {})
    for (let i = 0; i < count; i++) {
      push(`${p.kind === 'run_walk' ? 'Trote suave' : p.terrain === 'hill' ? 'Cuesta' : 'Repetición'} ${i + 1}`, sec, 'work', p.effort, {
        distanceKm: p.distanceKm, durationKind: p.distanceKm ? 'estimated' : 'prescribed',
        ...(p.terrain === 'hill' ? { targetPace: undefined, notes: `${EFFORT_LABELS[p.effort]}; cuesta con pendiente adecuada y espacio de frenado. Dosis por tiempo.` } : {}),
      })
      if (i < count - 1) push(p.kind === 'run_walk' ? 'Recuperación caminando' : 'Recuperación suave', rest, 'recovery', 'easy', p.kind === 'run_walk' ? { targetPace: undefined } : {})
    }
  }
  push('Enfriamiento Z2', budget.cooldownSec, 'cooldown')
  return { ok: true as const, structure: { blocks }, durationMin: input.durationMin,
    templateRef: { source: 'running_template' as const, id: definition.id, version: definition.version },
    materialization: {
      intent: input.intent ?? 'hold',
      recipeVersion: definition.version,
      materializerVersion: RUNNING_MATERIALIZER_VERSION,
      ...(input.profileRevision != null ? { profileRevision: input.profileRevision } : {}),
      at: Date.now(),
    } }
}
