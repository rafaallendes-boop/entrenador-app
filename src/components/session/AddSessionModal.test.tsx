// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '../../types'

const mocks = vi.hoisted(() => ({
  addSession: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
}))
vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({ addSession: mocks.addSession, updateSession: mocks.updateSession }),
}))
vi.mock('../../store/useCoachMemoryStore', () => ({ useCoachMemoryStore: () => ({ athleteProfile: undefined }) }))

import AddSessionModal from './AddSessionModal'

const { addSession, updateSession } = mocks

const existingSession = {
  id: 's-manual-1', athleteId: 'self', date: '2026-07-14', weekStartDate: '2026-07-13',
  timeBlock: 'AM', type: 'squash', status: 'planned', source: 'manual',
  authoredByRole: 'athlete', title: 'Squash suelto', durationMin: 45, createdAt: 1, updatedAt: 1,
  subtype: 'training',
} as Session

describe('AddSessionModal', () => {
  beforeEach(() => {
    addSession.mockClear()
    updateSession.mockClear()
  })
  afterEach(cleanup)

  it('conserva defaults y submit manual planned', async () => {
    const onClose = vi.fn()
    render(<AddSessionModal defaultDate="2026-07-17" onClose={onClose} />)
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Sesion de squash')
    expect((screen.getByLabelText('Fecha') as HTMLInputElement).value).toBe('2026-07-17')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar sesion' }))
    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual', status: 'planned', type: 'squash',
    }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('no envía un título vacío', async () => {
    render(<AddSessionModal onClose={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText('Titulo'))
    expect((screen.getByRole('button', { name: 'Agregar sesion' }) as HTMLButtonElement).disabled).toBe(true)
    expect(addSession).not.toHaveBeenCalled()
  })

  it('cambiar a running serializa runningDetails', async () => {
    render(<AddSessionModal onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Running' }))
    await userEvent.click(screen.getByRole('button', { name: 'Agregar sesion' }))
    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'running', runningDetails: expect.objectContaining({ runningType: 'z2' }),
    }))
  })

  it('con session precarga el formulario en modo edicion y llama a updateSession', async () => {
    const onClose = vi.fn()
    render(<AddSessionModal session={existingSession} onClose={onClose} />)
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Squash suelto')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(updateSession).toHaveBeenCalledWith(
      existingSession.id,
      expect.objectContaining({ id: existingSession.id, title: 'Squash suelto' }),
    )
    expect(addSession).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
