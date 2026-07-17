// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '../../types'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  profile: vi.fn(),
}))
vi.mock('../../services/athlete/coachScopedWrites', () => ({
  createSessionForAthlete: mocks.create,
  updateSessionForAthlete: mocks.update,
}))
vi.mock('../../services/athlete/coachScopedReads', () => ({
  getAthleteProfileForAthlete: mocks.profile,
}))

import CoachSessionModal from './CoachSessionModal'

const session = {
  id: 's-1', athleteId: 'ath_m', date: '2026-07-14', weekStartDate: '2026-07-13',
  timeBlock: 'AM', type: 'squash', status: 'planned', source: 'coach',
  authoredByRole: 'coach', title: 'Técnica', durationMin: 60, createdAt: 1, updatedAt: 1,
  subtype: 'training',
} as Session

describe('CoachSessionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
    mocks.update.mockResolvedValue({})
    mocks.profile.mockResolvedValue({
      primarySport: 'running', sportContext: { primarySport: 'cycling' },
    })
  })
  afterEach(cleanup)

  it('resuelve defaultSport priorizando sportContext y conserva defaultDate', async () => {
    render(<CoachSessionModal ownerAccountId="user-1" athleteId="ath_m" defaultDate="2026-07-19" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect((await screen.findByLabelText('Titulo') as HTMLInputElement).value).toBe('Sesion de ciclismo')
    expect((screen.getByLabelText('Fecha') as HTMLInputElement).value).toBe('2026-07-19')
  })

  it('dos clicks en el mismo tick crean una sola vez y bloquean backdrop', async () => {
    let release!: () => void
    mocks.create.mockImplementation(() => new Promise((resolve) => { release = () => resolve({}) }))
    const onClose = vi.fn()
    render(<CoachSessionModal ownerAccountId="user-1" athleteId="ath_m" defaultDate="2026-07-19" onClose={onClose} onSaved={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Agregar sesión' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(screen.getByTestId('coach-session-backdrop'))
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('un error permanece visible y rehabilita el submit', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Semana sin hidratar'))
    render(<CoachSessionModal ownerAccountId="user-1" athleteId="ath_m" defaultDate="2026-07-19" onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar sesión' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Semana sin hidratar')
    expect((screen.getByRole('button', { name: 'Agregar sesión' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('edición precarga y envía solo el patch', async () => {
    const onSaved = vi.fn()
    render(<CoachSessionModal ownerAccountId="user-1" athleteId="ath_m" defaultDate="2026-07-14" session={session} onClose={vi.fn()} onSaved={onSaved} />)
    const title = screen.getByLabelText('Titulo')
    await userEvent.clear(title)
    await userEvent.type(title, 'Táctica')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(mocks.update).toHaveBeenCalledWith('user-1', 'ath_m', 's-1', { title: 'Táctica' })
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
