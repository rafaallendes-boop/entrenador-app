import { describe, expect, it } from 'vitest'

import { getExecutedSessions, getExecutedSessionsThrough } from '../executedSessions'
import { finalizeSessionDose } from '../sessionDoseFinalizer'
import { planSquashWeek } from '../squashWeekPlanner'
import { resolveSquashAvailability, sanitizeSquashTrainingContext } from '../../../types/squashTrainingContext'
import type { AthleteProfile, CoachSessionProposal, Session } from '../../../types'

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
