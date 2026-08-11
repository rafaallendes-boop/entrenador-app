import type { RunningType, SquashSessionBlockKind, SquashSubtype, SupportedSport, TimeBlock } from '../../types'

/**
 * Versioned boundary between the provider and local week hydration.
 *
 * Keep this shape deliberately smaller than CoachSessionProposal: the provider
 * coordinates the week while local selectors own executable sport details.
 */
// v2: agrega `squashKind`, obligatorio para squash. La modalidad deja de
// derivarse de `focusKey`, que vuelve a ser sólo foco deportivo.
export const WEEK_CREATOR_SKELETON_VERSION = 'v2' as const

export const WEEK_CREATOR_SKELETON_SESSION_TYPES = [
  'squash',
  'running',
  'cycling',
  'strength',
  'mobility',
] as const satisfies readonly SupportedSport[]

export const WEEK_CREATOR_SKELETON_TIME_BLOCKS = ['AM', 'PM'] as const satisfies readonly TimeBlock[]

export const WEEK_CREATOR_SKELETON_SQUASH_SUBTYPES = [
  'training',
  'match',
  'competitive',
  'control',
  'light',
] as const satisfies readonly SquashSubtype[]

export const WEEK_CREATOR_SKELETON_SQUASH_KINDS = [
  'control',
  'technical',
  'shadows',
  'match',
] as const satisfies readonly SquashSessionBlockKind[]

export const WEEK_CREATOR_SKELETON_RUNNING_TYPES = [
  'z2',
  'tempo',
  'intervals',
  'long',
] as const satisfies readonly RunningType[]

export interface WeekCreatorSkeletonSession {
  date: string
  timeBlock: TimeBlock
  sessionType: SupportedSport
  durationMin: number
  rpe: number
  /** Compact semantic intent consumed by the local sport selector. */
  focusKey: string
  title: string
  objective: string
  /**
   * Modalidad de la sesión de squash. Obligatoria cuando sessionType='squash' y
   * rechazada en el resto: es la autoridad de composición, y sin ella la
   * modalidad volvería a inferirse de `focusKey` o del texto visible.
   */
  squashKind?: SquashSessionBlockKind
  /** Legacy context/intensity projection; `squashKind` owns modality. */
  subtype?: SquashSubtype
  /** Only useful for choosing the local running template. */
  runningType?: RunningType
}

export interface WeekCreatorSkeleton {
  type: 'create_week'
  reason: string
  targetDate: string
  weekObjectives?: string[]
  sessions: WeekCreatorSkeletonSession[]
}
