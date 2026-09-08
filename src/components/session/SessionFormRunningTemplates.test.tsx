// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionForm from './SessionForm'
import { sumTimedBlocks } from '../../services/training/sessionTimeBudget'

afterEach(cleanup)
it('catálogo manual previsualiza y guarda 400 m con referencia y presupuesto íntegros', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm defaultSport="running" athleteProfile={{ id: 'ath', updatedAt: 0, runningProfile: { fiveKTime: '25:00', z2PaceMax: '6:30' } }} heading="Running" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.selectOptions(screen.getByLabelText('Plantilla de running'), 'repeats_400')
  expect(screen.getAllByText(/400 m \(tiempo estimado\)/).length).toBeGreaterThan(1)
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0]
  expect(draft.runningTargets.templateRef).toEqual({ source: 'running_template', id: 'repeats_400', version: 1 })
  expect(sumTimedBlocks(draft.runningTargets.intervalStructure.blocks)).toBe(draft.durationMin * 60)
})
it('cambiar duración recalcula antes de guardar y una dosis imposible no se guarda', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm defaultSport="running" heading="Running" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.selectOptions(screen.getByLabelText('Plantilla de running'), 'easy_z2_base')
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '5' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('requiere al menos 15')
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '20' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(sumTimedBlocks(submit.mock.calls[0][0].runningTargets.intervalStructure.blocks)).toBe(1200)
})
