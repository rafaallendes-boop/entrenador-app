import { describe, expect, it } from 'vitest'

import { getExecutedSessions, getExecutedSessionsThrough } from '../executedSessions'
import { finalizeSessionDose } from '../sessionDoseFinalizer'
import { planSquashWeek } from '../squashWeekPlanner'
import { resolveSquashAvailability, sanitizeSquashTrainingContext } from '../../../types/squashTrainingContext'
import { selectSquashDrills } from '../drillSelector'
import { findSquashDrillByName, resolveSquashDrillKind } from '../drillLibrary'
import { finalizeCoachActionDose } from '../coachActionDose'
import { sumTimedBlocks } from '../sessionTimeBudget'
import type { AthleteProfile, CoachAction, CoachSessionProposal, Session } from '../../../types'

/**
 * Regresiones del code review del 2026-09-08. Cada caso falla contra el código
 * anterior al arreglo correspondiente.
 */

describe('disponibilidad de squash: la sesión no borra la del plan', () => {
  const profile = { planWizardConfig: { partnerAvailability: 'solo' } } as unknown as AthleteProfile

  it('sanitize sigue emitiendo la clave con valor undefined', () => {
    const sanitized = sanitizeSquashTrainingContext({ availability: { court: false } })
    expect('partnerAvailability' in sanitized.availability!).toBe(true)
    expect(sanitized.availability!.partnerAvailability).toBeUndefined()
  })

  it('el resolver conserva el `solo` del plan cuando la sesión no lo declara', () => {
    const sanitized = sanitizeSquashTrainingContext({ availability: { court: false } })
    expect(resolveSquashAvailability(sanitized.availability, 'solo').partnerAvailability).toBe('solo')
    // Y la sesión sí puede sobreescribirlo cuando lo declara.
    expect(resolveSquashAvailability({ partnerAvailability: 'partner' }, 'solo').partnerAvailability).toBe('partner')
  })

  it('la dosis rechaza un drill con compañero aunque la sesión declare sólo la cancha', () => {
    const session: CoachSessionProposal = {
      date: '2026-09-08', timeBlock: 'AM', sessionType: 'squash', title: 'Técnico', durationMin: 60,
      squashDetails: {
        trainingFocus: 'technical', sessionKind: 'technical', sessionMode: 'drill_session',
        drills: [{ name: 'Tiros paralelos profundos', durationMin: 60 }],
        availability: sanitizeSquashTrainingContext({ availability: { court: true } }).availability,
      },
    } as unknown as CoachSessionProposal

    const result = finalizeSessionDose(session, profile)
    expect(result.ok).toBe(false)
  })
})

describe('historial ejecutado', () => {
  const rows = [
    { status: 'completed', date: '2026-09-08', timeBlock: 'AM' },
    { status: 'completed', date: '2026-09-07', timeBlock: 'AM' },
    { status: 'planned', date: '2026-09-08', timeBlock: 'PM' },
  ] as Array<Pick<Session, 'status' | 'date' | 'timeBlock'>>

  it('el corte exclusivo deja fuera lo completado hoy (llamadores prospectivos)', () => {
    expect(getExecutedSessions(rows, '2026-09-08').map(s => s.date)).toEqual(['2026-09-07'])
  })

  it('el corte inclusivo cuenta lo completado hoy (lecturas de historial)', () => {
    expect(getExecutedSessionsThrough(rows, '2026-09-08').map(s => s.date)).toEqual(['2026-09-08', '2026-09-07'])
  })
})

describe('planSquashWeek: la fatiga degrada un slot, no la semana', () => {
  it('conserva trabajo técnico con fatiga declarada overloaded', () => {
    const plan = planSquashWeek({
      sessionSlots: 4, phase: 'base', fatigueLevel: 9, recentKinds: [],
      goal: 'mejorar squash',
    } as unknown as Parameters<typeof planSquashWeek>[0])

    expect(plan.slots).toHaveLength(4)
    expect(plan.slots.some(slot => slot.kind === 'technical')).toBe(true)
  })

  it('sin compañero no queda ningún match, aunque el patrón traiga varios', () => {
    const plan = planSquashWeek({
      sessionSlots: 4, phase: 'peak', fatigueLevel: 3, recentKinds: [],
      partnerAvailability: 'solo', goal: 'competir',
    } as unknown as Parameters<typeof planSquashWeek>[0])

    expect(plan.slots.some(slot => slot.kind === 'match')).toBe(false)
  })
})

