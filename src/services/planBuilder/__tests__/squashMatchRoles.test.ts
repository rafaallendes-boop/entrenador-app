import { describe, expect, it } from 'vitest'

import { findSquashDrillByName } from '../../training/drillLibrary'
import { resolveSquashMatchRole } from '../../training/squashMatchRole'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'
import {
  drillSessionFixture,
  finisherSessionFixture,
  SQUASH_NAMES,
  standaloneSessionFixture,
} from './helpers/squashRoleFixtures'

const ATTACK = 'Partido con ataque temprano'

describe('drill eliminado: ataque temprano', () => {
  it('ya no existe en el catálogo', () => {
    expect(findSquashDrillByName(ATTACK)?.id).not.toBe('practice_match_short_points_attack')
  })

  it('un plan legado que lo referencia solo termina resuelto y sin failure', () => {
    const result = repairGeneratedWeek(
      [drillSessionFixture('2026-08-03', [ATTACK])],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.failure).toBeUndefined()
    const drills = result.sessions[0]?.squashDetails?.drills ?? []
    expect(drills.length).toBeGreaterThan(0)
    for (const drill of drills) expect(findSquashDrillByName(drill.name)).toBeDefined()
  })

  it('dentro de una sesión mixta conserva el resto', () => {
    const result = repairGeneratedWeek(
      [drillSessionFixture('2026-08-03', [SQUASH_NAMES.TECHNICAL, ATTACK])],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.failure).toBeUndefined()
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((drill) => drill.name)
    expect(names).toContain(SQUASH_NAMES.TECHNICAL)
    for (const name of names) expect(findSquashDrillByName(name)).toBeDefined()
  })
})

describe('densificación role-aware', () => {
  it('densifica un finisher escaso sin perder su rol', () => {
    const sparse = finisherSessionFixture(
      '2026-08-03',
      SQUASH_NAMES.BEST_OF_3,
      [SQUASH_NAMES.TECHNICAL],
      75,
    )
    const result = repairGeneratedWeek(
      [sparse],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    const details = result.sessions[0]?.squashDetails

    expect(resolveSquashMatchRole(details)).toBe('finisher')
    expect(details?.drills.at(-1)?.name).toBe(SQUASH_NAMES.BEST_OF_3)
    expect(details?.drills.filter((drill) => drill.name === SQUASH_NAMES.BEST_OF_3)).toHaveLength(1)
  })
})

describe('semántica role-aware', () => {
  it('conserva ID, bloques y metadata de ambos finishers a través de dos pasadas', () => {
    for (const name of [SQUASH_NAMES.BEST_OF_3, SQUASH_NAMES.GAME_TO_11]) {
      const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
      const first = repairGeneratedWeek([finisherSessionFixture('2026-08-03', name)], context)
      const second = repairGeneratedWeek(first.sessions, context)
      const details = second.sessions[0]?.squashDetails

      expect(resolveSquashMatchRole(details)).toBe('finisher')
      expect(details?.drills.at(-1)?.name).toBe(name)
      expect(details?.sessionMode).toBe('drill_session')
      expect(details?.sessionKind).toBe('mixed')
    }
  })

  it('no proyecta una activación aislada a standalone', () => {
    const result = repairGeneratedWeek(
      [drillSessionFixture('2026-08-03', [SQUASH_NAMES.ACTIVATION], 40)],
      buildRepairContextForTest({ primarySport: 'squash', phase: 'taper', sessionsPerWeek: 1 }),
    )

    expect(result.sessions[0]?.squashDetails?.drills.map((drill) => drill.name))
      .not.toContain(SQUASH_NAMES.FIVE_GAMES)
  })

  it('retira el contenido competitivo no canónico de una sesión mixta y conserva el resto', () => {
    const mixed = drillSessionFixture('2026-08-03', [
      SQUASH_NAMES.TECHNICAL,
      SQUASH_NAMES.FIVE_GAMES,
      SQUASH_NAMES.BEST_OF_3,
    ])
    // El texto no puede convertir una mezcla inválida en partido standalone.
    mixed.title = 'Partido mixto de squash'
    const result = repairGeneratedWeek(
      [mixed],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    const names = result.sessions[0]?.squashDetails?.drills.map((drill) => drill.name) ?? []

    expect(result.failure).toBeUndefined()
    expect(names).toContain(SQUASH_NAMES.TECHNICAL)
    expect(names).not.toContain(SQUASH_NAMES.FIVE_GAMES)
    expect(names).not.toContain(SQUASH_NAMES.BEST_OF_3)
  })
})

describe('mínimo de drills', () => {
  it('no densifica un standalone de 60 min', () => {
    const result = repairGeneratedWeek(
      [standaloneSessionFixture('2026-08-03', 60)],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )

    expect(result.sessions[0]?.squashDetails?.drills).toHaveLength(1)
  })

  it('hidrata un esqueleto de partido como standalone', () => {
    const result = repairGeneratedWeek([{
      date: '2026-08-03', timeBlock: 'AM', sessionType: 'squash', subtype: 'match',
      title: 'Squash juego', objective: 'Objetivo de Squash juego', durationMin: 60, rpe: 6,
    }], buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }))

    expect(resolveSquashMatchRole(result.sessions[0]?.squashDetails)).toBe('standalone')
  })
})

