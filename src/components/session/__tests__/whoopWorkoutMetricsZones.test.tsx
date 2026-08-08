// @vitest-environment jsdom

import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WhoopWorkout } from '../../../types'
import WhoopWorkoutMetrics from '../WhoopWorkoutMetrics'

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'whoop:ath-1:w1', workoutId: 'w1', athleteId: 'ath-1',
    date: '2026-08-04', sportName: 'squash',
    startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
    durationMin: 60, strain: 12.4, avgHr: 142, maxHr: 181,
    scoreState: 'SCORED', updatedAt: 1,
    ...overrides,
  }
}

// 4:29 + 4:29 = 8:58 → el titular dice 9 min. Es el caso que fija que el
// titular se redondea desde los MS crudos y no desde los segundos ya redondeados.
const EDGE_ZONES = { z0: 0, z1: 0, z2: 0, z3: 60_000, z4: 269_000, z5: 269_000 }

describe('WhoopWorkoutMetrics — zonas', () => {
  afterEach(cleanup)

  it('no muestra nada de zonas cuando el workout no las tiene', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout()} />)
    expect(screen.queryByText(/zona alta/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /distribución/i })).toBeNull()
    // Paridad de contenido con la Entrega 2.
    expect(screen.getByText('12.4')).toBeTruthy()
    expect(screen.getByText('60 min')).toBeTruthy()
    expect(screen.getByText('142 / 181 bpm')).toBeTruthy()
  })

  it('el titular de zona alta se redondea desde los milisegundos crudos', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({ zoneDurations: EDGE_ZONES })} />)
    expect(screen.getByText('9 min')).toBeTruthy()
    expect(screen.getByText('Zona alta')).toBeTruthy()
  })

  it('el desplegable es un button con aria-expanded y muestra m:ss por zona', async () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({ zoneDurations: EDGE_ZONES })} />)
    const toggle = screen.getByRole('button', { name: /distribución/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const rows = screen.getAllByRole('listitem')
    // Orden Z5 → Z0.
    expect(within(rows[0]).getByText('Z5')).toBeTruthy()
    expect(within(rows[0]).getByText('4:29')).toBeTruthy()
    expect(within(rows[5]).getByText('Z0')).toBeTruthy()
    expect(within(rows[5]).getByText('0:00')).toBeTruthy()
  })

  it('cobertura low: aviso visible bajo la barra, truncado', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({
      zoneDurations: EDGE_ZONES, percentRecorded: 89.96,
    })} />)
    expect(screen.getByText('Cobertura de medición Whoop: 89,9%')).toBeTruthy()
  })

  it('cobertura full: no dice nada', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({
      zoneDurations: EDGE_ZONES, percentRecorded: 100,
    })} />)
    expect(screen.queryByText(/cobertura/i)).toBeNull()
  })

  it.each([
    [92.4, 'Cobertura de medición Whoop: 92,4%'],
    [undefined, 'Cobertura de medición no informada'],
  ])('cobertura %s: dato neutral dentro del desplegable', async (percentRecorded, text) => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({
      zoneDurations: EDGE_ZONES, percentRecorded,
    })} />)
    expect(screen.queryByText(text)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /distribución/i }))
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('la distribución tiene texto accesible sin depender del color', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({ zoneDurations: EDGE_ZONES })} />)
    expect(screen.getByRole('img', { name: /zona 5: 4 minutos 29 segundos/i })).toBeTruthy()
  })
})
