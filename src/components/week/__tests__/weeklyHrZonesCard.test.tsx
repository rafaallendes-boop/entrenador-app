// @vitest-environment jsdom

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { WhoopWorkout } from '../../../types'

// Vitest 4 (el repo está en ^4.1.3): `vi.fn` toma UN solo parámetro de tipo, la
// firma completa de la función. La forma vieja de dos parámetros
// —`vi.fn<[string, string, string], Promise<…>>()`— es de Vitest 1/2 y no compila.
const getWorkouts = vi.fn<
  (athleteId: string, from: string, to: string) => Promise<WhoopWorkout[]>
>()
const scope = { active: 'ath-self', self: 'ath-self' }

vi.mock('../../../services/readiness/localWhoopWorkouts', () => ({
  getLocalWhoopWorkoutsInRange: (...args: [string, string, string]) => getWorkouts(...args),
}))

vi.mock('../../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => scope.active,
  getSelfAthleteId: () => scope.self,
}))

import WeeklyHrZonesCard from '../WeeklyHrZonesCard'

const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
const NEXT_WEEK = WEEK.map((date) => `2026-08-${String(Number(date.slice(8)) + 7).padStart(2, '0')}`)
const ZONES = { z0: 0, z1: 0, z2: 600_000, z3: 300_000, z4: 500_000, z5: 100_000 }

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'whoop:ath-self:w1', workoutId: 'w1', athleteId: 'ath-self',
    date: '2026-08-04', sportName: 'squash',
    startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
    durationMin: 60, scoreState: 'SCORED', updatedAt: 1,
    ...overrides,
  }
}

function mockWorkouts(rows: WhoopWorkout[]) {
  getWorkouts.mockResolvedValue(rows)
  return getWorkouts
}

/**
 * Deja CADA lectura colgada por separado, resoluble en cualquier orden.
 *
 * `mockReturnValue` no sirve acá: devolvería la misma promesa —y las mismas
 * filas— a las dos consultas, así que resolverla satisfaría a ambos efectos a la
 * vez y el test no podría distinguir «la lectura vieja se descartó» de «las dos
 * lecturas trajeron lo mismo».
 */
function deferWorkoutsPerCall() {
  const pending: Array<(rows: WhoopWorkout[]) => void> = []
  getWorkouts.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
  return {
    resolveCall: (index: number, rows: WhoopWorkout[]) => pending[index](rows),
    get callCount() { return pending.length },
  }
}

function mockScope(next: { active: string; self: string }) {
  scope.active = next.active
  scope.self = next.self
}

beforeEach(() => {
  getWorkouts.mockReset()
  mockScope({ active: 'ath-self', self: 'ath-self' })
})

afterEach(cleanup)

describe('WeeklyHrZonesCard', () => {
  it('no se monta si ningún entrenamiento de la semana tiene zonas', async () => {
    mockWorkouts([])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    await waitFor(() => expect(screen.queryByText(/carga medida por whoop/i)).toBeNull())
  })

  it('titula los minutos REGISTRADOS en zona alta', async () => {
    mockWorkouts([makeWorkout({ zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    expect(await screen.findByText('10 min registrados en zona alta')).toBeTruthy()
    expect(screen.getByText(/carga medida por whoop/i)).toBeTruthy()
    // No dice "tu semana": un entrenamiento que Whoop no registró no aparece.
    expect(screen.queryByText(/tu semana/i)).toBeNull()
  })

  it('separa el conteo de cobertura baja del de no informada', async () => {
    mockWorkouts([
      makeWorkout({ workoutId: 'a', zoneDurations: ZONES, percentRecorded: 72.4 }),
      makeWorkout({ workoutId: 'b', zoneDurations: ZONES }),
    ])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    const subtitle = await screen.findByTestId('weekly-hr-zones-subtitle')
    expect(subtitle.textContent).toContain('1 con cobertura menor a 90%')
    expect(subtitle.textContent).toContain('1 sin cobertura informada')
  })

  it('omite el segmento de cobertura si no hay ninguno', async () => {
    mockWorkouts([makeWorkout({ zoneDurations: ZONES, percentRecorded: 100 })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    const subtitle = await screen.findByTestId('weekly-hr-zones-subtitle')
    expect(subtitle.textContent).not.toContain('cobertura')
  })

  it('cada columna tiene texto accesible con fecha y reparto', async () => {
    mockWorkouts([makeWorkout({ date: '2026-08-04', zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    expect(await screen.findByRole('img', { name: /2026-08-04.*zona 2/i })).toBeTruthy()
    expect(screen.getByRole('img', { name: /2026-08-03.*sin datos Whoop/i })).toBeTruthy()
  })

  it('descarta una lectura que llega después de cambiar de semana', async () => {
    const deferred = deferWorkoutsPerCall()
    const { rerender } = render(<WeeklyHrZonesCard weekDays={WEEK} />)
    rerender(<WeeklyHrZonesCard weekDays={NEXT_WEEK} />)
    await waitFor(() => expect(deferred.callCount).toBe(2))

    // La consulta VIGENTE resuelve primero, con un valor distinguible.
    deferred.resolveCall(1, [makeWorkout({
      workoutId: 'next', date: NEXT_WEEK[1],
      startAt: `${NEXT_WEEK[1]}T10:00:00.000Z`, endAt: `${NEXT_WEEK[1]}T11:00:00.000Z`,
      zoneDurations: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 60_000 },
    })])
    expect(await screen.findByText('1 min registrados en zona alta')).toBeTruthy()

    // Recién ahora llega la vieja. Si el efecto no se cancelara, pisaría el
    // valor de arriba con los 10 min de WEEK.
    deferred.resolveCall(0, [makeWorkout({ zoneDurations: ZONES })])
    await waitFor(() => expect(screen.queryByText('10 min registrados en zona alta')).toBeNull())
    expect(screen.getByText('1 min registrados en zona alta')).toBeTruthy()
  })

  it('la inicial de cada día se deriva de la fecha y ninguna se repite', async () => {
    mockWorkouts([makeWorkout({ zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    await screen.findByTestId('weekly-hr-zones-subtitle')

    // X para miércoles: la lista anterior era posicional (`['L','M','M',…]`), así
    // que asumía que la semana empieza el lunes y dejaba dos columnas rotuladas
    // «M». Con siete iniciales distintas, cada columna se puede nombrar.
    for (const initial of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
      expect(screen.getByText(initial)).toBeTruthy()
    }
  })

  it('un día sin datos no se dibuja igual que un día corto', async () => {
    mockWorkouts([
      // El día grande fija la escala; sin él, el día de un segundo sería el
      // máximo de la semana y ocuparía el alto completo.
      makeWorkout({ workoutId: 'big', date: WEEK[1], zoneDurations: ZONES }),
      makeWorkout({
        workoutId: 'tiny', date: WEEK[2],
        zoneDurations: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 1000 },
      }),
    ])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    await screen.findByTestId('weekly-hr-zones-subtitle')

    const columns = screen.getAllByRole('img')
    const empty = columns[0].style.height
    const short = columns[2].style.height

    // Si ambos cayeran al mismo mínimo, «no entrené» y «entrené un minuto» se
    // verían idénticos, que es la confusión más fácil de producir en este gráfico.
    expect(empty).toBe('2px')
    expect(short).toBe('6px')
    expect(empty).not.toBe(short)
  })

  it('no consulta para un atleta gestionado', async () => {
    mockScope({ active: 'ath-managed', self: 'ath-self' })
    const spy = mockWorkouts([makeWorkout({ zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    await waitFor(() => expect(spy).not.toHaveBeenCalled())
  })
})
