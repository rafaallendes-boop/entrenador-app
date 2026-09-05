import { describe, expect, it } from 'vitest'

import { repairGeneratedWeek } from '../repairWeek'
import { reviewPlanQuality } from '../qualityReview'
import {
  buildRepairContextForTest as makeRepairContext,
  makeProposal,
  makePlan,
  makeWeek,
  makeSession,
} from './helpers/repairTestFixtures'

/**
 * Tarea 2 (2026-09-02-plan-builder-precision): dos sesiones DURAS de deportes
 * DISTINTOS el mismo día son un error de programación real, aunque no
 * colisionen en `date|timeBlock` (por ejemplo AM+PM). El paso 5b de
 * `repairGeneratedWeek` las separa moviendo la de menor prioridad a otro día
 * entrenable; si no hay día libre, conserva ambas y avisa en vez de perderlas.
 *
 * Todos los escenarios usan `allowDoubleSession: true` a propósito: con
 * `false`, `enforceDoubleSessionDayConstraints` (paso 4b, anterior a 5b) ya
 * expulsa o mueve cualquier segunda sesión del mismo día antes de que nuestra
 * regla pueda observar el conflicto — el caso que 5b existe para resolver sólo
 * sobrevive hasta 5b cuando el día admite más de una sesión.
 */
