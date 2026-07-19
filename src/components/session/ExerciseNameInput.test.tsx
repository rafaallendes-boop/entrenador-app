// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ExerciseNameInput from './ExerciseNameInput'

afterEach(cleanup)

describe('ExerciseNameInput', () => {
  it('no sugiere con menos de 2 caracteres y sugiere hasta 6 con 2+', () => {
    const { rerender } = render(
      <ExerciseNameInput
        index={0}
        value="s"
        sessionType="strength"
        onChangeText={vi.fn()}
        onSelectEntry={vi.fn()}
      />,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).toBeNull()
    rerender(
      <ExerciseNameInput
        index={0}
        value="sentadilla"
        sessionType="strength"
        onChangeText={vi.fn()}
        onSelectEntry={vi.fn()}
      />,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    expect(options.length).toBeLessThanOrEqual(6)
  })

  it('seleccionar una sugerencia notifica la entrada completa', () => {
    const onSelectEntry = vi.fn()
    render(
      <ExerciseNameInput
        index={0}
        value="sentadilla"
        sessionType="strength"
        onChangeText={vi.fn()}
        onSelectEntry={onSelectEntry}
      />,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'strength_exercise' }))
  })

  it('navega con teclado y expone aria-activedescendant', () => {
    const onSelectEntry = vi.fn()
    render(
      <ExerciseNameInput
        index={0}
        value="sentadilla"
        sessionType="strength"
        onChangeText={vi.fn()}
        onSelectEntry={onSelectEntry}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const active = input.getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(document.getElementById(active!)).not.toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectEntry).toHaveBeenCalled()
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
