import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { buildPlanBuilderRecentContext } from '../recentContext'
import { renderPlanBuilderRecentContext } from '../recentContextRender'
import { makePlan } from './helpers/repairTestFixtures'

async function seedLivedWeek(athleteId: string, weekStart: string, rpe: number, energy: number) {
  await db.sessions.add({
    id: `s-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart,
    type: 'squash', status: 'completed', actualRpe: rpe, durationMin: 60,
  } as never)
  await db.dayLogs.add({
    id: `d-${weekStart}`, athleteId, date: weekStart, energyLevel: energy, painLevel: 2,
  } as never)
}

describe('ventana intra-plan del contexto reciente', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.dayLogs.clear()
    await db.weekSummaries.clear()
  })

  it('sin asOfDate conserva el comportamiento actual: sólo historial pre-plan', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 3) // dentro del plan

    const context = await buildPlanBuilderRecentContext(plan)

    expect(context.referenceDate).toBe('2026-09-07')
    expect(context.livedPlanWeeks).toBeUndefined()
    expect(context.weeks.every((w) => w.weekStartDate < '2026-09-07')).toBe(true)
  })

  it('con asOfDate expone las semanas del plan ya vividas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-07', 9, 3)
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 4)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    expect(context.referenceDate).toBe('2026-09-21')
    expect(context.livedPlanWeeks).toBeDefined()
    expect(context.livedPlanWeeks?.map((w) => w.weekStartDate)).toEqual(['2026-09-07', '2026-09-14'])
    expect(context.livedPlanWeeks?.[0].avgActualRpe).toBe(9)
  })

  it('no incluye semanas del plan aún no vividas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-07', 7, 7)
    await seedLivedWeek(plan.athleteId, '2026-09-28', 7, 7) // futura respecto de asOf

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    expect(context.livedPlanWeeks?.map((w) => w.weekStartDate)).toEqual(['2026-09-07'])
  })

  it('un asOfDate anterior al inicio del plan no produce semanas vividas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-01' })
    expect(context.livedPlanWeeks ?? []).toEqual([])
  })

  it('excluye el RPE prellenado por Whoop', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await db.sessions.add({
      id: 's1', athleteId: plan.athleteId, date: '2026-09-07', weekStartDate: '2026-09-07',
      type: 'squash', status: 'completed', durationMin: 60,
    } as never)
    await db.dayLogs.add({
      id: 'd1', athleteId: plan.athleteId, date: '2026-09-07',
      rpeActual: 10, energyLevel: 2, sleepHours: 4,
      prefillSource: { rpeActual: 'whoop', energyLevel: 'whoop', sleepHours: 'whoop' },
    } as never)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
    const week = context.livedPlanWeeks?.[0]

    expect(week?.avgManualActualRpe).toBeUndefined()
    expect(week?.manualRpeSampleCount).toBe(0)
    expect(week?.latestManualEnergyLevel).toBeUndefined()
    expect(week?.avgManualSleepHours).toBeUndefined()
  })

  it('conserva el dolor numérico, que Whoop nunca prellena', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await db.dayLogs.add({
      id: 'd1', athleteId: plan.athleteId, date: '2026-09-08', painLevel: 7,
    } as never)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
    expect(context.livedPlanWeeks?.[0].latestManualPainLevel).toBe(7)
  })

  it('cuenta la muestra de RPE, no las sesiones completadas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    for (const [i, rpe] of [[0, 9], [1, undefined], [2, undefined]] as const) {
      await db.sessions.add({
        id: `s${i}`, athleteId: plan.athleteId, date: '2026-09-07', weekStartDate: '2026-09-07',
        type: 'squash', status: 'completed', durationMin: 60, actualRpe: rpe,
      } as never)
    }

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
    const week = context.livedPlanWeeks?.[0]
    expect(week?.completedSessions).toBe(3)
    expect(week?.manualRpeSampleCount).toBe(1)
  })
})

describe('partición de weeks/livedPlanWeeks y ventana de lookback con asOfDate (ronda de fix 1)', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.dayLogs.clear()
    await db.weekSummaries.clear()
  })

  it('una semana vivida aparece una sola vez en el render de producción (recentContextRender)', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-07', 9, 3)
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 4)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })
    const text = renderPlanBuilderRecentContext(context)

    const occurrences = text.split('Semana 2026-09-07').length - 1
    expect(occurrences).toBe(1)
  })

  it('context.weeks no contiene ninguna semana >= planStart cuando hay asOfDate', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-08-31', 5, 5) // pre-plan
    await seedLivedWeek(plan.athleteId, '2026-09-07', 9, 3)
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 4)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    expect(context.weeks.every((w) => w.weekStartDate < plan.startDate)).toBe(true)
    expect(context.weeks.map((w) => w.weekStartDate)).toEqual(['2026-08-31'])
    expect(context.livedPlanWeeks?.map((w) => w.weekStartDate)).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('summary/recommendation no cambian al agregar semanas vividas, con el mismo historial pre-plan', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-08-31', 6, 6) // único historial pre-plan

    const before = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    await seedLivedWeek(plan.athleteId, '2026-09-07', 9, 3)
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 4)

    const after = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    expect(after.weeks).toEqual(before.weeks)
    expect(after.summary).toEqual(before.summary)
    expect(after.livedPlanWeeks?.length).toBe(2)
  })

  it('una semana vivida anterior a la ventana de 6 semanas sigue apareciendo en livedPlanWeeks', async () => {
    // El plan arranca 10 semanas antes del asOfDate; el lookback por defecto
    // (6 semanas) por sí solo dejaría la primera semana vivida fuera de la
    // consulta a Dexie.
    const plan = makePlan({ startDate: '2026-06-29' })
    await seedLivedWeek(plan.athleteId, plan.startDate, 8, 8)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-07' })

    expect(context.livedPlanWeeks?.map((w) => w.weekStartDate)).toContain(plan.startDate)
  })
})
