import { describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { isDeclaredSquashMatchSession } from '../../planBuilder/eventWindowRules'
import { repairGeneratedWeek } from '../../planBuilder/repairWeek'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'
import {
  applyWeekCreatorEventContextToConfig,
  resolveWeekCreatorEventContext,
} from '../WeekCreatorEventContext'
import { buildWeekCreatorHydrationRepairContext } from '../WeekCreatorLocalHydrator'
import { buildWeekCreatorPrompt } from '../WeekCreatorPromptBuilder'
import { validateWeekCreatorResponse } from '../validateWeekCreatorResponse'

function profile(): AthleteProfile {
  return {
    id: 'athlete-event-window',
    updatedAt: 0,
    primarySport: 'squash',
    sportContext: {
      primarySport: 'squash',
      enabledSports: ['squash', 'mobility'],
      trainingPriority: 'performance',
    },
    goalEvents: [{
      id: 'event-window',
      title: 'Campeonato multijornada',
      date: '2026-09-05',
      endDate: '2026-09-11',
      keyDate: '2026-09-09',
      sport: 'squash',
      priority: 'primary',
    }],
    planWizardConfig: {
      goalEventId: 'event-window',
      trainingDays: ['monday', 'tuesday', 'thursday', 'friday'],
      sessionsPerWeek: 5,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['mobility'],
      currentFitnessLevel: 'fit',
      currentFatigue: 'normal',
      createdAt: '',
      updatedAt: '',
    },
    // Simula un snapshot calculado para otra fecha: Week Creator debe resolver
    // la fase de la semana objetivo, no copiar ésta.
    macroPlan: {
      goalEventId: 'event-window',
      goalEventDate: '2026-09-05',
      goalEventEndDate: '2026-09-11',
      goalEventKeyDate: '2026-09-09',
      currentPhase: 'transition',
      weeksRemaining: -1,
      blockFocus: 'Snapshot fuera de fecha',
      headline: '',
      timeline: [],
      sportDetails: [],
      secondaryEvents: [],
      computedAt: 0,
    },
  }
}

function config(): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'tuesday', 'thursday', 'friday'],
    doubleSessionDays: [],
    sessionsPerWeek: 5,
    maxSessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    allowedSports: ['squash', 'mobility'],
    primarySport: 'squash',
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    fromWizard: true,
    configSource: 'wizard',
  }
}

function context(): ChatContext {
  return {
    athleteProfile: profile(),
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    weekDayLogs: [],
  }
}

