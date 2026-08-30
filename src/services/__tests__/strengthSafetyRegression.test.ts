import { describe, expect, it } from 'vitest'
import type { ChatContext, CoachAction } from '../../types'
import type { BodyRegion, StrengthConstraint } from '../../types/strengthSafety'
import type { CoachNormalizedResponse } from '../ai/types'
import { postProcessCoachActions } from '../ai/actionPostProcessor'
import { finalizeStrengthExercisesForRestrictions } from '../training/strengthSafetyFinalizer'
import type { StrengthContext } from '../training/strengthSelector'

function response(actions: CoachAction[]): CoachNormalizedResponse {
  return {
    message: 'Propuesta', actions, provider: 'mock', traceId: 'strength-safety-regression',
    requestClass: 'chat_action', timestamp: 1,
  }
}

const baseContext: ChatContext = {
  recentSessions: [], plannedSessions: [], historicalSessions: [],
  athleteProfile: {
    id: 'strength-safety', updatedAt: 1,
    sportContext: { primarySport: 'strength', trainingPriority: 'return_to_play' },
  },
} as ChatContext

describe('strength safety regressions', () => {
  it('removes a chat action for return_to_play without medical detail', () => {
    const output = postProcessCoachActions(response([{
      type: 'add_session', reason: 'Fuerza', targetDate: '2026-09-07', timeBlock: 'PM',
      sessionType: 'strength', title: 'Fuerza', durationMin: 60,
    }]), baseContext, 'Créame una sesión de fuerza')

    expect(output.actions).toEqual([])
    expect(output.message).toBe('No pude verificar una sesión de fuerza compatible con la restricción registrada.')
    expect(output.meta?.warnings).toContain('chat_action_strength_safety_blocked')
  })

  it('fails closed with insufficient_safe_pool when every classified region is excluded', () => {
    const regions: readonly BodyRegion[] = [
      'lumbar', 'thoracic', 'cervical', 'trunk_core', 'chest_ribs', 'pelvis_sacroiliac',
      'shoulder', 'elbow', 'wrist', 'hip', 'groin', 'hamstring', 'knee', 'calf',
      'achilles', 'ankle', 'foot',
    ]
    const constraints: readonly StrengthConstraint[] = regions.map((region) => ({
      kind: 'region' as const, region, sources: ['current_injuries'] as const,
    }))
    const selectionContext: StrengthContext = {
      fatigueLevel: 5, phase: 'build', recentExercises: [], goal: 'fuerza',
      sportProfile: 'strength_primary', experienceLevel: 'intermediate',
      sessionDurationMin: 60, safetyConstraints: constraints,
    }

    const result = finalizeStrengthExercisesForRestrictions({
      exercises: [{ name: 'Press de banca', sets: 3, reps: 8 }],
      constraints,
      durationMin: 60,
      sessionType: 'strength',
      selectionContext,
      userMessage: '',
      supersetMode: 'off',
    })

    expect(result).toMatchObject({ status: 'blocked', reason: 'insufficient_safe_pool' })
  })
})
