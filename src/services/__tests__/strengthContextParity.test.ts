import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import type { AthleteProfile, ChatContext, CoachSessionProposal, DayLog, PlanWizardConfig, Session, StrengthProfile } from '../../types'
import { buildStrengthSelectionContextForAction } from '../ai/actionPostProcessor'
import { captureFromChatContext } from '../ai/chatSourceCapture'
import { buildWeekCreatorStrengthSelectionContext } from '../weekCreator/WeekCreatorEngine'
import { applyDeclarationValidityToConfig, type WeekCreatorEffectiveConfig } from '../weekCreator/WeekCreatorConfig'
import { buildWeekCreatorHydrationRepairContext } from '../weekCreator/WeekCreatorLocalHydrator'
import { resolveWeekCreatorStrengthSources } from '../weekCreator/weekCreatorExecutionSignals'
import { buildPlanBuilderRecentContext } from '../planBuilder/recentContext'
import { buildPlanBuilderRepairSources } from '../planBuilder/planBuilderSourceCapture'
import { buildPlanBuilderStrengthSelectionContext } from '../planBuilder/repairWeek'
import { buildRepairContextForTest, makePlan } from '../planBuilder/__tests__/helpers/repairTestFixtures'
import { STRENGTH_CONTEXT_ATHLETE_FIELDS } from '../training/strengthAthleteContext'

type Slot = { date: string; timeBlock: 'AM' | 'PM' }

function strength(id: string, date: string, exerciseId: string, athleteId = 'athlete-1'): Session {
  return { id, athleteId, date, weekStartDate: date, timeBlock: 'PM', type: 'strength', status: 'completed', title: id, durationMin: 60, actualRpe: 7, createdAt: 0, updatedAt: 0,
    exercises: [{ id: `${id}-e`, name: exerciseId, sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: exerciseId } }] } as Session
}
function squash(id: string, date: string, athleteId = 'athlete-1'): Session {
  return { id, athleteId, date, weekStartDate: date, timeBlock: 'AM', type: 'squash', status: 'completed', title: id, durationMin: 60, actualRpe: 7, createdAt: 0, updatedAt: 0 } as Session
}
function pick(context: object) {
  return Object.fromEntries(STRENGTH_CONTEXT_ATHLETE_FIELDS.map((key) => [key, (context as Record<string, unknown>)[key]]))
}
function wcConfig(wizard: Partial<PlanWizardConfig>): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'wednesday', 'friday'], sessionsPerWeek: 3, maxSessionsPerWeek: 5, sessionDurationMins: 60, allowDoubleSession: false,
    allowedSports: ['squash', 'strength'], primarySport: 'squash',
    currentFitnessLevel: wizard.currentFitnessLevel ?? 'normal', currentFatigue: wizard.currentFatigue ?? 'normal',
    fromWizard: true, configSource: 'wizard',
  } as WeekCreatorEffectiveConfig
}
const strengthSession = (slot: Slot) => ({ date: slot.date, timeBlock: slot.timeBlock, sessionType: 'strength', title: 'Fuerza', durationMin: 60 }) as CoachSessionProposal

