import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { buildPlanBuilderRecentContext } from '../recentContext'
import { executionSignalsFromLivedWeeks } from '../recentContextRender'
import { buildPlanBuilderRepairSources, resolvePlanBuilderExecutionSignals } from '../planBuilderSourceCapture'
import { makePlan } from './helpers/repairTestFixtures'

async function seedWeek(athleteId: string, weekStart: string) {
  await db.sessions.bulkAdd([
    { id: `sq-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart, timeBlock: 'AM', type: 'squash', status: 'completed', actualRpe: 8, durationMin: 60, title: 'sq', createdAt: 0, updatedAt: 0 },
    { id: `st-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart, timeBlock: 'PM', type: 'strength', status: 'completed', durationMin: 60, title: 'st', createdAt: 0, updatedAt: 0,
      exercises: [{ id: 'e', name: 'goblet_squat', sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: 'goblet_squat' } }] },
    { id: `miss-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart, timeBlock: 'PM', type: 'squash', status: 'skipped', durationMin: 60, title: 'miss', createdAt: 0, updatedAt: 0 },
  ] as never)
  await db.dayLogs.bulkAdd([
    { id: `d1-${weekStart}`, athleteId, date: weekStart, energyLevel: 4, painLevel: 3, sleepHours: 6, rpeActual: 9, updatedAt: 0 },
    { id: `d2-${weekStart}`, athleteId, date: weekStart.replace(/\d\d$/, (d) => String(Number(d) + 1).padStart(2, '0')), energyLevel: 3, prefillSource: { energyLevel: 'whoop' }, updatedAt: 0 },
  ] as never)
}

describe('Plan Builder — fuentes B2/B3', () => {
  beforeEach(async () => {
    await db.sessions.clear(); await db.dayLogs.clear(); await db.weekSummaries.clear()
  })

  it('las señales nuevas son idénticas a la ruta agregada legacy (I8)', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedWeek(plan.athleteId, '2026-09-07')
    await seedWeek(plan.athleteId, '2026-09-14')
    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })
    expect(recentContext.signalRows?.weekStartDate).toBe('2026-09-14')

    const sources = buildPlanBuilderRepairSources(plan, { id: plan.athleteId, updatedAt: 0 }, recentContext)
    expect(sources.executionSignals).toEqual(executionSignalsFromLivedWeeks(recentContext))
    expect(resolvePlanBuilderExecutionSignals(recentContext, sources.sourceCapture!)).toEqual(sources.executionSignals)
  })

  it('un payload sin filas crudas usa la ruta legacy', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedWeek(plan.athleteId, '2026-09-07')
    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
    const legacyPayload = { ...recentContext, signalRows: undefined }
    const sources = buildPlanBuilderRepairSources(plan, { id: plan.athleteId, updatedAt: 0 }, legacyPayload)
    expect(sources.executionSignals).toEqual(executionSignalsFromLivedWeeks(legacyPayload))
  })

  it('la captura trae la fuerza ejecutada previa al plan, aunque executedSessions sea sólo squash/running', async () => {
    const plan = makePlan({ startDate: '2026-09-21' })
    await seedWeek(plan.athleteId, '2026-09-14')
    const recentContext = await buildPlanBuilderRecentContext(plan)
    expect(recentContext.executedStrengthSessions?.map((s) => s.id)).toEqual(['st-2026-09-14'])
    const sources = buildPlanBuilderRepairSources(plan, { id: plan.athleteId, updatedAt: 0 }, recentContext)
    expect(sources.sourceCapture?.sessions.some((s) => s.id === 'st-2026-09-14')).toBe(true)
    expect(sources.executionSignals).toBeUndefined()
  })
})
