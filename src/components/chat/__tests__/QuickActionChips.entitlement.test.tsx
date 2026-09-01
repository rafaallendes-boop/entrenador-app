// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import QuickActionChips from '../QuickActionChips'

describe('QuickActionChips — entitlement de semana completa', () => {
  it('muestra las acciones de semana bloqueadas para Free y abre la oferta sin enviar prompts', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onRequireWeekCreator = vi.fn()

    render(
      <QuickActionChips
        onSelect={onSelect}
        onRequireWeekCreator={onRequireWeekCreator}
        canCreateWeek={false}
        enabledSports={['squash', 'strength']}
      />,
    )

    const createWeek = screen.getByRole('button', { name: 'Crear semana' })
    expect(createWeek.getAttribute('aria-disabled')).toBe('true')
    expect(createWeek.getAttribute('title')).toBe('Disponible en Avanzado')

    await user.click(createWeek)
    await user.click(screen.getByRole('button', { name: 'Priorizar squash' }))

    expect(onRequireWeekCreator).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
