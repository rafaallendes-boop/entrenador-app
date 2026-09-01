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
    expect(screen.getAllByText(/Avanzado/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /ver planes/i }).getAttribute('href')).toBe('/pricing')
  })

  it('explica la semana completa como capacidad de Avanzado', () => {
    renderCard('week_creator', 'advanced')

    expect(screen.getAllByText(/Avanzado/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/generar una semana completa de entrenamiento/i)).toBeTruthy()
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
