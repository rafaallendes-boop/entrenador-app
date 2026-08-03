// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import LegalDocumentRenderer from '../LegalDocumentRenderer'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

describe('LegalDocumentRenderer', () => {
  afterEach(() => cleanup())

  it('navega enlaces internos con React Router sin recargar la página', () => {
    render(
      <MemoryRouter initialEntries={['/terms']}>
        <LegalDocumentRenderer id="terms" />
        <LocationProbe />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Descargo de responsabilidad de salud' }))
    expect(screen.getByTestId('location').textContent).toBe('/health-disclaimer')
  })

  it('mantiene enlaces externos como anchors normales', () => {
    render(
      <MemoryRouter>
        <LegalDocumentRenderer id="privacy" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'hola@rallyiq.cl' }).getAttribute('href'))
      .toBe('mailto:hola@rallyiq.cl')
  })
})
