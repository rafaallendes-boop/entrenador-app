// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const h = vi.hoisted(() => {
  const goalEvent = {
    id: 'event-1',
    title: 'Masters de Chile',
    date: '2026-10-10',
    sport: 'squash',
    priority: 'primary',
  }
  const wizardConfig = {
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
  const profile = {
    id: 'athlete-1',
    updatedAt: 1,
    goalEvents: [goalEvent],
    planWizardConfig: wizardConfig,
  }

  return {
    loadMemory: vi.fn(),
    noOp: vi.fn(),
    flagEnabled: false,
    tier: 'free' as 'free' | 'weekly' | 'advanced',
    entitlementLoading: false,
    showDevTools: false,
    qualityReview: null as Record<string, unknown> | null,
    repairInstructions: {} as Record<number, string>,
    store: {} as Record<string, unknown>,
    goalEvent,
    wizardConfig,
    profile,
  }
})

const goalEvent = h.goalEvent as GoalEvent
const wizardConfig = h.wizardConfig as PlanWizardConfig
const profile = h.profile as AthleteProfile

function makePlan(generationState: TrainingPlan['generationState']): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: profile.id,
    goalEventId: goalEvent.id,
    status: 'active',
    generationState,
    title: 'Mi plan existente',
    startDate: '2026-08-17',
    endDate: goalEvent.date,
    totalWeeks: 1,
    phases: [],
    wizardConfig,
    macroSnapshot: {} as TrainingPlan['macroSnapshot'],
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeWeek(status: TrainingPlanWeek['status']): TrainingPlanWeek {
  return {
    id: 'week-1',
    athleteId: profile.id,
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-08-17',
    phase: 'base',
    status,
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function shellStore() {
  return makeStore({
    plan: makePlan('shell'),
    weeks: [makeWeek('pending')],
    status: 'shell_ready',
  })
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    plan: makePlan('complete'),
    weeks: [makeWeek('draft')],
    issues: [],
    status: 'idle',
    currentWeekIndex: null,
    completedWeeks: 1,
    failedWeekIndexes: [],
    lastError: null,
    entitlementOffer: null,
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
    ...overrides,
  }
}

vi.mock('../../store/useCoachMemoryStore', () => {
  const state = {
    athleteProfile: h.profile,
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
  usePlanBuilderStore: () => h.store,
}))

vi.mock('../../hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    tier: h.tier,
    loading: h.entitlementLoading,
    source: 'remote',
    canUse: (requestClass: string) => requestClass !== 'plan_builder_week'
      || h.tier === 'advanced',
  }),
}))

vi.mock('../../services/entitlements/entitlementFlag', () => ({
  isProactiveEntitlementUiEnabled: () => h.flagEnabled,
}))

vi.mock('../../services/auth', () => ({ supabase: null }))
vi.mock('../../services/macroPlan', () => ({ getPrimaryGoalEvent: () => h.goalEvent }))
vi.mock('../../services/planBuilder/draftSignature', () => ({ buildDraftSignature: () => 'same-draft' }))
vi.mock('../../services/planBuilder/qualityReview', () => ({
  reviewPlanQuality: () => h.qualityReview,
  buildPlanQualityRepairInstructions: () => h.repairInstructions,
}))
vi.mock('../../services/goalEventWindow', () => ({
  formatGoalEventWindow: () => '10 oct 2026',
  formatGoalEventKeyDate: () => '',
  goalEventWindowFromMacroPlan: () => h.goalEvent,
}))
vi.mock('../../services/devTools', () => ({ isDevToolsEnabled: () => h.showDevTools }))

import PlanBuilderV2Page from '../PlanBuilderV2Page'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/plan-builder/v2']}>
      <PlanBuilderV2Page />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.flagEnabled = false
  h.tier = 'free'
  h.entitlementLoading = false
  h.showDevTools = false
  h.qualityReview = null
  h.repairInstructions = {}
  h.store = shellStore()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Plan Builder proactive entitlement UI', () => {
  it('con la flag apagada deja Crear plan visible para Free', () => {
    h.entitlementLoading = true

    renderPage()

    expect(screen.getByRole('button', { name: 'Crear plan' })).toBeTruthy()
    expect(screen.queryByText(/Plan Builder está en el plan Avanzado/i)).toBeNull()
  })

  it('con la flag encendida no bloquea mientras hidrata', () => {
    h.flagEnabled = true
    h.entitlementLoading = true

    renderPage()

    expect(screen.getByRole('button', { name: 'Crear plan' })).toBeTruthy()
    expect(screen.queryByText(/Plan Builder está en el plan Avanzado/i)).toBeNull()
  })

  it.each(['free', 'weekly'] as const)(
    'con la flag encendida bloquea las affordances para %s sin ocultar el plan',
    (tier) => {
      h.flagEnabled = true
      h.tier = tier

      renderPage()

      expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull()
      expect(screen.getByText(/Plan Builder está en el plan Avanzado/i)).toBeTruthy()
      expect(screen.getByText('Mi plan existente')).toBeTruthy()
    },
  )

  it('con advanced mantiene Crear plan visible', () => {
    h.flagEnabled = true
    h.tier = 'advanced'

    renderPage()

    expect(screen.getByRole('button', { name: 'Crear plan' })).toBeTruthy()
    expect(screen.queryByText(/Plan Builder está en el plan Avanzado/i)).toBeNull()
  })

  it('oculta reparacion y regeneracion, pero conserva aceptar y descartar', () => {
    h.flagEnabled = true
    h.showDevTools = true
    h.qualityReview = {
      grade: 'poor',
      score: 40,
      criticalIssueCount: 1,
      warningCount: 0,
      repairCount: 1,
      issues: [{ message: 'Ajuste pendiente' }],
      weeks: [{ weekIndex: 0, grade: 'poor', score: 40, issues: [] }],
    }
    h.repairInstructions = { 0: 'Reparar semana' }
    h.store = makeStore()

    renderPage()

    expect(screen.queryByRole('button', { name: 'Ajustar semana' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ajustar semanas marcadas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Crear plan de nuevo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Aceptar plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
    expect(screen.getByText('Mi plan existente')).toBeTruthy()
  })

  it('oculta los reintentos tecnicos y el recovery de consumo', () => {
    h.flagEnabled = true
    h.store = makeStore({
      plan: makePlan('partial'),
      weeks: [makeWeek('error')],
      failedWeekIndexes: [0],
    })

    const view = renderPage()

    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).toBeNull()
    view.unmount()

    h.showDevTools = true
    renderPage()
    expect(screen.queryByRole('button', { name: 'Mejorar semanas pendientes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar completo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
  })

  it('muestra una sola tarjeta si ya existe una oferta reactiva', () => {
    h.flagEnabled = true
    h.store = {
      ...shellStore(),
      entitlementOffer: {
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      },
    }

    renderPage()

    expect(screen.getAllByText(/Plan Builder está en el plan Avanzado/i)).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /ver planes/i })).toHaveLength(1)
  })

  it('la oferta reactiva sigue apareciendo aunque la flag este apagada', () => {
    h.store = {
      ...shellStore(),
      entitlementOffer: {
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      },
    }

    renderPage()

    expect(screen.getByText(/Plan Builder está en el plan Avanzado/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Crear plan' })).toBeTruthy()
  })
})
