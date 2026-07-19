// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ExerciseLibraryBrowser from './ExerciseLibraryBrowser'
import { STRENGTH_EXERCISE_LIBRARY } from '../../services/training/exerciseLibrary'

afterEach(cleanup)

describe('ExerciseLibraryBrowser', () => {
  it('lista el catálogo del deporte y filtra desde el primer carácter', () => {
    render(
      <ExerciseLibraryBrowser
        sessionType="strength"
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('library-entry')).toHaveLength(
      STRENGTH_EXERCISE_LIBRARY.length,
    )
    fireEvent.change(screen.getByLabelText('Buscar en la biblioteca'), {
      target: { value: '%' },
    })
    expect(screen.queryAllByTestId('library-entry')).toHaveLength(0)
    expect(screen.queryByText('No hay resultados para esa búsqueda.')).not.toBeNull()
  })

  it('filtra por categoría e intensidad; chips de origen solo en squash', () => {
    const { unmount } = render(
      <ExerciseLibraryBrowser sessionType="squash" onAdd={vi.fn()} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole('button', { name: 'Drills squash' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Tren inferior' })).not.toBeNull()

    unmount()
    render(
      <ExerciseLibraryBrowser sessionType="strength" onAdd={vi.fn()} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole('button', { name: 'Drills squash' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tren inferior' }))
    for (const item of screen.getAllByTestId('library-entry')) {
      expect(item.textContent).toContain('Tren inferior')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Alta' }))
    for (const item of screen.getAllByTestId('library-entry')) {
      expect(item.textContent).toContain('Alta')
    }
  })

  it('al cambiar origen reinicia categoría y muestra solo categorías compatibles', () => {
    render(<ExerciseLibraryBrowser sessionType="squash" onAdd={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Tren inferior' }))
    expect(screen.getByRole('button', { name: 'Tren inferior' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Drills squash' }))
    expect(screen.queryByRole('button', { name: 'Tren inferior' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Técnico' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Todas las categorías' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByTestId('library-entry').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Fuerza' }))
    expect(screen.queryByRole('button', { name: 'Técnico' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tren inferior' })).not.toBeNull()
  })

  it('agregar notifica la entrada, no cierra el panel y permite repetir', () => {
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(
      <ExerciseLibraryBrowser
        sessionType="strength"
        onAdd={onAdd}
        onClose={onClose}
      />,
    )

    const firstAdd = screen.getAllByRole('button', { name: /^Agregar / })[0]
    fireEvent.click(firstAdd)
    fireEvent.click(firstAdd)

    expect(onAdd).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Agregado ✓')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Ejercicio agregado a la sesión')
  })

  it('es un dialog accesible: foco inicial en búsqueda y Escape cierra', () => {
    const onClose = vi.fn()
    render(
      <ExerciseLibraryBrowser
        sessionType="strength"
        onAdd={vi.fn()}
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Buscar en la biblioteca'))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('mantiene el foco dentro del dialog al tabular', () => {
    render(<ExerciseLibraryBrowser sessionType="strength" onAdd={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    const buttons = screen.getAllByRole('button')
    const lastButton = buttons[buttons.length - 1]
    lastButton.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByLabelText('Cerrar biblioteca'))
  })
})
