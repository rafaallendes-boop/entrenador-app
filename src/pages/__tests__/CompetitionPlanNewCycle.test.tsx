// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '../../db/db'
import {
  bumpSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../../services/athlete/activeAthlete'
import { usePlanBuilderStore } from '../../store/usePlanBuilderStore'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import CompetitionPlanPage from '../CompetitionPlanPage'
import { getSquashSelectionContext } from '../../services/ai/promptModules/squashPrompt'
import { selectSquashDrills } from '../../services/training/drillSelector'
import { findSquashDrillByName } from '../../services/training/drillLibrary'

const mocks = vi.hoisted(() => ({
  profile: null as AthleteProfile | null,
  saveAthleteProfile: vi.fn(),
  navigate: vi.fn(),
  closePlanCycle: vi.fn(),
  deletePlanCycle: vi.fn(),
  loadAllSummaries: vi.fn(),
  allWeekSummaries: [],
  order: [] as string[],
  tier: 'advanced' as 'free' | 'weekly' | 'advanced',
  entitlementPending: false,
  activeAthleteId: 'ath-self' as string | null,
  lastSuccessfulSyncAt: null as number | null,
  syncAttemptInFlight: false,
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({
    athleteProfile: mocks.profile,
    saveAthleteProfile: mocks.saveAthleteProfile,
  }),
}))
vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    allWeekSummaries: mocks.allWeekSummaries,
    loadAllSummaries: mocks.loadAllSummaries,
  }),
}))
vi.mock('../../store/useAuthStore', () => {
  const getState = () => ({
    user: null,
    activeAthleteId: mocks.activeAthleteId,
    syncDetails: {
      lastSuccessfulSyncAt: mocks.lastSuccessfulSyncAt,
      syncAttemptInFlight: mocks.syncAttemptInFlight,
      lastErrorEntity: null,
      pendingTables: [],
      consecutiveFailures: 0,
    },
    setActiveAthleteId: () => undefined,
    setSyncDetails: () => undefined,
    setSyncStatus: () => undefined,
  })
  const useAuthStore = Object.assign(<T,>(selector: (state: {
    activeAthleteId: string | null
    syncDetails: {
      lastSuccessfulSyncAt: number | null
      syncAttemptInFlight: boolean
    }
  }) => T) => selector(getState()), {
    getState,
    setState: () => undefined,
    subscribe: () => () => undefined,
  })
  return { useAuthStore }
})
vi.mock('../../hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    tier: mocks.tier,
    loading: mocks.entitlementPending,
    pending: mocks.entitlementPending,
    source: 'remote',
    canUse: (requestClass: string) => requestClass !== 'plan_builder_week' || mocks.tier === 'advanced',
  }),
}))
vi.mock('../../services/planBuilder/closePlanCycle', () => ({
  closePlanCycle: mocks.closePlanCycle,
}))
vi.mock('../../services/planBuilder/deletePlanCycle', () => ({
  deletePlanCycle: mocks.deletePlanCycle,
}))
vi.mock('../../components/planBuilder/CycleHistory', () => ({
  CycleHistory: () => <section aria-label="Ciclos anteriores">Historial de ciclos</section>,
}))
vi.mock('../PlanDashboard', () => ({
  default: ({ onEdit, onNewCycle, readOnly = false }: {
    onEdit: () => void
    onNewCycle: (goalEventId: string) => void
    readOnly?: boolean
  }) => (
    <>
      {readOnly ? (
        <p>Plan en solo lectura</p>
      ) : (
        <>
          <button type="button" onClick={onEdit}>Editar</button>
          <button type="button" onClick={() => onNewCycle('event-prev')}>
            Planificar próximo evento
          </button>
        </>
      )}
    </>
  ),
}))

