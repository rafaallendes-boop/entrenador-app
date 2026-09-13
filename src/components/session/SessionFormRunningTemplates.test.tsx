// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionForm from './SessionForm'
import { sumTimedBlocks } from '../../services/training/sessionTimeBudget'
import type { CoachSessionDraft } from '../../services/athlete/coachSessionSerializer'
import { materializeRunningTemplate } from '../../services/training/runningTemplateMaterializer'

afterEach(cleanup)

const profile = { id: 'ath', updatedAt: 100, runningProfile: { fiveKTime: '25:00', z2PaceMax: '6:30' } }

function existingRepeats(): CoachSessionDraft {
  const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: profile.runningProfile, intent: 'progress', profileRevision: 100 })
  if (!dose.ok) throw new Error(dose.message)
  return {
    date: '2026-08-10', timeBlock: 'AM', type: 'running', title: 'Series 400', durationMin: 60,
    runningTargets: { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization },
  }
}

const countReps = (draft: CoachSessionDraft) => draft.runningTargets!.intervalStructure!.blocks
  .filter(block => block.distanceKm === 0.4).reduce((n, block) => n + (block.repetitions ?? 1), 0)
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

it('A3: editar el título de una sesión existente conserva la estructura byte a byte', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Titulo'), { target: { value: 'Series 400 (martes)' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(countReps(initial)).toBe(11)
  expect(draft.runningTargets!.intervalStructure).toEqual(initial.runningTargets!.intervalStructure)
  expect(draft.runningTargets!.materialization).toEqual(initial.runningTargets!.materialization)
})

it('A3: cambiar la duración exige revisar el diff antes de guardar y persiste exactamente lo aprobado', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  // Primer intento: no guarda, muestra el diff con cambios concretos de dosis.
  expect(submit).not.toHaveBeenCalled()
  const diff = screen.getByTestId('running-recalc-diff').textContent ?? ''
  expect(diff).toMatch(/repeticiones: 11 → \d+/)
  expect(diff).toContain('duración: 60 → 45 min')
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  const approved = (screen.getByTestId('running-approved-structure') as HTMLElement).dataset.signature
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(JSON.stringify(draft.runningTargets!.intervalStructure)).toBe(approved)
  expect(draft.runningTargets!.materialization?.intent).toBe('progress')
  expect(sumTimedBlocks(draft.runningTargets!.intervalStructure!.blocks)).toBe(45 * 60)
})

it('A3: cambiar la duración después de aprobar invalida la aprobación', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm origin="existing" initialValues={existingRepeats()} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '50' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByTestId('running-recalc-diff').textContent).toContain('duración: 60 → 50 min')
})

it('A3: un recálculo aprobado caduca si el perfil cambia antes de guardar', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  const newerProfile = { ...profile, updatedAt: 200, runningProfile: { fiveKTime: '23:00', z2PaceMax: '6:00' } }
  const view = render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={newerProfile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  // El perfil vuelve a cambiar (p. ej. otro dispositivo sincronizó) antes de guardar.
  view.rerender(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={{ ...newerProfile, updatedAt: 300, runningProfile: { fiveKTime: '22:00', z2PaceMax: '5:50' } }} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByTestId('running-recalc-diff').textContent).toContain('ritmos de referencia del perfil')
  expect(screen.queryByTestId('running-approved-structure')).toBeNull()
})

it('A3: ritmos manuales incompatibles con los bloques no se guardan', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm origin="existing" initialValues={existingRepeats()} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Ritmo min (min/km)'), { target: { value: '6:30' } })
  fireEvent.change(screen.getByLabelText('Ritmo max (min/km)'), { target: { value: '7:00' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('no corresponden a los bloques')
})

it('A3: una sesión completada rechaza cambiar duración o plantilla', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm origin="existing" sessionStatus="completed" initialValues={existingRepeats()} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('ya fue realizada')
  expect(screen.queryByRole('button', { name: 'Recalcular dosis' })).toBeNull()
})

it('A3: recalcular muestra qué cambió y sólo aplica al confirmar', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  const newerProfile = { ...profile, updatedAt: 200, runningProfile: { fiveKTime: '23:00', z2PaceMax: '6:00' } }
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={newerProfile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  const diff = screen.getByTestId('running-recalc-diff').textContent ?? ''
  expect(diff).toContain('ritmos de referencia del perfil')
  expect(diff).toContain('intención: progress')
  expect(diff).toMatch(/ritmo de trabajo: .* → .*/)
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  const approved = (screen.getByTestId('running-approved-structure') as HTMLElement).dataset.signature
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(JSON.stringify(draft.runningTargets!.intervalStructure)).toBe(approved)
  expect(draft.runningTargets!.materialization?.profileRevision).toBe(200)
  expect(draft.runningTargets!.intervalStructure).not.toEqual(initial.runningTargets!.intervalStructure)
})

it('A3: editar el nombre de una plantilla existente no rematerializa su receta', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  render(<SessionForm origin="existing" mode="template" initialName="Series 400" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar plantilla" submitLabel="Guardar cambios" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Nombre de plantilla'), { target: { value: 'Series 400 v2' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(draft.runningTargets!.intervalStructure).toEqual(initial.runningTargets!.intervalStructure)
})

it('A3: una receta antigua sin procedencia se recalcula con hold y lo declara', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  delete initial.runningTargets!.materialization
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  const diff = screen.getByTestId('running-recalc-diff').textContent ?? ''
  expect(diff).toContain('versión original desconocida')
  expect(diff).toContain('intención asumida: mantener')
})


it('la vista de una receta guardada conserva sus once repeticiones aunque el perfil cambie', () => {
  const initial = existingRepeats()
  render(<SessionForm origin="existing" initialValues={initial} athleteProfile={{ ...profile, updatedAt: 200, runningProfile: { fiveKTime: '20:00' } }} heading="Editar" submitLabel="Guardar" onSubmit={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getAllByText(/400 m \(tiempo estimado\)/)).toHaveLength(11)
})

it('cambiar de plantilla compara la dosis contra la sesión original', async () => {
  const submit = vi.fn()
  render(<SessionForm origin="existing" initialValues={existingRepeats()} athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.selectOptions(screen.getByLabelText('Plantilla de running'), 'easy_z2_base')
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByTestId('running-recalc-diff').textContent).toContain('repeticiones: 11 → 1')
})

it('una sesión realizada no puede borrar la receta para eludir el bloqueo de duración', async () => {
  const submit = vi.fn()
  render(<SessionForm origin="existing" sessionStatus="completed" initialValues={existingRepeats()} athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.selectOptions(screen.getByLabelText('Plantilla de running'), '')
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('ya fue realizada')
})

it('un recálculo valida también los ritmos de tarjeta heredados', async () => {
  const initial = existingRepeats()
  initial.runningTargets!.targetPaceMin = '4:50'
  initial.runningTargets!.targetPaceMax = '5:00'
  const submit = vi.fn()
  render(<SessionForm origin="existing" initialValues={initial} athleteProfile={{ ...profile, updatedAt: 200, runningProfile: { fiveKTime: '20:00' } }} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('no corresponden a los bloques')
})
