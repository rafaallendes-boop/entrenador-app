// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { CoachSessionDraft } from '../../../services/athlete/coachSessionSerializer'
import SessionForm from '../SessionForm'

afterEach(cleanup)

const initialValues: CoachSessionDraft = {
  date: '2026-08-10',
  timeBlock: 'AM',
  type: 'strength',
  title: 'Fuerza',
  durationMin: 60,
  exercises: [
    { id: 'a', name: 'Clean', sets: 5, reps: '3' },
    { id: 'b', name: 'Dominadas', sets: 3, reps: '8' },
    { id: 'c', name: 'Plancha frontal', sets: 3, reps: '30s' },
  ],
}

const renderForm = (onSubmit = vi.fn(async () => {}), values = initialValues) => render(
  <SessionForm
    initialValues={values}
    defaultSport="strength"
    heading="Editar sesion"
    submitLabel="Guardar"
    onSubmit={onSubmit}
    onCancel={vi.fn()}
  />,
)

describe('SessionForm — grupos', () => {
  it('agrupar con el anterior propaga los sets del lider y expone el estado', async () => {
    const user = userEvent.setup()
    renderForm()

    const toggle = screen.getByLabelText('Agrupar ejercicio 2 con el anterior')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await user.click(toggle)

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Series 2') as HTMLInputElement).value).toBe('5')
    expect(screen.getByLabelText('Series 2').hasAttribute('readonly')).toBe(true)
  })

  it('editar los sets del lider actualiza a sus miembros', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.clear(screen.getByLabelText('Series 1'))
    await user.type(screen.getByLabelText('Series 1'), '6')

    expect((screen.getByLabelText('Series 2') as HTMLInputElement).value).toBe('6')
  })

  it('desagrupar conserva el valor y vuelve editables ambos segmentos', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))

    expect((screen.getByLabelText('Series 2') as HTMLInputElement).value).toBe('5')
    expect(screen.getByLabelText('Series 2').hasAttribute('readonly')).toBe(false)
  })

  it('cortar un grupo de tres asigna un id nuevo al segmento derecho', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderForm(onSubmit)

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 3 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    const saved = onSubmit.mock.calls[0]![0].exercises!
    expect(saved[0]!.supersetGroup).toBeUndefined()
    expect(saved[1]!.supersetGroup).toBeDefined()
    expect(saved[1]!.supersetGroup).toBe(saved[2]!.supersetGroup)
  })

  it('mover un lider arrastra su grupo completo', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderForm(onSubmit)

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Bajar ejercicio 1'))
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    const saved = onSubmit.mock.calls[0]![0].exercises!
    expect(saved.map((exercise) => exercise.name)).toEqual([
      'Plancha frontal',
      'Clean',
      'Dominadas',
    ])
  })

  it('mover un miembro reordena solo dentro de su grupo', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderForm(onSubmit)

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 3 con el anterior'))
    await user.click(screen.getByLabelText('Subir ejercicio 3'))
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    const saved = onSubmit.mock.calls[0]![0].exercises!
    expect(saved.map((exercise) => exercise.name)).toEqual([
      'Clean',
      'Plancha frontal',
      'Dominadas',
    ])
    expect(new Set(saved.map((exercise) => exercise.supersetGroup)).size).toBe(1)
  })

  it('normaliza grupos invalidos al guardar', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderForm(onSubmit, {
      ...initialValues,
      exercises: initialValues.exercises!.map((exercise, index) => ({
        ...exercise,
        supersetGroup: index === 0 ? 'singleton' : undefined,
      })),
    })

    await user.click(screen.getByRole('button', { name: /guardar/i }))

    expect(onSubmit.mock.calls[0]![0].exercises![0]!.supersetGroup).toBeUndefined()
  })

  it('no ofrece agrupacion ni persiste tags fuera de fuerza', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderForm(onSubmit, {
      ...initialValues,
      type: 'squash',
      exercises: initialValues.exercises!.slice(0, 2).map((exercise) => ({
        ...exercise,
        supersetGroup: 'legacy-group',
      })),
    })

    expect(screen.queryByLabelText('Agrupar ejercicio 2 con el anterior')).toBeNull()
    await user.click(screen.getByRole('button', { name: /guardar/i }))
    expect(onSubmit.mock.calls[0]![0].exercises!.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })
})
