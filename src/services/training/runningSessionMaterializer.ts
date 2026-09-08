import type { AthleteProfile, RunningIntervalStructure, RunningType } from '../../types'
import { SESSION_COMPOSITION_MINUTES, sessionBudget, splitSeconds } from './sessionTimeBudget'

type PaceTargets = { targetPaceMin?: string; targetPaceMax?: string; targetHrMin?: number; targetHrMax?: number }
type RunningProfile = AthleteProfile['runningProfile']

function paceSeconds(pace: string | undefined): number | undefined {
  const match = pace?.match(/^(\d{1,2}):([0-5]\d)$/)
  if (!match) return undefined
  const seconds = Number(match[1]) * 60 + Number(match[2])
  return seconds > 0 ? seconds : undefined
}

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function validPace(value: string | undefined): string | undefined {
  return paceSeconds(value) == null ? undefined : value
}

export function runningTargets(runningType: RunningType, profile?: RunningProfile): PaceTargets {
  if (runningType === 'tempo') {
    const pace = validPace(profile?.thresholdPace)
    return { targetPaceMin: pace ? formatSeconds(Math.max(60, paceSeconds(pace)! - 10)) : undefined, targetPaceMax: pace }
  }
  if (runningType === 'intervals') {
    // fiveKTime is an elapsed time (mm:ss or hh:mm:ss), not a pace.
    const time = profile?.fiveKTime?.match(/^(?:(\d+):)?(\d{1,2}):([0-5]\d)$/)
    const seconds = time ? Number(time[1] ?? 0) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0
    const pace = seconds > 0 ? formatSeconds(Math.round(seconds / 5)) : undefined
    return { targetPaceMin: pace, targetPaceMax: pace }
  }
  const min = validPace(profile?.z2PaceMin ?? profile?.easyPaceMin)
  const max = validPace(runningType === 'long'
    ? profile?.longRunPace ?? profile?.z2PaceMax ?? profile?.easyPaceMax
    : profile?.z2PaceMax ?? profile?.easyPaceMax)
  return { targetPaceMin: min, targetPaceMax: max }
}

function formatPace(targets: PaceTargets): string | undefined {
  const min = validPace(targets.targetPaceMin)
  const max = validPace(targets.targetPaceMax)
  if (min && max) return `${min === max ? min : `${min}-${max}`} /km`
  return min || max ? `${min ?? max} /km` : undefined
}

export type RunningMaterialization =
  | { ok: true; structure: RunningIntervalStructure; targets: PaceTargets }
  | { ok: false; message: string }

/** Generic timed composition. Template identity/fidelity belongs to E3.
 * Recovery is a separate flat block, only BETWEEN repetitions. No new schema.
 */
export function materializeRunningSession(input: {
  runningType: RunningType
  durationMin: number
  profile?: RunningProfile
  targets?: PaceTargets
}): RunningMaterialization {
  const { runningType, durationMin, profile } = input
  const minimum = SESSION_COMPOSITION_MINUTES[runningType]
  if (!Number.isFinite(durationMin) || durationMin < minimum) {
    return { ok: false, message: `No cabe ${runningType} en ${durationMin} min: esta composición requiere al menos ${minimum} min, incluidos calentamiento y cierre.` }
  }
  const targets = { ...runningTargets(runningType, profile), ...input.targets }
  const mainPace = formatPace(targets)
  const easyPace = formatPace(runningTargets('z2', profile))
  const budget = sessionBudget(durationMin)
  const blocks: RunningIntervalStructure['blocks'] = [
    { label: 'Calentamiento Z2', durationMin: budget.warmupSec / 60, targetPace: easyPace,
      notes: 'Comenzar caminando o trotando suave y aumentar gradualmente. Incluido en el tiempo total.' },
  ]
  if (runningType === 'intervals') {
    const count = Math.max(2, Math.min(5, Math.floor(budget.workSec / 240)))
    const recovery = 60
    const workTotal = Math.min(180 * count, budget.workSec - recovery * (count - 1))
    const easy = budget.workSec - workTotal - recovery * (count - 1)
    if (easy > 0) blocks.push({ label: 'Rodaje suave previo a las series', durationMin: easy / 60,
      targetPace: easyPace, notes: 'Esfuerzo conversacional; estos minutos no aumentan la dosis de series.' })
    const work = splitSeconds(workTotal, count)
    work.forEach((seconds, index) => {
      blocks.push({ label: `Serie por tiempo ${index + 1}`, durationMin: seconds / 60,
        targetPace: mainPace, targetHrMax: targets.targetHrMax,
        notes: 'Esfuerzo exigente controlado; sin sprint. Composición por tiempo, no plantilla de distancia.' })
      if (index < count - 1) blocks.push({ label: 'Recuperación suave', durationMin: recovery / 60,
        targetPace: easyPace, notes: 'Caminar o trotar suavemente entre series.' })
    })
  } else {
    const workSec = runningType === 'tempo' ? Math.min(35 * 60, budget.workSec) : budget.workSec
    blocks.push({ label: runningType === 'tempo' ? 'Tempo umbral controlado'
      : runningType === 'long' ? 'Rodaje aeróbico por tiempo' : 'Trote Z2 continuo',
    durationMin: workSec / 60, targetPace: mainPace, targetHrMax: targets.targetHrMax,
    notes: runningType === 'tempo' ? 'Esfuerzo sostenido y controlado, sin terminar a tope.'
      : 'Esfuerzo conversacional; bajar el ritmo si no puedes hablar cómodamente.' })
    if (budget.workSec > workSec) blocks.push({ label: 'Rodaje suave después del tempo',
      durationMin: (budget.workSec - workSec) / 60, targetPace: easyPace,
      notes: 'Esfuerzo conversacional; no prolongar el trabajo de umbral.' })
  }
  blocks.push({ label: 'Enfriamiento Z2', durationMin: budget.cooldownSec / 60, targetPace: easyPace,
    notes: 'Reducir gradualmente hasta caminar. Incluido en el tiempo total.' })
  return { ok: true, structure: { blocks }, targets }
}
