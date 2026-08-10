// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import type { MacroWeekCoherenceSummary } from '../../types'
import MacroPhaseSummaryCard from './MacroPhaseSummaryCard'

/**
 * El summary conserva fase y objetivo de bloque incluso sin macroplan —los consumen
 * notificaciones y el navegador de acciones—, así que la card no puede confiar en que
 * vengan vacíos: tiene que ramificar por `coherenceStatus`.
 */
function makeSummary(overrides: Partial<MacroWeekCoherenceSummary> = {}): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'base',
    blockGoal: 'Construir base general.',
    weeklyRule: 'Construir base amplia para el deporte principal.',
    targetDistributionBySport: { squash: 'primary', strength: 'support' },
    actualDistributionBySport: { squash: 2, strength: 1 },
    expectedSessionsBySport: { squash: '3-4 sesiones' },
    coherenceStatus: 'ok',
    coherenceIssues: [],
    ...overrides,
  }
}

function renderCard(summary: MacroWeekCoherenceSummary) {
  return render(
    <MemoryRouter>
      <MacroPhaseSummaryCard summary={summary} />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('MacroPhaseSummaryCard sin macroplan', () => {
  it('muestra la invitación a crear plan', () => {
    renderCard(makeSummary({ coherenceStatus: 'not_applicable' }))

    expect(screen.getByText('Sin plan de competencia')).toBeTruthy()
    expect(screen.getByText('Crear plan')).toBeTruthy()
  })

  it('no afirma fase, objetivo de bloque ni conformidad', () => {
    const { container } = renderCard(makeSummary({ coherenceStatus: 'not_applicable' }))
    const text = container.textContent ?? ''

    expect(text).not.toContain('Fase actual')
    expect(text).not.toContain('Construir base general.')
    expect(text).not.toContain('Objetivo del bloque')
    expect(text).not.toContain('OK')
    expect(text).not.toContain('respeta la fase actual del macroplan')
  })

  it('conserva la card completa cuando sí hay macroplan', () => {
    const { container } = renderCard(makeSummary())
    const text = container.textContent ?? ''

    expect(text).toContain('Fase actual')
    expect(text).toContain('Objetivo del bloque')
    expect(screen.queryByText('Sin plan de competencia')).toBeNull()
  })
})