describe('drillSelector: tope de exposición y ensanche del fallback', () => {
  const base = {
    fatigueLevel: 4, goal: 'mejorar squash', recentDrills: [], competitionSoon: false,
    referenceDate: '2026-06-10',
  } as const

  function playedMatch(date: string): Session {
    return {
      id: `m-${date}`, date, timeBlock: 'AM', type: 'squash', status: 'completed',
      subtype: 'match', title: 'Partido', durationMin: 60, createdAt: 1, updatedAt: 1,
      squashDetails: { trainingFocus: 'tactical', sessionKind: 'match', sessionMode: 'practice_match',
        drills: [{ name: 'Partido de práctica', durationMin: 60 }] },
    } as unknown as Session
  }

  it('dos partidos recientes vetan los drills de partido, también en el pool tolerante', () => {
    const historicalSessions = [playedMatch('2026-06-08'), playedMatch('2026-06-09')]
    for (const phase of ['base', 'build', 'peak', 'taper'] as const) {
      const result = selectSquashDrills({ ...base, phase, historicalSessions, partnerAvailability: 'partner' })
      const kinds = result.drills.map(d => resolveSquashDrillKind(findSquashDrillByName(d.name)!))
      expect(kinds).not.toContain('match')
    }
  })

  /**
   * Guard, no reproducción de una falla viva.
   *
   * El arreglo corrige un pool de fallback que había quedado idéntico al
   * principal, así que la rama `selected.length < 3` no ensanchaba nada. Con el
   * catálogo actual esa rama **no es alcanzable**: un barrido de 192 contextos
   * (4 fases × 4 fatigas × 3 modalidades × 4 disponibilidades) no produce
   * ninguna selección de menos de 3 drills, ni antes ni después del arreglo.
   * Era un bug latente. Esto fija el resultado observable para que un recorte
   * futuro del catálogo lo haga fallar acá y no en producción.
   */
  it('ningún contexto hostil devuelve una sesión de 1-2 drills', () => {
    for (const phase of ['base', 'build', 'peak', 'taper'] as const)
    for (const fatigueLevel of [3, 6, 8, 9]) {
      const result = selectSquashDrills({ ...base, phase, fatigueLevel, partnerAvailability: 'solo',
        availability: { partnerAvailability: 'solo', court: false, equipment: [] } })
      expect(result.drills.length).toBeGreaterThanOrEqual(3)
      // La disponibilidad sigue siendo dura: nada que exija compañero.
      for (const drill of result.drills) {
        expect(findSquashDrillByName(drill.name)!.executionMode).toBe('solo')
      }
    }
  })
})

describe('create_week: un rechazo de dosis descarta la semana completa', () => {
  it('no entrega una semana parcial y avisa', () => {
    const sessions = [
      { date: '2026-06-01', timeBlock: 'AM' as const, sessionType: 'running' as const,
        runningType: 'z2' as const, title: 'Running imposible', durationMin: 8 },
      { date: '2026-06-03', timeBlock: 'AM' as const, sessionType: 'running' as const,
        runningType: 'z2' as const, title: 'Running normal', durationMin: 40 },
    ]
    const result = finalizeCoachActionDose(
      { type: 'create_week', reason: 'semana', sessions } as unknown as CoachAction,
      { recentSessions: [] } as never,
      [],
    )
    // Contrato actual, congelado a propósito: es todo o nada. Si algún día se
    // degrada por sesión, este test es el que hay que cambiar conscientemente.
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBeTruthy()
  })

  it('acepta la semana cuando todas las sesiones dosifican', () => {
    const result = finalizeCoachActionDose(
      { type: 'create_week', reason: 'semana', sessions: [
        { date: '2026-06-01', timeBlock: 'AM', sessionType: 'running', runningType: 'z2', title: 'Running', durationMin: 40 },
      ] } as unknown as CoachAction,
      { recentSessions: [] } as never,
      [],
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      const [session] = result.action.sessions!
      expect(sumTimedBlocks(session.intervalStructure!.blocks)).toBe(session.durationMin * 60)
    }
  })
})
