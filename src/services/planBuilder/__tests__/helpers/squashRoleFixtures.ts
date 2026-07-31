import type { CoachSessionProposal, SquashDrill } from '../../../../types'
import { buildSkeletonSessionForTest } from './repairTestFixtures'

export const SQUASH_NAMES = {
  FIVE_GAMES: 'Partido de entrenamiento al mejor de 5 juegos',
  BEST_OF_3: 'Partido de entrenamiento al mejor de 3 juegos',
  GAME_TO_11: 'Game a 11 con marcador real',
  ACTIVATION: 'Activación pre-partido de manos y pies',
  TECHNICAL: 'Tiros paralelos profundos',
  CONTROL: 'Tiros cruzados profundos',
} as const

/** Cuatro drills: ya densa para 60-75 min, así los tests no dependen del paso 6. */
export function drillSessionFixture(
  date: string,
  names: string[] = [SQUASH_NAMES.TECHNICAL, SQUASH_NAMES.CONTROL],
  durationMin = 60,
): CoachSessionProposal {
  const drills: SquashDrill[] = names.map((name) => ({
    name,
    durationMin: Math.round(durationMin / names.length),
  }))
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'training',
    title: 'Squash técnico',
    objective: 'Construir largo y control con ejecución limpia.',
    durationMin,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills,
    },
  })
}

export function standaloneSessionFixture(date: string, durationMin = 60): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'match',
    title: 'Partido de entrenamiento',
    objective: 'Competir puntos con estructura de partido.',
    durationMin,
    rpe: 8,
    squashDetails: {
      trainingFocus: 'tactical',
      sessionMode: 'practice_match',
      sessionKind: 'match',
      drills: [{ name: SQUASH_NAMES.FIVE_GAMES, durationMin }],
      blocks: [{ kind: 'match', drills: [{ name: SQUASH_NAMES.FIVE_GAMES, durationMin }] }],
    },
  })
}

/**
 * Sesión ya densa (3 lead + 1 finisher) para que el test no dependa de la
 * densificación del paso 6. `drills[]` es exactamente el flatten de `blocks`.
 */
export function finisherSessionFixture(
  date: string,
  finisherName: string = SQUASH_NAMES.BEST_OF_3,
  leadNames: string[] = [SQUASH_NAMES.TECHNICAL, SQUASH_NAMES.CONTROL, '100 drops en solitario (50 por lado)'],
  durationMin = 75,
): CoachSessionProposal {
  const lead: SquashDrill[] = leadNames.map((name) => ({ name, durationMin: 15 }))
  const finisher: SquashDrill = { name: finisherName, durationMin: 30 }
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'training',
    title: 'Squash con cierre competitivo',
    objective: 'Trabajo de largo y cierre con marcador.',
    durationMin,
    rpe: 7,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'mixed',
      drills: [...lead, finisher],
      blocks: [
        { kind: 'technical', drills: lead },
        { kind: 'match', drills: [finisher] },
      ],
    },
  })
}