describe('B5 — Week Creator consume la ventana completa', () => {
  it('resuelve race en las dos semanas que intersectan y transition sólo después del término', () => {
    const first = resolveWeekCreatorEventContext({
      profile: profile(),
      targetWeekStart: '2026-08-31',
      weekEndDate: '2026-09-06',
      primarySport: 'squash',
    })
    const second = resolveWeekCreatorEventContext({
      profile: profile(),
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      primarySport: 'squash',
    })
    const after = resolveWeekCreatorEventContext({
      profile: profile(),
      targetWeekStart: '2026-09-14',
      weekEndDate: '2026-09-20',
      primarySport: 'squash',
    })

    expect(first).toMatchObject({ phase: 'race', timing: 'active', anchorInsideTargetWeek: false })
    expect(second).toMatchObject({ phase: 'race', timing: 'active', anchorInsideTargetWeek: true })
    expect(after).toMatchObject({ phase: 'transition', timing: 'past' })
  })

  it('ajusta la cantidad race antes del prompt y admite el día clave fuera del horario habitual', () => {
    const eventContext = resolveWeekCreatorEventContext({
      profile: profile(),
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      primarySport: 'squash',
    })
    const effective = applyWeekCreatorEventContextToConfig(config(), eventContext)

    expect(effective.sessionsPerWeek).toBe(2)
    expect(effective.maxSessionsPerWeek).toBe(2)
    expect(effective.trainingDays).toContain('wednesday')
  })

  it('prompt muestra rango, timing activo y decide si corresponde insertar el ancla', () => {
    const firstPrompt = buildWeekCreatorPrompt(context(), {
      userMessage: 'Créame la semana',
      targetWeekStart: '2026-08-31',
      weekEndDate: '2026-09-06',
      config: config(),
      structuredOutput: true,
    }).userPrompt
    const anchorPrompt = buildWeekCreatorPrompt(context(), {
      userMessage: 'Créame la semana',
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      config: config(),
      structuredOutput: true,
      skeletonOutput: true,
    }).userPrompt

    for (const prompt of [firstPrompt, anchorPrompt]) {
      expect(prompt).toContain('2026-09-05 a 2026-09-11')
      expect(prompt).toContain('Día clave/ancla: 2026-09-09')
      expect(prompt).toContain('Timing para esta semana: active')
      expect(prompt).toContain('NO describas esta semana como post-evento')
    }
    expect(firstPrompt).toContain('cae en otra semana')
    expect(firstPrompt).toContain('NO inventes una competencia')
    expect(anchorPrompt).toContain('Inserta UNA sola ancla')
    expect(anchorPrompt).toContain('Como máximo 2 apoyos')
  })

  it('hydrator propaga la ventana real y repair crea una sola ancla', () => {
    const eventContext = resolveWeekCreatorEventContext({
      profile: profile(),
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      primarySport: 'squash',
    })
    const effective = applyWeekCreatorEventContextToConfig(config(), eventContext)
    const repairContext = buildWeekCreatorHydrationRepairContext({
      context: context(),
      config: effective,
      targetWeekStart: '2026-09-07',
    })

    expect(repairContext.week.phase).toBe('race')
    expect(repairContext.plan.macroSnapshot).toMatchObject({
      goalEventDate: '2026-09-05',
      goalEventEndDate: '2026-09-11',
      goalEventKeyDate: '2026-09-09',
    })

    const repaired = repairGeneratedWeek([], repairContext)
    expect(repaired.sessions).toHaveLength(2)
    expect(repaired.sessions.filter(isDeclaredSquashMatchSession)).toHaveLength(1)
    expect(repaired.sessions.find(isDeclaredSquashMatchSession)?.date).toBe('2026-09-09')

    const validation = validateWeekCreatorResponse({
      response: {
        message: 'Semana race local',
        actions: [{
          type: 'create_week',
          reason: 'Campeonato activo',
          targetDate: '2026-09-07',
          sessions: repaired.sessions,
        }],
        provider: 'mock',
        model: 'local',
        timestamp: 0,
        traceId: 'event-window',
        requestClass: 'week_creator',
      },
      context: context(),
      config: effective,
      targetWeekStart: '2026-09-07',
    })
    expect(validation).toMatchObject({ ok: true })
  })

  it('una semana parcial no recrea un ancla que ya pasó', () => {
    const eventContext = resolveWeekCreatorEventContext({
      profile: profile(),
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      planningStartDate: '2026-09-10',
      primarySport: 'squash',
    })

    expect(eventContext).toMatchObject({
      phase: 'race',
      appliesToPrimarySport: true,
      anchorInsideTargetWeek: true,
      anchorInsidePlanningWindow: false,
    })
  })

  it('no aplica reglas de squash a un evento heredado de otro deporte', () => {
    const staleProfile = profile()
    staleProfile.goalEvents![0] = {
      ...staleProfile.goalEvents![0]!,
      sport: 'running',
    }
    staleProfile.macroPlan = {
      ...staleProfile.macroPlan!,
      currentPhase: 'base',
      weeksRemaining: 8,
      blockFocus: 'Desarrollo general',
    }
    const staleContext = { ...context(), athleteProfile: staleProfile }
    const eventContext = resolveWeekCreatorEventContext({
      profile: staleProfile,
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      primarySport: 'squash',
    })
    const effective = applyWeekCreatorEventContextToConfig(config(), eventContext)
    const prompt = buildWeekCreatorPrompt(staleContext, {
      userMessage: 'Créame la semana de squash',
      targetWeekStart: '2026-09-07',
      weekEndDate: '2026-09-13',
      config: effective,
      structuredOutput: true,
      skeletonOutput: true,
    }).userPrompt

    expect(eventContext).toMatchObject({
      phase: 'base',
      appliesToPrimarySport: false,
      anchorInsideTargetWeek: false,
    })
    expect(effective.sessionsPerWeek).toBe(5)
    expect(prompt).toContain('Evento heredado/de plan anterior')
    expect(prompt).toContain('No uses el evento running como restricción dura')
    expect(prompt).not.toContain('Inserta UNA sola ancla')
  })
})
