// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const addSession = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../store/useTrainingStore', () => ({ useTrainingStore: () => ({ addSession }) }))
vi.mock('../../store/useCoachMemoryStore', () => ({ useCoachMemoryStore: () => ({ athleteProfile: undefined }) }))

import AddSessionModal from './AddSessionModal'

describe('AddSessionModal', () => {
  beforeEach(() => addSession.mockClear())
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
})
