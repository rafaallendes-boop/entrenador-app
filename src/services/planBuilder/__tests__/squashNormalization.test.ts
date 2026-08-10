import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, SquashDrill } from '../../../types'
import { findSquashDrillByName, resolveDrillExecutionMode, resolveSquashDrillKind, SQUASH_DRILL_LIBRARY } from '../../training/drillLibrary'
import { repairGeneratedWeek } from '../repairWeek'
import { summarizeTaxonomy } from '../repairTaxonomy'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const TECHNICAL_A = 'Tiros paralelos profundos'
const TECHNICAL_B = 'Tiros cruzados profundos'
const TECHNICAL_C = 'Cambio de paralelo a cruzado'
const TECHNICAL_DRILLS = [TECHNICAL_A, TECHNICAL_B, TECHNICAL_C]

function squashSession(
  date: string,
  drills: SquashDrill[],
  overrides: Partial<CoachSessionProposal> = {},
): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash técnico',
    objective: 'Construir largo y control con ejecución limpia.',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills,
    },
    ...overrides,
  })
}

function contextFor(weekIndex = 0) {
  const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 })
  context.plan = {
    ...context.plan,
    totalWeeks: 2,
    phases: [{ phase: 'base', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
  }
  context.week = {
    ...context.week,
    weekIndex,
    weekStartDate: weekIndex === 0 ? '2026-08-03' : '2026-08-10',
    phase: 'base',
  }
  context.planWeekDescriptors = [
    { weekIndex: 0, phase: 'base' },
    { weekIndex: 1, phase: 'base' },
  ]
  return context
}

function signature(session: CoachSessionProposal): string {
  return (session.squashDetails?.drills ?? [])
    .map((drill) => findSquashDrillByName(drill.name)?.id ?? drill.name)
    .sort((left, right) => left.localeCompare(right))
    .join('|')
}

function squashSessions(result: ReturnType<typeof repairGeneratedWeek>): CoachSessionProposal[] {
  return result.sessions.filter((session) => session.sessionType === 'squash')
}

describe('normalización única de squash', () => {
  it('semana 0 sin duplicados conserva los drills y no mide política', () => {
    const source = squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 15 }])
    const result = repairGeneratedWeek([source], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(squashSessions(result)[0]?.squashDetails?.drills[0]?.name).toBe(TECHNICAL_A)
    expect(result.meta.squashDrillRotationActionCount).toBeUndefined()
  })

  it('semana 0 corrige firmas duplicadas sin contar política', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 15 }]),
      squashSession('2026-08-05', [{ name: TECHNICAL_A, durationMin: 15 }]),
    ], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(new Set(squashSessions(result).map(signature)).size).toBe(2)
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount).toBeGreaterThan(0)
    expect(result.meta.squashDrillRotationActionCount).toBeUndefined()
  })

  it('usa una coordenada de tres componentes para separar slots equivalentes', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [
        { name: TECHNICAL_A, durationMin: 10 },
        { name: TECHNICAL_B, durationMin: 10 },
      ]),
      squashSession('2026-08-12', [
        { name: TECHNICAL_A, durationMin: 10 },
        { name: TECHNICAL_B, durationMin: 10 },
      ]),
    ], contextFor(1))
    const drills = squashSessions(result).flatMap((session) => session.squashDetails?.drills ?? [])
    expect(new Set(drills.map((drill) => drill.name)).size).toBe(drills.length)
  })

  it('no introduce un nombre ya reservado en el resultado final de política', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 12 }]),
      squashSession('2026-08-12', [{ name: TECHNICAL_B, durationMin: 12 }]),
    ], contextFor(1))
    const drills = squashSessions(result).flatMap((session) => session.squashDetails?.drills ?? [])
    expect(new Set(drills.map((drill) => drill.name)).size).toBe(drills.length)
  })

  it('conserva el kind estructural bajo política estricta', () => {
    const source = squashSession('2026-08-10', TECHNICAL_DRILLS.map((name) => ({ name, durationMin: 12 })))
    const beforeKinds = source.squashDetails!.drills.map((drill) =>
      resolveSquashDrillKind(findSquashDrillByName(drill.name)!),
    ).sort()
    const result = repairGeneratedWeek([source], contextFor(1))
    const afterKinds = squashSessions(result)[0]!.squashDetails!.drills.map((drill) =>
      resolveSquashDrillKind(findSquashDrillByName(drill.name)!),
    ).sort()
    // La hidratación previa puede completar un drill de control; los slots
    // existentes mantienen el kind técnico bajo la política estricta.
    expect(afterKinds.filter((kind) => kind === 'technical')).toHaveLength(beforeKinds.length)
  })

  it('reemplaza la guía anterior por la explicación canónica del drill nuevo', () => {
    const source = squashSession('2026-08-10', TECHNICAL_DRILLS.map((name) => ({
      name,
      durationMin: 17,
      notes: 'nota que pertenece al drill anterior',
      executionMode: 'partner',
    })))
    const result = repairGeneratedWeek([source], contextFor(1))
    const drills = squashSessions(result)[0]?.squashDetails?.drills ?? []
    // El hidratador anterior puede redistribuir duración para cerrar la sesión,
    // pero ningún detalle del drill viejo puede sobrevivir al reemplazo.
    expect(drills.every((drill) => Boolean(drill.notes?.trim()))).toBe(true)
    const replacements = drills.filter((drill) => drill.notes !== 'nota que pertenece al drill anterior')
    expect(replacements.length).toBeGreaterThan(0)
    expect(replacements.every((drill) =>
      drill.notes === findSquashDrillByName(drill.name)?.description,
    )).toBe(true)
    expect(replacements.every((drill) =>
      drill.executionMode === resolveDrillExecutionMode(findSquashDrillByName(drill.name)!),
    )).toBe(true)
  })

  it('completa guía faltante incluso cuando el drill ya era válido', () => {
    const source = squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 15 }])
    const result = repairGeneratedWeek([source], contextFor(0))
    const drill = squashSessions(result)[0]?.squashDetails?.drills[0]

    expect(drill?.notes).toBe(findSquashDrillByName(drill!.name)?.description)
    expect(drill?.executionMode).toBe(resolveDrillExecutionMode(findSquashDrillByName(drill!.name)!))
  })

  it('reconstruye blocks a partir de los drills finales', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], contextFor(1))
    const details = squashSessions(result)[0]?.squashDetails
    expect(details?.blocks.flatMap((block) => block.drills).map((drill) => drill.name).sort())
      .toEqual(details?.drills.map((drill) => drill.name).sort())
  })

  it('cuenta omisión y conserva el original cuando el pool no existe', () => {
    const context = contextFor(1)
    context.previousWeek = {
      ...context.week,
      id: 'previous-ready',
      weekIndex: 0,
      status: 'draft',
      sessions: [squashSession('2026-08-03', SQUASH_DRILL_LIBRARY.map((drill) => ({ name: drill.name, durationMin: 1 })))],
    }
    const result = repairGeneratedWeek([squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }])], context)
    expect(squashSessions(result)[0]?.squashDetails?.drills.some((drill) => drill.name === TECHNICAL_A)).toBe(true)
    expect(result.meta.squashDrillRotationOmittedCount).toBeGreaterThan(0)
  })

  it('conserva dos matches standalone manteniendo exposición competitiva', () => {
    const match = (date: string) => squashSession(date, [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }], {
      subtype: 'competitive',
      title: 'Match competitivo de squash',
      objective: 'Competir con marcador real y presión de cierre.',
      squashDetails: {
        trainingFocus: 'conditioned_games',
        sessionMode: 'competition_match',
        sessionKind: 'match',
        drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }],
      },
    })
    const result = repairGeneratedWeek([match('2026-08-03'), match('2026-08-05')], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(squashSessions(result).some((session) => session.squashDetails?.sessionMode === 'competition_match')).toBe(true)
  })

  it('valida la exposición competitiva sobre la semana final', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-03', [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }], {
        subtype: 'competitive', title: 'Match competitivo', objective: 'Competir con marcador real.',
      }),
      squashSession('2026-08-05', [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }], {
        subtype: 'competitive', title: 'Match competitivo', objective: 'Competir con marcador real.',
      }),
    ], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(squashSessions(result).some((session) => session.squashDetails?.sessionMode === 'competition_match')).toBe(true)
  })

  it('falla cerrado si no existe una asignación segura para una firma duplicada', () => {
    const context = contextFor(0)
    context.previousWeek = {
      ...context.week,
      id: 'previous-ready',
      weekIndex: 1,
      status: 'draft',
      sessions: [squashSession('2026-08-10', SQUASH_DRILL_LIBRARY.map((drill) => ({ name: drill.name, durationMin: 1 })))],
    }
    const duplicateDrills = TECHNICAL_DRILLS.map((name) => ({ name, durationMin: 10 }))
    const result = repairGeneratedWeek([
      squashSession('2026-08-03', duplicateDrills),
      squashSession('2026-08-05', duplicateDrills),
    ], context)
    expect(result.sessions).toEqual([])
    expect(result.failure?.errorClass).toBe('quality.squash.signature_uniqueness_unresolved')
    expect(result.meta.squashDrillRotationOmittedCount).toBeUndefined()
  })

  it('es idempotente en una segunda ejecución de política', () => {
    const context = contextFor(1)
    const first = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], context)
    const second = repairGeneratedWeek(first.sessions, context)
    expect(second.sessions).toEqual(first.sessions)
    expect(second.meta.squashDrillRotationActionCount).toBe(0)
  })

  it('no infla countRepairsV2 cuando solo aplica política', () => {
    const baseline = repairGeneratedWeek([
      squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], contextFor(0))
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], contextFor(1))
    expect(summarizeTaxonomy(result.meta.taxonomy)).toEqual(summarizeTaxonomy(baseline.meta.taxonomy))
  })
})
