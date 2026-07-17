// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Athlete, Session } from '../../../types'

const mocks = vi.hoisted(() => ({
  getWeek: vi.fn(async () => []),
  remove: vi.fn(async () => {}),
}))
vi.mock('../../../services/athlete/coachScopedReads', () => ({
  getWeekSessionsForAthlete: mocks.getWeek,
}))
vi.mock('../../../services/athlete/athleteWeekScope', () => ({
  resolveAthleteWeekScope: vi.fn(async (_owner, athleteId) => ({ athleteId, includeLegacy: false })),
}))
vi.mock('../../../services/athlete/coachPlanningHydration', () => ({
  ensureWeekHydrated: vi.fn(async () => {}),
  isWeekHydrated: vi.fn(() => true),
}))
vi.mock('../../../services/athlete/coachScopedWrites', () => ({
  deleteSessionForAthlete: mocks.remove,
}))
vi.mock('../CoachSessionModal', () => ({ default: () => <div>Modal sesión</div> }))

import CoachPlanningPanel from '../CoachPlanningPanel'

const athlete: Athlete = {
  id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1',
  displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1,
}
const planned = {
  id: 's-1', athleteId: athlete.id, date: '2026-07-14', timeBlock: 'AM', type: 'squash',
  status: 'planned', title: 'Técnica', durationMin: 60, createdAt: 1, updatedAt: 1,
} as Session

function mount(sessionRows: Session[] = [], canMutate = true) {
  return render(
    <CoachPlanningPanel
      athletes={[athlete]}
      selfId={athlete.id}
      activeAthleteId={athlete.id}
      ownerAccountId="user-1"
      pendingAction={null}
      onTrainAs={vi.fn()}
      initialSessions={sessionRows}
      initialPhase="ready"
      initialCanMutate={canMutate}
    />,
  )
}

function mountWithEffects() {
  return render(
    <CoachPlanningPanel
      athletes={[athlete]}
      selfId={athlete.id}
      activeAthleteId={athlete.id}
      ownerAccountId="user-1"
      pendingAction={null}
      onTrainAs={vi.fn()}
    />,
  )
}

describe('CoachPlanningPanel interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWeek.mockResolvedValue([])
    mocks.remove.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('una semana vacía muestra siete días y siete CTAs', () => {
    mount()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: '+ Agregar sesión' })).toHaveLength(7)
  })

  it('cache stale deja CTAs deshabilitados y explica cómo habilitarlos', () => {
    mount([planned], false)
    expect(screen.getByText('Actualizá la semana para editar.')).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: '+ Agregar sesión' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('trabajo registrado pide confirmación con el copy destructivo', async () => {
    mount([{ ...planned, status: 'completed', actualRpe: 8 } as Session])
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    expect(screen.getByText('Esta sesión tiene trabajo registrado del atleta; se borrará también ese registro.')).toBeTruthy()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('sesión limpia borra directo y el guard evita doble submit', async () => {
    let release!: () => void
    mocks.remove.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    mount([planned])
    const button = screen.getByRole('button', { name: 'Borrar' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(screen.queryByText('Borrar sesión')).toBeNull()
    release()
    await vi.waitFor(() => expect(mocks.getWeek).toHaveBeenCalledOnce())
  })

  it('fallo del delete muestra banner y mantiene abierta la confirmación', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('No se pudo borrar en Dexie'))
    mount([{ ...planned, status: 'completed' } as Session])
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    const deleteButtons = screen.getAllByRole('button', { name: 'Borrar' })
    await userEvent.click(deleteButtons[deleteButtons.length - 1])
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo borrar en Dexie')
    expect(screen.getByText('Borrar sesión')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: 'Borrar' }).at(-1) as HTMLButtonElement).disabled).toBe(false)
  })

  it('un reload viejo no sobrescribe la semana seleccionada después del await', async () => {
    let call = 0
    let releaseOldReload!: () => void
    mocks.getWeek.mockImplementation(async () => {
      call += 1
      if (call <= 2) return [planned] as never
      if (call === 3) {
        return new Promise((resolve) => {
          releaseOldReload = () => resolve([{
            ...planned,
            id: 'stale',
            date: '2026-07-21',
            title: 'Respuesta vieja',
          }])
        }) as never
      }
      return []
    })
    mountWithEffects()
    await screen.findByText('Técnica')

    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    await vi.waitFor(() => expect(call).toBe(3))
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    await vi.waitFor(() => expect(call).toBeGreaterThanOrEqual(5))
    await act(async () => {
      releaseOldReload()
      await Promise.resolve()
    })
    expect(screen.queryByText('Respuesta vieja')).toBeNull()
  })
})