describe('exposición competitiva en el repair', () => {
  it('no agrega ni convierte otra sesión si ya existe un finisher en fecha segura', () => {
    const result = repairGeneratedWeek([
      finisherSessionFixture('2026-08-03'),
      drillSessionFixture('2026-08-05'),
      drillSessionFixture('2026-08-07'),
    ], buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 3 }))

    expect(result.sessions
      .filter((session) => session.sessionType === 'squash')
      .map((session) => session.squashDetails?.sessionMode)).not.toContain('competition_match')
    expect(result.meta.warnings.map((warning) => warning.code))
      .not.toContain('squash_competition_match_added')
  })

  it('retira solo el bloque final de un finisher a menos de 48 h del evento', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'taper', sessionsPerWeek: 2 })
    const dayBefore = new Date(new Date(`${context.plan.macroSnapshot.goalEventDate}T00:00:00Z`).getTime() - 86_400_000)
      .toISOString()
      .slice(0, 10)
    context.week = { ...context.week, weekStartDate: dayBefore }

    const result = repairGeneratedWeek([finisherSessionFixture(dayBefore)], context)
    const names = result.sessions[0]?.squashDetails?.drills.map((drill) => drill.name) ?? []

    expect(names).toContain(SQUASH_NAMES.TECHNICAL)
    expect(names).not.toContain(SQUASH_NAMES.BEST_OF_3)
  })
})

describe('dos standalone conviven', () => {
  it('el repair no falla ni cambia sus partidos', () => {
    const result = repairGeneratedWeek(
      [standaloneSessionFixture('2026-08-03'), standaloneSessionFixture('2026-08-05')],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 }),
    )

    expect(result.failure).toBeUndefined()
    expect(result.sessions.filter((session) => session.sessionType === 'squash')).toHaveLength(2)
    for (const session of result.sessions) {
      if (session.sessionType !== 'squash') continue
      expect(session.squashDetails?.drills.map((drill) => drill.name)).toEqual([SQUASH_NAMES.FIVE_GAMES])
    }
  })
})

describe('rotación respeta el rol', () => {
  function blockContext(
    weekIndex: number,
    sessionsPerWeek = 1,
    phase: 'base' | 'build' | 'peak' | 'taper' = 'base',
  ) {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek })
    context.plan = {
      ...context.plan,
      totalWeeks: 2,
      phases: [{ phase, startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    }
    context.week = { ...context.week, weekIndex, weekStartDate: '2026-08-10', phase }
    context.planWeekDescriptors = [
      { weekIndex: 0, phase },
      { weekIndex: 1, phase },
    ]
    return context
  }

  it('con política activa un finisher sigue siendo finisher', () => {
    const result = repairGeneratedWeek([finisherSessionFixture('2026-08-10')], blockContext(1))
    expect(resolveSquashMatchRole(result.sessions[0]?.squashDetails)).toBe('finisher')
    expect(result.meta.squashDrillRotationOmittedCount).toBeGreaterThan(0)
  })

  it('con política activa un standalone no rota', () => {
    const result = repairGeneratedWeek([standaloneSessionFixture('2026-08-10')], blockContext(1))
    expect(result.sessions[0]?.squashDetails?.drills.map((drill) => drill.name))
      .toEqual([SQUASH_NAMES.FIVE_GAMES])
  })

  // El finisher solo tiene par rotable en build/peak: ningún drill de partido
  // lleva los tags que `filterByPhase` exige en base/taper. Ese slot se queda
  // sin candidatos y no debe arrastrar al resto de la sesión.
  for (const phase of ['base', 'build', 'peak', 'taper'] as const) {
    it(`diferencia dos finishers duplicados sin destruir sus roles (${phase})`, () => {
      const result = repairGeneratedWeek([
        finisherSessionFixture('2026-08-10', SQUASH_NAMES.BEST_OF_3),
        finisherSessionFixture('2026-08-12', SQUASH_NAMES.BEST_OF_3),
      ], blockContext(0, 2, phase))

      expect(result.failure).toBeUndefined()
      const squash = result.sessions.filter((item) => item.sessionType === 'squash')
      expect(squash).toHaveLength(2)
      expect(new Set(squash.map((session) =>
        session.squashDetails?.drills.map((drill) => drill.name).join('|'))).size).toBe(2)
      for (const session of squash) {
        // En taper el cierre competitivo se retira por cercanía al evento, que
        // es la regla de `normalizeLateTaperSquashMatchPlay`, no una pérdida
        // de rol en la rotación.
        expect(resolveSquashMatchRole(session.squashDetails))
          .toBe(phase === 'taper' ? 'none' : 'finisher')
      }
    })
  }

  it('diferencia dos finishers duplicados en taper lejos del evento', () => {
    const context = buildRepairContextForTest({
      primarySport: 'squash',
      sessionsPerWeek: 2,
      phase: 'taper',
    })
    const result = repairGeneratedWeek([
      finisherSessionFixture('2026-08-03', SQUASH_NAMES.BEST_OF_3),
      finisherSessionFixture('2026-08-05', SQUASH_NAMES.BEST_OF_3),
    ], context)

    expect(result.failure).toBeUndefined()
    const squash = result.sessions.filter((item) => item.sessionType === 'squash')
    expect(squash).toHaveLength(2)
    expect(new Set(squash.map((session) =>
      session.squashDetails?.drills.map((drill) => drill.name).join('|'))).size).toBe(2)
    for (const session of squash) {
      expect(resolveSquashMatchRole(session.squashDetails)).toBe('finisher')
    }
  })
})