function isoInDays(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const previousEvent: GoalEvent = {
  id: 'event-prev',
  title: 'Nacional anterior',
  date: isoInDays(-7),
  sport: 'squash',
  priority: 'primary',
  eventType: 'tournament',
  objective: 'win',
  competitiveLevel: 'competitive',
}

const previousConfig: PlanWizardConfig = {
  goalEventId: previousEvent.id,
  trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
  doubleSessionDays: ['tuesday'],
  sessionsPerWeek: 4,
  sessionDurationMins: 60,
  allowDoubleSession: true,
  complementarySports: ['strength'],
  currentFitnessLevel: 'fit',
  currentFatigue: 'fresh',
  injuryNotes: 'Sin dolor',
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-02T12:00:00.000Z',
}

function profileWith(event: GoalEvent = previousEvent): AthleteProfile {
  return {
    id: 'athlete-profile',
    athleteId: 'ath-self',
    updatedAt: 1,
    sportContext: {
      primarySport: 'squash',
      enabledSports: ['squash', 'strength'],
    },
    scheduleProfile: {
      availableDays: ['monday', 'wednesday'],
    } as AthleteProfile['scheduleProfile'],
    goalEvents: [event],
    planWizardConfig: { ...previousConfig, goalEventId: event.id },
  }
}

const previousCompletePlan: TrainingPlan = {
  id: 'p1',
  athleteId: 'ath-self',
  goalEventId: previousEvent.id,
  status: 'active',
  generationState: 'complete',
  title: previousEvent.title,
  startDate: isoInDays(-70),
  endDate: previousEvent.date,
  totalWeeks: 9,
  phases: [],
  wizardConfig: previousConfig,
  macroSnapshot: {} as TrainingPlan['macroSnapshot'],
  createdAt: 1,
  updatedAt: 2,
}

async function openNewCycle() {
  render(<CompetitionPlanPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Planificar próximo evento' }))
  expect(await screen.findByText('Paso 1 de 7')).toBeTruthy()
}

function continueWizard() {
  fireEvent.click(screen.getByRole('button', { name: /continuar/i }))
}

async function reachNewCycleSummary() {
  fireEvent.change(screen.getByPlaceholderText(/Torneo Master Otoño/i), {
    target: { value: 'Nacional siguiente' },
  })
  continueWizard()
  fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
    target: { value: isoInDays(30) },
  })
  continueWizard()
  fireEvent.click(screen.getByRole('button', { name: /Rendir al máximo/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Jugador Intermedio (3ra-4ta)' }))
  continueWizard()
  continueWizard()
  continueWizard()
  fireEvent.click(screen.getByRole('button', { name: /En buena forma/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Normal' }))
  continueWizard()
  expect(screen.getByText('Paso 7 de 7')).toBeTruthy()
}

async function generateNewCycle() {
  await openNewCycle()
  await reachNewCycleSummary()
  fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
  await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))
}

describe('CompetitionPlanPage new_cycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath-self')
    setActiveAthleteId('ath-self')
    mocks.profile = profileWith()
    mocks.order = []
    mocks.tier = 'advanced'
    mocks.entitlementPending = false
    mocks.activeAthleteId = 'ath-self'
    mocks.lastSuccessfulSyncAt = null
    mocks.syncAttemptInFlight = false
    mocks.saveAthleteProfile.mockReset().mockImplementation(async (
      patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>,
    ) => {
      mocks.order.push('save')
      mocks.profile = {
        ...(mocks.profile ?? { id: 'athlete-profile', updatedAt: 1 }),
        ...patch,
      } as AthleteProfile
    })
    mocks.navigate.mockReset()
    mocks.closePlanCycle.mockReset().mockImplementation(async () => {
      mocks.order.push('close')
    })
    mocks.deletePlanCycle.mockReset().mockResolvedValue('deleted')
    mocks.loadAllSummaries.mockReset().mockResolvedValue(undefined)
    usePlanBuilderStore.getState().resetBuilderState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    usePlanBuilderStore.getState().resetBuilderState()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it.each(['free', 'weekly'] as const)(
    'en %s sin plan generado reemplaza el wizard por el CTA de Avanzado',
    async (tier) => {
      mocks.tier = tier

      render(<CompetitionPlanPage />)

      expect(await screen.findByRole('heading', { name: /Planifica tu próximo objetivo/i })).toBeTruthy()
      expect(screen.getByText('Taper')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Ver planes/i }))
      expect(mocks.navigate).toHaveBeenCalledWith('/pricing')
      expect(screen.queryByText('Paso 1 de 7')).toBeNull()
      expect(screen.queryByRole('button', { name: /Continuar/i })).toBeNull()
    },
  )

  it('permite personalizar un preset y seguir editando al volver a coincidir con él', async () => {
    await openNewCycle()
    fireEvent.change(screen.getByPlaceholderText(/Torneo Master Otoño/i), { target: { value: 'Nuevo torneo' } })
    continueWizard()
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: isoInDays(30) } })
    continueWizard()
    fireEvent.click(screen.getByRole('button', { name: /Rendir al máximo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Jugador Intermedio (3ra-4ta)' }))
    continueWizard()
    fireEvent.click(screen.getByRole('button', { name: /En casa/ }))
    fireEvent.click(screen.getByRole('button', { name: /Personalizado/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Mancuernas', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Mancuernas', exact: true }))
    expect(screen.getByRole('button', { name: 'Bandas elásticas', exact: true })).toBeTruthy()
  })

  it('permite corregir equipamiento desconocido antes de continuar', async () => {
    mocks.profile = { ...mocks.profile!, availableEquipment: ['equipo desconocido'] }
    await openNewCycle()
    fireEvent.change(screen.getByPlaceholderText(/Torneo Master Otoño/i), { target: { value: 'Nuevo torneo' } })
    continueWizard()
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: isoInDays(30) } })
    continueWizard()
    fireEvent.click(screen.getByRole('button', { name: /Rendir al máximo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Jugador Intermedio (3ra-4ta)' }))
    continueWizard()
    expect(screen.getByRole('status').textContent).toContain('equipo desconocido')
    expect((screen.getByRole('button', { name: /Continuar/i }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /En casa/ }))
    expect(screen.queryByText(/No pudimos reconocer/)).toBeNull()
    expect((screen.getByRole('button', { name: /Continuar/i }) as HTMLButtonElement).disabled).toBe(false)
    continueWizard()
    expect(await screen.findByText('Paso 5 de 7')).toBeTruthy()
  })

  it('en Free conserva un plan generado sólo para consulta', async () => {
    mocks.tier = 'free'
    await db.trainingPlans.put(previousCompletePlan)

    render(<CompetitionPlanPage />)

    expect(await screen.findByText('Plan en solo lectura')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Planificar próximo evento/i })).toBeNull()
  })

  it('relee el plan recibido durante la sincronización y abre la consulta para Free', async () => {
    mocks.tier = 'free'
    const view = render(<CompetitionPlanPage />)

    expect(await screen.findByRole('heading', { name: /Planifica tu próximo objetivo/i })).toBeTruthy()
    await db.trainingPlans.put(previousCompletePlan)
    mocks.lastSuccessfulSyncAt = 1
    view.rerender(<CompetitionPlanPage />)

    expect(await screen.findByText('Plan en solo lectura')).toBeTruthy()
  })

  it('no conserva la consulta de otro atleta al cambiar de scope', async () => {
    mocks.tier = 'free'
    await db.trainingPlans.put(previousCompletePlan)
    const view = render(<CompetitionPlanPage />)

    expect(await screen.findByText('Plan en solo lectura')).toBeTruthy()
    mocks.activeAthleteId = 'ath-other'
    setActiveAthleteId('ath-other')
    view.rerender(<CompetitionPlanPage />)

    expect(await screen.findByRole('heading', { name: /Planifica tu próximo objetivo/i })).toBeTruthy()
  })

  it('mientras se resuelve el entitlement no muestra ni wizard ni oferta', () => {
    mocks.tier = 'free'
    mocks.entitlementPending = true

    render(<CompetitionPlanPage />)

    expect(screen.getByRole('status').textContent).toContain('Revisando tu plan…')
    expect(screen.queryByRole('heading', { name: /Planifica tu próximo objetivo/i })).toBeNull()
    expect(screen.queryByText('Paso 1 de 7')).toBeNull()
  })

  it('en Free no llama endpoints de coach o generación sólo por entrar', async () => {
    mocks.tier = 'free'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    render(<CompetitionPlanPage />)

    await screen.findByRole('heading', { name: /Planifica tu próximo objetivo/i })
    const protectedPaths = [
      '/.netlify/functions/coach',
      '/.netlify/functions/enqueue-plan-generation',
      '/.netlify/functions/generate-plan-background',
    ]
    const protectedRequests = fetchSpy.mock.calls.filter(([input]) => (
      protectedPaths.some((path) => String(input).includes(path))
    ))
    expect(protectedRequests).toHaveLength(0)
    fetchSpy.mockRestore()
  })

  it('precarga hábitos anteriores pero vuelve a pedir evento, objetivo y estado actual', async () => {
    await openNewCycle()
    const title = screen.getByPlaceholderText(/Torneo Master Otoño/i) as HTMLInputElement
    expect(title.value).toBe('')
    expect(screen.queryByDisplayValue(previousEvent.date)).toBeNull()
    expect(screen.getByRole('button', { name: /Torneo de squash/ }).className)
      .toContain('bg-brand/15')
    expect(screen.getByText(/Usamos la configuración de/i).textContent)
      .toContain(previousEvent.title)

    fireEvent.change(title, { target: { value: 'Evento nuevo' } })
    continueWizard()
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: isoInDays(30) },
    })
    continueWizard()
    expect((screen.getByRole('button', { name: /continuar/i }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('"Empezar de cero" limpia la configuración heredada', async () => {
    await openNewCycle()
    const eventType = screen.getByRole('button', { name: /Torneo de squash/ })
    expect(eventType.className).toContain('bg-brand/15')
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de cero' }))
    expect(eventType.className).not.toContain('bg-brand/15')
    expect(screen.queryByText(/Usamos la configuración de/i)).toBeNull()
  })

  it('genera id y createdAt nuevos y cierra sólo el evento mostrado antes de guardar', async () => {
    await generateNewCycle()
    const patch = mocks.saveAthleteProfile.mock.calls[0][0] as Partial<AthleteProfile>
    expect(patch.goalEvents?.[0].id).not.toBe(previousEvent.id)
    expect(patch.planWizardConfig?.goalEventId).toBe(patch.goalEvents?.[0].id)
    expect(patch.planWizardConfig?.createdAt).not.toBe(previousConfig.createdAt)
    expect(patch.planWizardConfig?.createdAt).toBe(patch.planWizardConfig?.updatedAt)
    expect(mocks.closePlanCycle).toHaveBeenCalledWith({ goalEventId: previousEvent.id })
    expect(mocks.order).toEqual(['close', 'save'])
  })

  it('entrar al ciclo nuevo limpia el plan complete del store antes de navegar', async () => {
    usePlanBuilderStore.setState({ plan: previousCompletePlan, status: 'done' })
    let planSeenByNavigate: TrainingPlan | null | undefined
    mocks.navigate.mockImplementation(() => {
      planSeenByNavigate = usePlanBuilderStore.getState().plan
    })

    await openNewCycle()
    expect(usePlanBuilderStore.getState().plan).toBeNull()
    await reachNewCycleSummary()
    fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
    expect(planSeenByNavigate).toBeNull()
  })

  it('un switch durante el cierre impide guardar o navegar con el handler viejo', async () => {
    mocks.closePlanCycle.mockImplementation(async () => {
      setActiveAthleteId('ath-managed')
      bumpSwitchEpoch()
    })

    await openNewCycle()
    await reachNewCycleSummary()
    fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))

    await waitFor(() => expect(mocks.closePlanCycle).toHaveBeenCalled())
    expect(mocks.saveAthleteProfile).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('captura disponibilidad, la recarga y la transmite al selector', async () => {
    mocks.profile = profileWith({ ...previousEvent, date: isoInDays(30) })
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    for (let step = 1; step < 4; step += 1) continueWizard()
    fireEvent.change(screen.getByLabelText('Disponibilidad para squash'), { target: { value: 'solo' } })
    for (let step = 4; step < 7; step += 1) continueWizard()
    fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
    await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))
    expect(mocks.profile?.planWizardConfig?.partnerAvailability).toBe('solo')
    cleanup()
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    for (let step = 1; step < 4; step += 1) continueWizard()
    expect((screen.getByLabelText('Disponibilidad para squash') as HTMLSelectElement).value).toBe('solo')
    const context = getSquashSelectionContext({ recentSessions: [], athleteProfile: mocks.profile! })
    expect(context.partnerAvailability).toBe('solo')
    const selected = selectSquashDrills({ ...context, desiredKind: 'control' })
    expect(selected.drills.length).toBeGreaterThan(0)
    expect(selected.drills.every(d => findSquashDrillByName(d.name)?.executionMode === 'solo')).toBe(true)
  })

  it('edit conserva id y createdAt y no cierra el ciclo', async () => {
    const futureEvent = { ...previousEvent, date: isoInDays(30) }
    mocks.profile = profileWith(futureEvent)
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    for (let step = 1; step < 7; step += 1) continueWizard()
    fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
    await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))

    const patch = mocks.saveAthleteProfile.mock.calls[0][0] as Partial<AthleteProfile>
    expect(patch.goalEvents?.[0].id).toBe(futureEvent.id)
    expect(patch.planWizardConfig?.createdAt).toBe(previousConfig.createdAt)
    expect(mocks.closePlanCycle).not.toHaveBeenCalled()
  })

  it('delete exitoso borra planes active scoped, limpia perfil y store, y vuelve al wizard', async () => {
    await db.trainingPlans.bulkPut([
      previousCompletePlan,
      { ...previousCompletePlan, id: 'otro', athleteId: 'ath-managed' },
    ])
    usePlanBuilderStore.setState({ plan: previousCompletePlan, status: 'done' })
    mocks.deletePlanCycle.mockImplementation(async (planId: string) => {
      await db.trainingPlans.delete(planId)
      return 'deleted'
    })

    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))
    expect(mocks.deletePlanCycle).toHaveBeenCalledTimes(1)
    expect(mocks.deletePlanCycle).toHaveBeenCalledWith('p1')
    expect(usePlanBuilderStore.getState().plan).toBeNull()
    expect(await screen.findByText('Paso 1 de 7')).toBeTruthy()
    expect(await db.trainingPlans.get('otro')).toBeDefined()
  })

  it.each([
    ['failed', /No se pudo eliminar el plan/i],
    ['pending_sync', /pendiente de sincronización/i],
  ] as const)('con %s conserva perfil y store para reintentar', async (result, message) => {
    await db.trainingPlans.put(previousCompletePlan)
    usePlanBuilderStore.setState({ plan: previousCompletePlan, status: 'done' })
    mocks.deletePlanCycle.mockResolvedValue(result)

    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    expect(await screen.findByText(message)).toBeTruthy()
    expect(mocks.saveAthleteProfile).not.toHaveBeenCalled()
    expect(usePlanBuilderStore.getState().plan?.id).toBe('p1')
  })

  it('un switch durante delete no resetea el store ni el perfil del nuevo atleta', async () => {
    await db.trainingPlans.put(previousCompletePlan)
    const managedPlan = {
      ...previousCompletePlan,
      id: 'managed-plan',
      athleteId: 'ath-managed',
    }
    usePlanBuilderStore.setState({ plan: previousCompletePlan, status: 'done' })
    mocks.deletePlanCycle.mockImplementation(async () => {
      setActiveAthleteId('ath-managed')
      bumpSwitchEpoch()
      usePlanBuilderStore.setState({ plan: managedPlan, status: 'done' })
      return 'deleted'
    })

    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    await waitFor(() => expect(mocks.deletePlanCycle).toHaveBeenCalled())
    expect(mocks.saveAthleteProfile).not.toHaveBeenCalled()
    expect(usePlanBuilderStore.getState().plan?.id).toBe('managed-plan')
  })

  it('muestra el historial bajo el paso 1 cuando no hay plan actual', async () => {
    mocks.profile = {
      ...profileWith(),
      goalEvents: undefined,
      planWizardConfig: undefined,
    }
    render(<CompetitionPlanPage />)
    expect(await screen.findByRole('region', { name: 'Ciclos anteriores' })).toBeTruthy()
    expect(mocks.loadAllSummaries).toHaveBeenCalled()
  })

  describe('ventana del evento en el paso 2', () => {
    async function reachStep2() {
      await openNewCycle()
      fireEvent.change(screen.getByPlaceholderText(/Torneo Master Otoño/i), {
        target: { value: 'Nacional siguiente' },
      })
      continueWizard()
      expect(await screen.findByText('Paso 2 de 7')).toBeTruthy()
    }

    it('parte como evento de un día y no ofrece día clave', async () => {
      await reachStep2()
      fireEvent.change(screen.getByLabelText('Inicio del evento'), {
        target: { value: isoInDays(30) },
      })

      expect(screen.queryByLabelText('Término del evento')).toBeNull()
      expect(screen.queryByLabelText(/Día clave/)).toBeNull()
      expect(screen.getByRole('button', { name: 'El evento dura varios días' })).toBeTruthy()
    })

    it('revela el día clave sólo cuando el rango abarca más de un día', async () => {
      await reachStep2()
      fireEvent.change(screen.getByLabelText('Inicio del evento'), {
        target: { value: isoInDays(30) },
      })
      fireEvent.click(screen.getByRole('button', { name: 'El evento dura varios días' }))

      // Término inicial = inicio: sigue siendo un solo día.
      expect(screen.queryByLabelText(/Día clave/)).toBeNull()

      fireEvent.change(screen.getByLabelText('Término del evento'), {
        target: { value: isoInDays(36) },
      })
      expect(screen.getByLabelText(/Día clave/)).toBeTruthy()
    })

    it('descarta el día clave si mover el término lo deja fuera de la ventana', async () => {
      await reachStep2()
      fireEvent.change(screen.getByLabelText('Inicio del evento'), {
        target: { value: isoInDays(30) },
      })
      fireEvent.click(screen.getByRole('button', { name: 'El evento dura varios días' }))
      fireEvent.change(screen.getByLabelText('Término del evento'), {
        target: { value: isoInDays(36) },
      })
      fireEvent.change(screen.getByLabelText(/Día clave/), {
        target: { value: isoInDays(35) },
      })
      expect((screen.getByLabelText(/Día clave/) as HTMLInputElement).value).toBe(isoInDays(35))

      // Acortar el campeonato deja el día clave fuera: se limpia en vez de
      // quedar guardado inválido y fallar recién al enviar.
      fireEvent.change(screen.getByLabelText('Término del evento'), {
        target: { value: isoInDays(32) },
      })
      expect((screen.getByLabelText(/Día clave/) as HTMLInputElement).value).toBe('')
    })

    it('no permite continuar con un término anterior al inicio', async () => {
      await reachStep2()
      fireEvent.change(screen.getByLabelText('Inicio del evento'), {
        target: { value: isoInDays(30) },
      })
      fireEvent.click(screen.getByRole('button', { name: 'El evento dura varios días' }))
      fireEvent.change(screen.getByLabelText('Término del evento'), {
        target: { value: isoInDays(29) },
      })

      expect(screen.getByRole('alert').textContent).toMatch(/anterior al inicio/i)
      expect((screen.getByRole('button', { name: /continuar/i }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('vuelve a un evento de un día y descarta la ventana', async () => {
      await reachStep2()
      fireEvent.change(screen.getByLabelText('Inicio del evento'), {
        target: { value: isoInDays(30) },
      })
      fireEvent.click(screen.getByRole('button', { name: 'El evento dura varios días' }))
      fireEvent.change(screen.getByLabelText('Término del evento'), {
        target: { value: isoInDays(36) },
      })

      fireEvent.click(screen.getByRole('button', { name: 'Es de un día' }))
      expect(screen.queryByLabelText('Término del evento')).toBeNull()
      expect(screen.queryByLabelText(/Día clave/)).toBeNull()
    })
  })
})
