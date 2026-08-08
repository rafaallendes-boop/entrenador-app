import type { WhoopZoneDurations } from '../../types'

const ZONE_KEYS = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5'] as const

type ZoneKey = (typeof ZONE_KEYS)[number]

/**
 * Fuente única de la lista de columnas de `019`. La consumen el `SELECT` del
 * cliente, el payload del upsert del servidor y el guard de la migración.
 *
 * Vive en `src/` y no en `netlify/` para que el cliente pueda importarla sin
 * arrastrar código de Functions al bundle: si hubiera dos listas —una server-side
 * y un literal en el cliente— el guard cubriría solo una y ampliar la migración
 * sin tocar el `SELECT` pasaría inadvertido hasta un 400 en producción.
 *
 * El orden es el de la migración y el guard compara conjuntos ordenados, así que
 * agregar acá y no en el `.sql` (o al revés) rompe en CI.
 */
export const WHOOP_WORKOUT_ZONE_COLUMNS = [
  'zone_zero_milli',
  'zone_one_milli',
  'zone_two_milli',
  'zone_three_milli',
  'zone_four_milli',
  'zone_five_milli',
  'percent_recorded',
] as const

export interface WorkoutScoreDataInput {
  scoreState: unknown
  zones: Record<ZoneKey, unknown>
  percentRecorded: unknown
}

export interface WorkoutScoreData {
  zoneDurations?: WhoopZoneDurations
  percentRecorded?: number
}

/**
 * Única autoridad de forma de la distribución de zonas y de la cobertura.
 *
 * Recibe `scoreState` a propósito: el CHECK de `019` garantiza «solo con SCORED»
 * en Supabase, pero el tipo `WhoopWorkout` admite cualquier combinación, así que
 * un backup manipulado con `PENDING_SCORE` y seis zonas válidas pasaría un
 * normalizador que no mira el estado y quedaría en Dexie, donde ninguna
 * restricción lo alcanza.
 *
 * Los tres bordes que deserializan —normalizador del servidor, pull del cliente,
 * parser de import— SOLO adaptan nombres y delegan acá. Ninguno valida a mano;
 * misma doctrina que `normalizeSupersetGroups`.
 */
export function normalizeWorkoutScoreData(input: WorkoutScoreDataInput): WorkoutScoreData {
  if (input.scoreState !== 'SCORED') return {}

  return {
    ...(resolveZoneDurations(input.zones) ?? {}),
    ...(resolvePercentRecorded(input.percentRecorded) ?? {}),
  }
}

function resolveZoneDurations(
  zones: Record<ZoneKey, unknown>,
): { zoneDurations: WhoopZoneDurations } | null {
  const resolved = {} as WhoopZoneDurations
  let total = 0

  for (const key of ZONE_KEYS) {
    const value = zones[key]
    // Entero seguro, no solo número finito: el origen y la columna son int64
    // (`integer/int64` en el OpenAPI de Whoop, `bigint` en Supabase), así que un
    // 1.5 produciría un objeto válido en Dexie e incompatible con la base a la
    // que después se sincroniza.
    if (!Number.isSafeInteger(value)) return null
    const milli = value as number
    if (milli < 0) return null
    resolved[key] = milli
    total += milli
  }

  // Seis ceros son sintácticamente válidos y no describen nada. No equivalen a
  // un entrenamiento en reposo —eso sería z0 con la duración completa— sino a
  // uno del que no se midió ninguna zona.
  if (total <= 0) return null

  return { zoneDurations: resolved }
}

function resolvePercentRecorded(value: unknown): { percentRecorded: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || value > 100) return null
  return { percentRecorded: value }
}