describe('separación de sesiones duras cruzadas el mismo día', () => {
  it('mueve una de dos duras de deportes distintos que caen el mismo día', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      allowDoubleSession: true,
      complementarySports: ['running', 'strength'],
      sessionsPerWeek: 3,
      phase: 'build',
      weekStartDate: '2026-09-07',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', rpe: 8, title: 'Series' }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8, title: 'Partidos' }),
      makeProposal({ date: '2026-09-09', timeBlock: 'AM', sessionType: 'strength', rpe: 6, title: 'Fuerza' }),
    ]

    const result = repairGeneratedWeek(raw, context)
    const hardDates = result.sessions
      .filter((session) => (session.rpe ?? 6) >= 8)
      .map((session) => session.date)

    expect(new Set(hardDates).size).toBe(hardDates.length)
    expect(result.sessions).toHaveLength(3)
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport')).toBe(true)
  })

  it('busca otro día cuando el hueco más cercano ya tiene una dura cruzada', () => {
    const context = makeRepairContext({ trainingDays: ['monday', 'tuesday', 'wednesday'],
      allowDoubleSession: true, sessionsPerWeek: 3, complementarySports: ['running'],
      phase: 'build', weekStartDate: '2026-09-07' })
    const result = repairGeneratedWeek([
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'squash', rpe: 8 }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'running', rpe: 8 }),
      makeProposal({ date: '2026-09-08', timeBlock: 'AM', sessionType: 'squash', rpe: 8 }),
    ], context)
    expect(result.meta.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'same_day_hard_cross_sport', sessionDate: '2026-09-09' }),
    ]))
  })

  it('no toca dos duras del MISMO deporte el mismo día', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      allowDoubleSession: true,
      doubleSessionDays: ['monday'],
      sessionsPerWeek: 2,
      phase: 'build',
      weekStartDate: '2026-09-07',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'squash', rpe: 8 }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    const dates = result.sessions.map((s) => s.date)
    expect(dates).toEqual(['2026-09-07', '2026-09-07'])
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport')).toBe(false)
  })

  /**
   * Candado de la invariante de la que depende `ordered.slice(1)`: el paso 4
   * resuelve colisiones `date|timeBlock` ANTES de 5b, así que un día no puede
   * llegar a 5b con más de dos sesiones. Con exactamente dos y `sports.size
   * >= 2`, son necesariamente de deportes distintos y mover todas menos la
   * primera mueve exactamente una — la del otro deporte.
   *
   * Si alguien relaja el paso 4 y permite tres sesiones en un día, este test
   * cae y hay que hacer el filtro de 5b explícito por deporte.
   */
  it('nunca llega a 5b un día con dos duras del mismo deporte más una de otro', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      allowDoubleSession: true,
      doubleSessionDays: ['monday'],
      complementarySports: ['running'],
      sessionsPerWeek: 3,
      phase: 'build',
      weekStartDate: '2026-09-07',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'squash', rpe: 8, title: 'Squash A' }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8, title: 'Squash B' }),
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', rpe: 8, title: 'Series' }),
    ]

    const result = repairGeneratedWeek(raw, context)
    const perDate = new Map<string, number>()
    for (const session of result.sessions) {
      perDate.set(session.date, (perDate.get(session.date) ?? 0) + 1)
    }
    expect(Math.max(...perDate.values())).toBeLessThanOrEqual(2)

    // Y en concreto: las dos de squash siguen juntas; sólo se movió la ajena.
    const squashDates = result.sessions
      .filter((session) => session.sessionType === 'squash')
      .map((session) => session.date)
    expect(new Set(squashDates)).toEqual(new Set(['2026-09-07']))
  })

  it('no toca duras cruzadas que ya están en días distintos', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      complementarySports: ['running'],
      sessionsPerWeek: 2,
      phase: 'build',
      weekStartDate: '2026-09-07',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
      makeProposal({ date: '2026-09-09', sessionType: 'squash', rpe: 8 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    expect(result.sessions.map((s) => s.date).sort()).toEqual(['2026-09-07', '2026-09-09'])
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport')).toBe(false)
  })

  it('conserva la sesión cuando no hay día libre, sin perderla', () => {
    const context = makeRepairContext({
      trainingDays: ['monday'],
      allowDoubleSession: true,
      complementarySports: ['running'],
      sessionsPerWeek: 2,
      phase: 'build',
      weekStartDate: '2026-09-07',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', rpe: 8 }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    expect(result.sessions).toHaveLength(2)
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport_unresolved')).toBe(true)
  })

  it('mover una sesión de fuerza no rompe la asignación del allocator', () => {
    // Deporte primario = running (no squash) y fase = base: evita que
    // `ensurePrimarySportDominance`/`ensurePrimarySportMinimum` (pasos 12/13,
    // exclusivos de build/peak y del deporte principal) reconviertan la sesión
    // de fuerza en una sesión más del deporte primario antes de que el test
    // pueda observar su contenido. Ninguna de esas dos reglas es lo que este
    // test verifica: lo que verifica es que el allocator de fuerza (paso 6+)
    // ancla correctamente su asignación a la fecha YA movida por el paso 5b.
    const context = makeRepairContext({
      primarySport: 'running',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      allowDoubleSession: true,
      complementarySports: ['strength'],
      sessionsPerWeek: 2,
      phase: 'base',
      weekStartDate: '2026-09-07',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', rpe: 8, durationMin: 60 }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'strength', rpe: 8, durationMin: 60 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    const strength = result.sessions.find((s) => s.sessionType === 'strength')

    expect(strength?.date).not.toBe('2026-09-07')
    // La sesión movida conserva contenido real: si el allocator hubiera perdido
    // su anclaje, el finalizador la dejaría sin ejercicios.
    expect((strength?.exercises ?? []).length).toBeGreaterThan(0)
  })
})

/**
 * Tarea 3 (2026-09-02-plan-builder-precision): red de seguridad de calidad
 * para el caso que el paso 5b de `repairGeneratedWeek` (arriba) no llegó a
 * resolver. Opera sobre `TrainingPlanWeek.sessions` ya persistidas, no sobre
 * propuestas crudas del repair. Es `severity: 'warning'` a propósito: el
 * repair ya corrige el caso de forma determinista, y cuando no puede —una
 * semana sin día libre— bloquear la aceptación dejaría inservible un plan ya
 * pagado sin ninguna acción disponible en producción. Mismo criterio que
 * `hard_primary_matches_below_target`.
 */
describe('gate de calidad: duras cruzadas el mismo día', () => {
  it('avisa sin bloquear cuando running RPE 8 y squash RPE 8 caen el mismo día', () => {
    const plan = makePlan({ primarySport: 'squash', complementarySports: ['running'] })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
        makeSession({ date: '2026-09-07', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    const found = review.issues.find((i) => i.code === 'quality.load.same_day_hard_cross_sport')

    expect(found).toBeDefined()
    expect(found?.severity).toBe('warning')
    // Lo que importa de verdad: `commitPlan` rechaza con `criticalIssueCount > 0`.
    expect(review.criticalIssueCount).toBe(0)
  })

  it('no marca nada cuando las mismas sesiones están en días distintos', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
        makeSession({ date: '2026-09-09', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    expect(review.issues.some((i) => i.code === 'quality.load.same_day_hard_cross_sport')).toBe(false)
  })

  it('no marca dos duras del mismo deporte el mismo día', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'squash', rpe: 8 }),
        makeSession({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    expect(review.issues.some((i) => i.code === 'quality.load.same_day_hard_cross_sport')).toBe(false)
  })

  it('conserva el warning existente de días consecutivos', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', sessionType: 'squash', rpe: 8 }),
        makeSession({ date: '2026-09-08', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    const clustered = review.issues.find((i) => i.code === 'quality.load.hard_days_clustered')
    expect(clustered?.severity).toBe('warning')
  })
})