describe('sessionMode ausente', () => {
  function sessionWithoutMode() {
    return buildSkeletonSessionForTest({
      date: '2026-08-03',
      timeBlock: 'AM',
      sessionType: 'squash',
      subtype: 'training',
      title: 'Squash técnico',
      objective: 'Construir largo y control con ejecución limpia.',
      durationMin: 60,
      rpe: 6,
      squashDetails: {
        trainingFocus: 'technical',
        sessionKind: 'technical',
        drills: [
          { name: SQUASH_NAMES.TECHNICAL, durationMin: 15 },
          { name: SQUASH_NAMES.CONTROL, durationMin: 15 },
          { name: '100 drops en solitario (50 por lado)', durationMin: 15 },
          { name: 'Volea de control desde media cancha', durationMin: 15 },
        ],
      },
    })
  }

  it('se completa a drill_session sin contarse como reparación', () => {
    const result = repairGeneratedWeek(
      [sessionWithoutMode()],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )

    expect(result.sessions[0]?.squashDetails?.sessionMode).toBe('drill_session')
    expect(result.meta.repairedSessionCount).toBe(0)
    expect(result.meta.warnings.map((warning) => warning.code)).not.toContain('squash_mode_aligned')
  })

  it('un match-play mal declarado sí se cuenta', () => {
    const session = sessionWithoutMode()
    session.squashDetails!.sessionMode = 'practice_match'
    const result = repairGeneratedWeek(
      [session],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )

    expect(result.sessions[0]?.squashDetails?.sessionMode).toBe('drill_session')
    expect(result.meta.warnings.map((warning) => warning.code)).toContain('squash_mode_aligned')
  })
})

describe('contadores observacionales', () => {
  it('cuenta finishers propuestos, preservados y standalone finales sin contar reparaciones', () => {
    const result = repairGeneratedWeek(
      [standaloneSessionFixture('2026-08-03'), finisherSessionFixture('2026-08-05')],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 }),
    )

    expect(result.meta.squashFinisherProposedCount).toBe(1)
    expect(result.meta.squashFinisherPreservedCount).toBe(1)
    expect(result.meta.squashStandaloneMatchCount).toBe(1)
    expect(result.meta.repairedSessionCount).toBe(0)
  })
})

describe('punto fijo', () => {
  it('la segunda ejecución completa es igualdad exacta', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 3 })
    const first = repairGeneratedWeek([
      finisherSessionFixture('2026-08-03'),
      drillSessionFixture('2026-08-05'),
      standaloneSessionFixture('2026-08-07'),
    ], context)
    const second = repairGeneratedWeek(
      first.sessions.map((session) => structuredClone(session)),
      context,
    )

    expect(JSON.stringify(second.sessions)).toBe(JSON.stringify(first.sessions))
    expect(second.meta.repairedSessionCount).toBe(0)
  })
})
