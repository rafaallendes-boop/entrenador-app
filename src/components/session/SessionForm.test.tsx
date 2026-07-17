// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionForm from './SessionForm'
import type { CoachSessionDraft } from '../../services/athlete/coachSessionSerializer'

afterEach(cleanup)

const initial: CoachSessionDraft = {
  date: '2026-07-14', timeBlock: 'PM', type: 'running', title: 'Tempo',
  durationMin: 50, objective: 'Umbral', location: 'Parque', rpe: 7, notes: 'Control',
  runningTargets: { runningType: 'tempo', targetPaceMin: '4:50', targetHrMax: 170 },
}

describe('SessionForm', () => {
  it('usa defaultDate en create y entrega solo un CoachSessionDraft', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm defaultSport="squash" defaultDate="2026-07-18" heading="Nueva sesion" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    expect((screen.getByLabelText('Fecha') as HTMLInputElement).value).toBe('2026-07-18')
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    const value = onSubmit.mock.calls[0][0]
    expect(value).toMatchObject({ type: 'squash' })
    expect(value).not.toHaveProperty('status')
    expect(value).not.toHaveProperty('warmup')
    expect(value).not.toHaveProperty('squashDetails')
  })

  it('precarga modo edición y conserva limpiezas como undefined', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SessionForm initialValues={initial} defaultSport="squash" heading="Editar sesion" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Tempo')
    expect((screen.getByLabelText('Ritmo min (min/km)') as HTMLInputElement).value).toBe('4:50')
    fireEvent.change(screen.getByLabelText('Objetivo'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('RPE planificado'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ objective: undefined, rpe: undefined })
  })

  it('cambiar el tipo preserva un título personalizado', async () => {
    render(<SessionForm initialValues={initial} defaultSport="squash" heading="Editar sesion" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fuerza' }))
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Tempo')
  })

  it('cambiar el tipo actualiza el título mientras siga siendo el default automático', async () => {
    render(<SessionForm defaultSport="squash" heading="Nueva sesion" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Running' }))
    expect((screen.getByLabelText('Titulo') as HTMLInputElement).value).toBe('Salida de running')
  })

  it('muestra errores, no cancela y rehabilita los controles', async () => {
    const onCancel = vi.fn()
    render(<SessionForm defaultSport="squash" heading="Nueva sesion" submitLabel="Guardar" onSubmit={async () => { throw new Error('Sin conexión') }} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Sin conexión')
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
