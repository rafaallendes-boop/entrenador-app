import { describe, expect, it } from 'vitest'
import type { ChatContext, CoachSessionProposal, Session } from '../../../types'
import { repairGeneratedWeek } from '../../planBuilder/repairWeek'
import { buildWeekCreatorHydrationRepairContext } from '../../weekCreator/WeekCreatorLocalHydrator'
import type { WeekCreatorEffectiveConfig } from '../../weekCreator/WeekCreatorConfig'
import { sessionToTemplatePayload, templateToDraft } from '../../athlete/sessionTemplateSerializer'
import { hydrateSquashSession } from '../squashSessionHydrator'

const TARGET_WEEK = '2026-07-20'

const context: ChatContext = {
  recentSessions: [],
  athleteProfile: { id: 'athlete-1', updatedAt: 0, sportContext: { primarySport: 'squash' } },
}

const config: WeekCreatorEffectiveConfig = {
  trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  doubleSessionDays: [], sessionsPerWeek: 2, maxSessionsPerWeek: 5, sessionDurationMins: 15,
  allowDoubleSession: false, allowedSports: ['squash'], primarySport: 'squash',
  currentFitnessLevel: 'fit', currentFatigue: 'normal', fromWizard: true, configSource: 'wizard',
}

function technicalWithShadows(): CoachSessionProposal {
  const hydrated = hydrateSquashSession({
    kind: 'technical', durationMin: 15, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
    competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either',
  })
  return {
    date: TARGET_WEEK, timeBlock: 'AM', sessionType: 'squash', title: 'Squash técnico', durationMin: 15,
    objective: 'Técnica', squashKind: 'technical', subtype: hydrated.subtype, squashDetails: hydrated.details,
  }
}

describe('A2 — el bloque principal sobrevive al recorrido', () => {
  it('sigue presente después de repairGeneratedWeek', () => {
    const repairContext = buildWeekCreatorHydrationRepairContext({ context, config, targetWeekStart: TARGET_WEEK })
    const result = repairGeneratedWeek([technicalWithShadows()], repairContext)
    expect(result.failure).toBeUndefined()
    const squash = result.sessions.find(session => session.sessionType === 'squash')
    expect(squash?.squashDetails?.blocks?.some(block => block.kind === 'technical')).toBe(true)
  })

  it('sigue presente después de serializar a plantilla y volver a borrador', () => {
    const proposal = technicalWithShadows()
    const session: Session = {
      id: 's-1', date: proposal.date, weekStartDate: TARGET_WEEK, timeBlock: 'AM', type: 'squash',
      status: 'planned', source: 'coach', title: proposal.title, durationMin: 15,
      subtype: proposal.subtype, squashDetails: proposal.squashDetails, createdAt: 0, updatedAt: 0,
    }
    const payload = sessionToTemplatePayload(session)
    expect(payload.squashDetails?.blocks?.map(block => block.kind)).toContain('technical')
    const { draft } = templateToDraft(payload, TARGET_WEEK)
    expect(draft.squashKind).toBe('technical')
  })
})
