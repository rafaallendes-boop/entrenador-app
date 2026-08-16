// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { UpsellCard } from '../UpsellCard'

afterEach(cleanup)

function renderCard(requestClass: string, requiredTier: 'weekly' | 'advanced') {
  return render(
    <MemoryRouter>
      <UpsellCard requestClass={requestClass} requiredTier={requiredTier} />
    </MemoryRouter>,
  )
}

describe('UpsellCard', () => {
  it('nombra la funcion y el plan, con CTA a pricing', () => {
    renderCard('plan_builder_week', 'advanced')

    expect(screen.getByText(/Plan Builder/i)).toBeTruthy()
    expect(screen.getByText(/Avanzado/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /ver planes/i }).getAttribute('href')).toBe('/pricing')
  })

  it('usa el nombre comercial del tier, no el identificador tecnico', () => {
    renderCard('week_creator', 'weekly')

    expect(screen.getByText(/Coach Semanal/i)).toBeTruthy()
    expect(screen.queryByText(/\bweekly\b/)).toBeNull()
  })

  it('presenta una oferta sin lenguaje de error', () => {
    const { container } = renderCard('plan_builder_week', 'advanced')

    expect(container.textContent).not.toMatch(/error|fallo|falló|inválido|no autorizado/i)
    expect(screen.getByRole('region', { name: /opción de plan/i })).toBeTruthy()
  })

  it('una clase desconocida cae a copy generico sin romper', () => {
    renderCard('clase_inventada', 'advanced')

    expect(screen.getByText(/esta función/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /ver planes/i })).toBeTruthy()
  })
})
