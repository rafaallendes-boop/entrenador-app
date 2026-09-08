export interface SquashAvailability {
  partnerAvailability?: 'solo' | 'partner' | 'either'
  coach?: boolean
  feeder?: boolean
  court?: boolean
  equipment?: string[]
}
export interface SquashTechnicalIntent {
  family: string
  side?: 'forehand' | 'backhand' | 'both'
  /** Declared goal, not an inferred achievement. */
  successTarget?: number
}
export interface SquashTechnicalResult {
  attempts: number
  successes: number
}
export interface SquashTrainingContext {
  availability?: SquashAvailability
  technicalIntent?: SquashTechnicalIntent
  technicalResult?: SquashTechnicalResult
  selectionReason?: string
}

/**
 * Combina la disponibilidad declarada en la sesión con la del plan.
 *
 * No sirve un spread: `sanitizeSquashTrainingContext` emite siempre la clave
 * `partnerAvailability`, a veces con valor `undefined`, así que una sesión que
 * sólo declara "cancha no disponible" borraba el `solo` del plan y readmitía
 * drills que exigen compañero.
 */
export function resolveSquashAvailability(
  sessionAvailability: SquashAvailability | undefined,
  planPartnerAvailability: SquashAvailability['partnerAvailability'],
): SquashAvailability {
  return {
    ...sessionAvailability,
    partnerAvailability: sessionAvailability?.partnerAvailability ?? planPartnerAvailability,
  }
}

export function sanitizeSquashTrainingContext(value: unknown): SquashTrainingContext {
  if (!value || typeof value !== 'object') return {}
  const row = value as Record<string, unknown>
  const result: SquashTrainingContext = {}
  if (row.availability && typeof row.availability === 'object') {
    const a = row.availability as Record<string, unknown>
    result.availability = {
      partnerAvailability: ['solo', 'partner', 'either'].includes(String(a.partnerAvailability)) ? a.partnerAvailability as SquashAvailability['partnerAvailability'] : undefined,
      ...Object.fromEntries(['coach', 'feeder', 'court'].filter(k => typeof a[k] === 'boolean').map(k => [k, a[k]])),
      equipment: Array.isArray(a.equipment) ? a.equipment.filter((v): v is string => typeof v === 'string') : undefined,
    }
  }
  if (row.technicalIntent && typeof row.technicalIntent === 'object') {
    const i = row.technicalIntent as Record<string, unknown>
    if (typeof i.family === 'string' && i.family.trim()) result.technicalIntent = {
      family: i.family.trim(), side: ['forehand', 'backhand', 'both'].includes(String(i.side)) ? i.side as SquashTechnicalIntent['side'] : undefined,
      successTarget: typeof i.successTarget === 'number' && i.successTarget > 0 && i.successTarget <= 100 ? i.successTarget : undefined,
    }
  }
  if (row.technicalResult && typeof row.technicalResult === 'object') {
    const r = row.technicalResult as Record<string, unknown>
    if (Number.isInteger(r.attempts) && Number(r.attempts) > 0 && Number.isInteger(r.successes) && Number(r.successes) >= 0 && Number(r.successes) <= Number(r.attempts)) result.technicalResult = { attempts: Number(r.attempts), successes: Number(r.successes) }
  }
  if (typeof row.selectionReason === 'string') result.selectionReason = row.selectionReason
  return result
}