const CASES: Array<{ name: string; now: Date; slot: Slot; wizard: Partial<PlanWizardConfig>; logs: DayLog[]; age: number; strengthProfile: StrengthProfile }> = [
  { name: 'lunes, fresh vigente', now: new Date(2026, 8, 13, 10), slot: { date: '2026-09-14', timeBlock: 'AM' },
    wizard: { currentFatigue: 'fresh', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, logs: [], age: 28, strengthProfile: { squat1RM: 110, deadlift1RM: 140 } },
  { name: 'miércoles, dolor del martes', now: new Date(2026, 8, 16, 10), slot: { date: '2026-09-16', timeBlock: 'PM' },
    wizard: { currentFatigue: 'normal', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, logs: [{ id: 'l1', date: '2026-09-15', painLevel: 7, updatedAt: 0 }], age: 30, strengthProfile: { squat1RM: 110 } },
  { name: 'miércoles, retorno vigente, loaded vencido, experiencia unknown', now: new Date(2026, 8, 16, 10), slot: { date: '2026-09-16', timeBlock: 'AM' },
    wizard: { currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-08T12:00:00.000Z' }, logs: [], age: 41, strengthProfile: {} },
  { name: 'viernes, overloaded vencido', now: new Date(2026, 8, 18, 8), slot: { date: '2026-09-18', timeBlock: 'AM' },
    wizard: { currentFatigue: 'overloaded', currentFitnessLevel: 'fit', updatedAt: '2026-09-04T12:00:00.000Z' }, logs: [{ id: 'l2', date: '2026-09-10', energyLevel: 6, updatedAt: 0 }], age: 33,
    strengthProfile: { squat1RM: 1, deadlift1RM: 1, benchPress1RM: 1, overheadPress1RM: 1 } },
]

describe('I16 · A — chat y Week Creator por su extracción real', () => {
  it.each(CASES)('$name', ({ now, slot, wizard, logs, age, strengthProfile }) => {
    const profile: AthleteProfile = {
      id: 'athlete-1', updatedAt: 0, age, sportContext: { primarySport: 'squash' }, strengthProfile,
      availableEquipment: ['barbell', 'dumbbell'], planWizardConfig: wizard as PlanWizardConfig,
    }
    const chat: ChatContext = {
      recentSessions: [], plannedSessions: [],
      historicalSessions: [strength('a', '2026-09-10', 'goblet_squat'), squash('b', '2026-09-08')],
      weekDayLogs: logs, athleteProfile: profile,
    }
    const nowMs = now.getTime()
    // Fija el instante de la captura del chat; las tres rutas leen esa misma captura.
    captureFromChatContext(chat, nowMs)
    const sources = resolveWeekCreatorStrengthSources(chat, slot.date, nowMs)

    const fromChat = buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], slot)

    const config = applyDeclarationValidityToConfig(wcConfig(wizard), profile, slot.date)
    const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile, strengthSources: sources }
    const fromFinalizer = buildWeekCreatorStrengthSelectionContext(strengthSession(slot), config, safety)

    const hydration = buildWeekCreatorHydrationRepairContext({ context: chat, config, targetWeekStart: '2026-09-14', planningStartDate: slot.date, strengthSources: sources })
    const fromHydration = buildPlanBuilderStrengthSelectionContext(strengthSession(slot), hydration, [])

    expect(pick(fromFinalizer)).toEqual(pick(fromChat))
    expect(pick(fromHydration)).toEqual(pick(fromChat))
  })

  it('miércoles PM incluye RPE real de la mañana en chat, finalizador e hidratador', () => {
    const slot: Slot = { date: '2026-09-16', timeBlock: 'PM' }
    const now = new Date(2026, 8, 16, 15).getTime()
    const wizard = { currentFatigue: 'normal', currentFitnessLevel: 'normal', updatedAt: '2026-09-15T12:00:00Z' } as PlanWizardConfig
    const profile: AthleteProfile = { id: 'athlete-1', updatedAt: 0, planWizardConfig: wizard }
    const morning = { ...squash('morning', slot.date), actualRpe: 10 }
    const prior = ['2026-09-14', '2026-09-15'].map((date, i) => ({ ...squash(`prior-${i}`, date), actualRpe: 9 }))
    const chat: ChatContext = { recentSessions: [], historicalSessions: [...prior, morning], plannedSessions: [], athleteProfile: profile }
    captureFromChatContext(chat, now)
    const sources = resolveWeekCreatorStrengthSources(chat, slot.date, now)
    const config = applyDeclarationValidityToConfig(wcConfig(wizard), profile, slot.date)
    const fromChat = buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], slot)
    const fromFinalizer = buildWeekCreatorStrengthSelectionContext(strengthSession(slot), config, { constraints: [], userMessageConstraints: [], userMessage: '', profile, strengthSources: sources })
    const repair = buildWeekCreatorHydrationRepairContext({ context: chat, config, targetWeekStart: '2026-09-14', planningStartDate: slot.date, strengthSources: sources })
    const fromHydration = buildPlanBuilderStrengthSelectionContext(strengthSession(slot), repair, [])
    expect(fromChat.fatigueLevel).toBe(6) // tres RPE altos: hold; AM sólo ve dos muestras
    expect(pick(fromFinalizer)).toEqual(pick(fromChat))
    expect(pick(fromHydration)).toEqual(pick(fromChat))
    // La directiva semanal AM no se usa como sustituto de las señales PM.
    expect(sources.executionSignals.rpeSampleCount).toBe(2)
    expect(sources.loadDecision.verdict).toBe('no_signal')
  })

  it('los casos cubren lo que prometen', () => {
    // Guard del propio test: si alguien vuelve a los casos favorables, falla acá.
    const profileOf = (i: number): AthleteProfile => ({ id: 'athlete-1', updatedAt: 0, age: CASES[i].age, strengthProfile: CASES[i].strengthProfile, planWizardConfig: CASES[i].wizard as PlanWizardConfig })
    const contextOf = (i: number) => {
      const context: ChatContext = { recentSessions: [], plannedSessions: [], historicalSessions: [], weekDayLogs: CASES[i].logs, athleteProfile: profileOf(i) }
      captureFromChatContext(context, CASES[i].now.getTime())
      return buildStrengthSelectionContextForAction(context, 60, 'fuerza', [], CASES[i].slot)
    }
    expect(contextOf(1).fatigueLevel).toBe(8)                                   // mitad de semana con dolor
    expect(contextOf(2)).toMatchObject({ returningFromBreak: true, experienceLevel: 'unknown', fatigueLevel: 4 })
    expect(contextOf(3).fatigueLevel).toBe(4)                                   // declaración vencida
  })
})

