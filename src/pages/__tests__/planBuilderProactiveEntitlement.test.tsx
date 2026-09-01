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
    pending: h.entitlementLoading,
    canUse: (requestClass: string) => requestClass !== 'plan_builder_week'
      || h.tier === 'advanced',
  }),
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
  it('sin plan local, espera resolver el tier sin crear un borrador', () => {
    h.entitlementLoading = true
    h.store = makeStore({ plan: null, weeks: [], status: 'idle' })

    renderPage()

    expect(screen.getByText(/Verificando el acceso a tu plan/i)).toBeTruthy()
    expect(h.noOp).not.toHaveBeenCalled()
    expect(screen.queryByText(/Plan Builder está en el plan Avanzado/i)).toBeNull()
  })

  // Esperar el tier no puede costarle a nadie el acceso a un plan que ya está
  // en Dexie: sin esto, una lectura remota lenta o caída escondía el plan.
  it('con un plan local, la espera no oculta el plan ni ofrece nada todavía', () => {
    h.entitlementLoading = true
    h.tier = 'free'

    renderPage()

    expect(screen.getByText('Mi plan existente')).toBeTruthy()
    expect(screen.queryByText(/Verificando el acceso a tu plan/i)).toBeNull()
    expect(screen.queryByText(/Plan Builder está en el plan Avanzado/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull()
    expect(h.noOp).not.toHaveBeenCalled()
  })

  it.each(['free', 'weekly'] as const)(
    'bloquea Plan Builder desde la entrada para %s sin crear borrador',
    (tier) => {
      h.tier = tier

      renderPage()

      expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull()
      expect(screen.getByText(/Plan Builder está en el plan Avanzado/i)).toBeTruthy()
      // Bloquear la generación no es esconder el plan que el atleta ya tiene.
      expect(screen.getByText('Mi plan existente')).toBeTruthy()
      expect(h.noOp).not.toHaveBeenCalled()
    },
  )

  it('con advanced mantiene Crear plan visible', () => {
    h.tier = 'advanced'

    renderPage()

    expect(screen.getByRole('button', { name: 'Crear plan' })).toBeTruthy()
    expect(screen.queryByText(/Plan Builder está en el plan Avanzado/i)).toBeNull()
  })

  it('con advanced mantiene reparación, aceptación y descarte disponibles', () => {
    h.tier = 'advanced'
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

    expect(screen.getByRole('button', { name: 'Ajustar semana' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ajustar semanas marcadas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aceptar plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
    expect(screen.getByText('Mi plan existente')).toBeTruthy()
  })

  it('con advanced conserva los controles de recuperación', () => {
    h.tier = 'advanced'
    h.store = makeStore({
      plan: makePlan('partial'),
      weeks: [makeWeek('error')],
      failedWeekIndexes: [0],
    })

    const view = renderPage()

    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
    view.unmount()

    h.showDevTools = true
    renderPage()
    expect(screen.getByRole('button', { name: 'Mejorar semanas pendientes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar completo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
  })

  it('muestra una sola tarjeta si ya existe una oferta reactiva', () => {
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

  it('la oferta reactiva usa el mismo bloqueo preventivo sin ocultar el plan', () => {
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
    expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull()
    expect(screen.getByText('Mi plan existente')).toBeTruthy()
  })
})
