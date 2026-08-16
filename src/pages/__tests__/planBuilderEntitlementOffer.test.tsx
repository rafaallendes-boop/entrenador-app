// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'

const h = vi.hoisted(() => ({
  loadMemory: vi.fn(),
  noOp: vi.fn(),
}))

const goalEvent: GoalEvent = {
  id: 'event-1',
  title: 'Masters de Chile',
  date: '2026-10-10',
  sport: 'squash',
  priority: 'primary',
}

const wizardConfig: PlanWizardConfig = {
  goalEventId: goalEvent.id,
  trainingDays: ['monday', 'wednesday', 'friday'],
  sessionsPerWeek: 3,
  sessionDurationMins: 60,
  allowDoubleSession: false,
  complementarySports: ['strength'],
  currentFitnessLevel: 'normal',
  currentFatigue: 'normal',
  createdAt: '2026-08-16',
  updatedAt: '2026-08-16',
}

const profile: AthleteProfile = {
  id: 'athlete-1',
  updatedAt: 1,
  goalEvents: [goalEvent],
  planWizardConfig: wizardConfig,
}

const plan: TrainingPlan = {
  id: 'plan-1',
  athleteId: profile.id,
  goalEventId: goalEvent.id,
  status: 'active',
  generationState: 'complete',
  title: 'Mi plan ya generado',
  startDate: '2026-08-17',
  endDate: goalEvent.date,
  totalWeeks: 8,
  phases: [],
  wizardConfig,
  macroSnapshot: {} as TrainingPlan['macroSnapshot'],
  createdAt: 1,
  updatedAt: 1,
}

vi.mock('../../store/useCoachMemoryStore', () => {
  const state = {
    athleteProfile: profile,
    hasLoaded: true,
    loadMemory: h.loadMemory,
  }
  return {
    useCoachMemoryStore: (selector: (value: typeof state) => unknown) => selector(state),
  }
})

vi.mock('../../store/useAuthStore', () => {
  const state = { user: null, isLoading: false }
  return {
    useAuthStore: (selector: (value: typeof state) => unknown) => selector(state),
  }
})

vi.mock('../../store/usePlanBuilderStore', () => ({
  usePlanBuilderStore: () => ({
    plan,
    weeks: [],
    issues: [],
    status: 'done',
    currentWeekIndex: null,
    completedWeeks: 0,
    failedWeekIndexes: [],
    lastError: null,
    entitlementOffer: {
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    },
    createDraft: h.noOp,
    runGeneration: h.noOp,
    retryFullGeneration: h.noOp,
    regenerateWeek: h.noOp,
    regenerateWeeks: h.noOp,
    retryFailedWeeks: h.noOp,
    retryIncompleteWeeks: h.noOp,
    cancelGeneration: h.noOp,
    acceptPlan: h.noOp,
    discard: h.noOp,
    loadDraft: h.noOp,
  }),
}))

vi.mock('../../services/auth', () => ({ supabase: null }))
vi.mock('../../services/macroPlan', () => ({ getPrimaryGoalEvent: () => goalEvent }))
vi.mock('../../services/planBuilder/draftSignature', () => ({ buildDraftSignature: () => 'same-draft' }))
vi.mock('../../services/planBuilder/qualityReview', () => ({
  reviewPlanQuality: () => null,
  buildPlanQualityRepairInstructions: () => ({}),
}))
vi.mock('../../services/goalEventWindow', () => ({
  formatGoalEventWindow: () => '10 oct 2026',
  formatGoalEventKeyDate: () => '',
  goalEventWindowFromMacroPlan: () => goalEvent,
}))
vi.mock('../../services/devTools', () => ({ isDevToolsEnabled: () => false }))

afterEach(cleanup)

describe('Plan Builder entitlement offer', () => {
  it('muestra la oferta reactiva sin ocultar el plan existente', async () => {
    const { default: PlanBuilderV2Page } = await import('../PlanBuilderV2Page')

    render(
      <MemoryRouter initialEntries={['/plan-builder/v2']}>
        <PlanBuilderV2Page />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Plan Builder está en el plan Avanzado/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /ver planes/i }).getAttribute('href')).toBe('/pricing')
    expect(screen.getByText('Mi plan ya generado')).toBeTruthy()
  })
})
