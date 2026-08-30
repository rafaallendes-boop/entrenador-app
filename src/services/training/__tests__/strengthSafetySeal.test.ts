import { describe, expect, it } from 'vitest'
import type { CoachExerciseProposal } from '../../../types'
import type { StrengthConstraint } from '../../../types/strengthSafety'
import {
  buildStrengthSafetySeal,
  isSealValid,
  prepareStrengthSession,
  STRENGTH_SAFETY_POLICY_VERSION,
} from '../strengthSafetyFinalizer'
import type { StrengthContext } from '../strengthSelector'

const lumbar: StrengthConstraint[] = [
  { kind: 'region', region: 'lumbar', sources: ['current_injuries'] },
]
const first: CoachExerciseProposal = { name: 'Remo con pecho apoyado', sets: 3, reps: 10 }
const second: CoachExerciseProposal = { name: 'Jalón al pecho', sets: 3, reps: 10 }

const selectionContext: StrengthContext = {
  fatigueLevel: 5,
  phase: 'build',
  recentExercises: [],
  goal: 'fuerza',
  sportProfile: 'sport_support',
  experienceLevel: 'intermediate',
  sessionDurationMin: 60,
  safetyConstraints: lumbar,
}

describe('strength safety seal', () => {
  it('validates the exact finalized content', () => {
    const seal = buildStrengthSafetySeal([first, second], lumbar, 'strength', 60, [])
    expect(isSealValid(seal, [first, second], lumbar, 'strength', 60)).toBe(true)
  })

  it('invalidates a changed exercise, execution order, duration, constraints, or policy', () => {
    const seal = buildStrengthSafetySeal([first, second], lumbar, 'strength', 60, [])
    const knee: StrengthConstraint[] = [
      { kind: 'region', region: 'knee', sources: ['current_injuries'] },
    ]

    expect(isSealValid(seal, [first], lumbar, 'strength', 60)).toBe(false)
    expect(isSealValid(seal, [second, first], lumbar, 'strength', 60)).toBe(false)
    expect(isSealValid(seal, [first, second], lumbar, 'strength', 75)).toBe(false)
    expect(isSealValid(seal, [first, second], knee, 'strength', 60)).toBe(false)
    expect(isSealValid(
      { ...seal, policyVersion: STRENGTH_SAFETY_POLICY_VERSION + 1 },
      [first, second],
      lumbar,
      'strength',
      60,
    )).toBe(false)
  })

  it('does not accept a forged fingerprint', () => {
    expect(isSealValid({
      policyVersion: STRENGTH_SAFETY_POLICY_VERSION,
      exerciseFingerprint: 'forged',
      constraintFingerprint: 'forged',
      userMessageConstraints: [],
    }, [first, second], lumbar, 'strength', 60)).toBe(false)
  })

  it('writes a nested session seal to metadata and a flat action seal to root', () => {
    const options = {
      constraints: lumbar,
      userMessageConstraints: [],
      userMessage: '',
      selectionContext,
      structureOptions: { durationMin: 60 },
      supersetMode: 'off' as const,
    }
    const nested = prepareStrengthSession({
      durationMin: 60,
      exercises: [first, second],
      metadata: { planBuilderStrengthRotation: { blockId: 'b', signature: 's' } },
    }, options)
    const flat = prepareStrengthSession({ durationMin: 60, exercises: [first, second] }, {
      ...options,
      sealLocation: 'root',
    })

    expect(nested.status).toBe('ok')
    if (nested.status === 'ok') {
      expect(nested.session.metadata?.strengthSafetyFinalization).toBeDefined()
      expect(nested.session.metadata?.planBuilderStrengthRotation).toEqual({ blockId: 'b', signature: 's' })
    }
    expect(flat.status).toBe('ok')
    if (flat.status === 'ok') {
      expect(flat.session).toHaveProperty('strengthSafetyFinalization')
    }
  })
})