describe('I16 · B/C — Plan Builder desde Dexie', () => {
  beforeEach(async () => { await db.sessions.clear(); await db.dayLogs.clear(); await db.weekSummaries.clear() })

  async function planBuilderScenario(options: { asOfDate: string; now: Date; slot: Slot; previousWeekPain?: number; extraLogs?: DayLog[] }) {
    const wizardPatch = { currentFatigue: 'loaded' as const, currentFitnessLevel: 'returning' as const, updatedAt: '2026-09-10T12:00:00.000Z' }
    const basePlan = makePlan({ startDate: '2026-09-07' })
    const plan = { ...basePlan, wizardConfig: { ...basePlan.wizardConfig, ...wizardPatch } }
    const profile: AthleteProfile = { id: 'athlete-1', updatedAt: 0, age: 41, sportContext: { primarySport: 'squash' }, strengthProfile: {}, planWizardConfig: plan.wizardConfig }
    await db.sessions.bulkAdd([strength('st', '2026-09-08', 'goblet_squat'), squash('sq', '2026-09-09')])
    await db.dayLogs.bulkAdd([{ id: 'pain-prev', athleteId: 'athlete-1', date: '2026-09-10', painLevel: options.previousWeekPain ?? 7, updatedAt: 0 } as DayLog, ...(options.extraLogs ?? [])])

    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: options.asOfDate, now: options.now.getTime() })
    const repairBase = buildRepairContextForTest({ weekStartDate: '2026-09-14' })
    const repairContext = {
      ...repairBase, plan, profile, wizardConfig: plan.wizardConfig,
      week: { ...repairBase.week, planId: plan.id, weekIndex: 1, weekStartDate: '2026-09-14' },
      ...buildPlanBuilderRepairSources(plan, profile, recentContext),
    }
    const fromPlanBuilder = buildPlanBuilderStrengthSelectionContext(strengthSession(options.slot), repairContext, [])

    const chat: ChatContext = { recentSessions: [], plannedSessions: [], historicalSessions: await db.sessions.toArray(), weekDayLogs: await db.dayLogs.toArray(), athleteProfile: profile }
    captureFromChatContext(chat, options.now.getTime())
    const fromChat = buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], options.slot)
    return { fromPlanBuilder, fromChat }
  }

  it('B: con el mismo ancla (lunes), el Plan Builder coincide con el chat', async () => {
    const { fromPlanBuilder, fromChat } = await planBuilderScenario({ asOfDate: '2026-09-14', now: new Date(2026, 8, 14, 10), slot: { date: '2026-09-14', timeBlock: 'AM' } })
    expect(pick(fromPlanBuilder)).toEqual(pick(fromChat))
    expect(fromPlanBuilder).toMatchObject({ fatigueLevel: 8, returningFromBreak: true, experienceLevel: 'unknown', requireExtraRecovery: true })
  })

  it('C: un dolor de la semana en curso lo ve el chat y no el Plan Builder (I8, por diseño)', async () => {
    const { fromPlanBuilder, fromChat } = await planBuilderScenario({
      asOfDate: '2026-09-16', now: new Date(2026, 8, 16, 10), slot: { date: '2026-09-16', timeBlock: 'PM' },
      previousWeekPain: 2,
      extraLogs: [{ id: 'pain-now', athleteId: 'athlete-1', date: '2026-09-15', painLevel: 9, updatedAt: 0 } as DayLog],
    })
    expect(fromChat.fatigueLevel).toBe(8)          // ve el dolor 9 del martes en curso
    expect(fromPlanBuilder.fatigueLevel).toBe(6)   // I8: sólo la semana vivida (dolor 2) → loaded vigente
  })
})
