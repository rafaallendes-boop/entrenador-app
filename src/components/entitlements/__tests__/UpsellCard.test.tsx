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

  it('explica la semana completa nombrando el plan que de verdad la habilita', () => {
    // `week_creator` bajó a `weekly`. El cuerpo llevaba 'plan Avanzado' escrito
    // a mano, así que la misma tarjeta decía "Coach Semanal" en el título y
    // "Avanzado" dos líneas abajo.
    renderCard('week_creator', 'weekly')

    expect(screen.getByText(/generar una semana completa de entrenamiento/i)).toBeTruthy()
    expect(screen.getAllByText(/Coach Semanal/i).length).toBeGreaterThan(0)
  })

  it('nunca nombra un plan distinto del requerido', () => {
    // Regresión estructural: cualquier literal de tier escrito a mano en el
    // cuerpo vuelve a contradecir al título en cuanto una clase cambia de plan.
    const OTHER_TIER_NAMES: Record<string, RegExp[]> = {
      weekly: [/Avanzado/i, /\bBase\b/i],
      advanced: [/Coach Semanal/i, /\bBase\b/i],
    }

    for (const requiredTier of ['weekly', 'advanced'] as const) {
      for (const requestClass of ['week_creator', 'weekly_summary', 'plan_builder_week', 'clase_inventada']) {
        const { container } = renderCard(requestClass, requiredTier)
        for (const forbidden of OTHER_TIER_NAMES[requiredTier]) {
          expect(container.textContent).not.toMatch(forbidden)
        }
        cleanup()
      }
    }
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
