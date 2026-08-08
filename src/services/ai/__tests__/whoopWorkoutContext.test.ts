import { describe, it, expect } from 'vitest'
import type { Session, WhoopWorkout } from '../../../types'
import { formatWhoopWorkoutBlock } from '../whoopWorkoutContext'

const TODAY = '2026-08-07'

function makeWorkout(overrides: Partial<WhoopWorkout> & { workoutId: string }): WhoopWorkout {
  const date = overrides.date ?? '2026-08-04'
  return {
    id: `whoop:self-1:${overrides.workoutId}`,
    athleteId: 'self-1',
    date,
    sportName: 'running',
    startAt: `${date}T10:00:00.000Z`,
    endAt: `${date}T10:30:00.000Z`,
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

function makeSession(workoutId: string): Session {
  return {
    id: `session-${workoutId}`,
    date: '2026-08-04',
    timeBlock: 'AM',
    status: 'completed',
    title: 'Running Z2',
    durationMin: 60,
    type: 'running',
    createdAt: 1,
    updatedAt: 1,
    autoCompletion: {
      source: 'whoop_workout',
      workoutId,
      completedAt: '2026-08-04T10:30:00.000Z',
    },
  } as Session
}

describe('formatWhoopWorkoutBlock', () => {
  it('returns null when there are no workouts', () => {
    expect(formatWhoopWorkoutBlock([], [], TODAY)).toBeNull()
  })

  it('returns null when every workout falls outside the window', () => {
    const old = makeWorkout({ workoutId: 'old', date: '2026-07-31' })
    expect(formatWhoopWorkoutBlock([old], [], TODAY)).toBeNull()
  })

  it('includes both window boundaries and excludes the day before', () => {
    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'too-old', date: '2026-07-31' }),
      makeWorkout({ workoutId: 'first-day', date: '2026-08-01' }),
      makeWorkout({ workoutId: 'today', date: TODAY }),
    ], [], TODAY)

    expect(block).toContain('01-08')
    expect(block).toContain('07-08')
    expect(block).not.toContain('31-07')
  })

  it('drops workouts that are not scored', () => {
    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'pending', scoreState: 'PENDING_SCORE' }),
      makeWorkout({ workoutId: 'unscorable', date: '2026-08-05', scoreState: 'UNSCORABLE' }),
    ], [], TODAY)

    expect(block).toBeNull()
  })

  it('marks an associated session and an unassociated workout differently', () => {
    const block = formatWhoopWorkoutBlock(
      [
        makeWorkout({ workoutId: 'matched' }),
        makeWorkout({ workoutId: 'loose', date: '2026-08-05' }),
      ],
      [makeSession('matched')],
      TODAY,
    )

    expect(block).toContain('sesion planificada: Running Z2 60 min')
    expect(block).toContain('sin sesion asociada')
  })

  it('renders the objective metrics reusing the shared module', () => {
    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'rich', strain: 11.2, avgHr: 148, maxHr: 172, distanceM: 5000 }),
    ], [], TODAY)

    expect(block).toContain('30 min')
    expect(block).toContain('strain 11.2')
    expect(block).toContain('FC 148/172')
    expect(block).toContain('5,0 km')
    expect(block).toContain('6:00/km')
  })

  it('rounds fractional workout and planned-session durations', () => {
    const session = makeSession('fractional')
    session.durationMin = 59.6

    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'fractional', durationMin: 47.833333333333336 }),
    ], [session], TODAY)!

    expect(block).toContain('48 min')
    expect(block).toContain('Running Z2 60 min')
    expect(block).not.toContain('47.833333333333336')
  })

  it('caps detailed lines at 8 and summarizes the overflow before them', () => {
    // 10 workouts del mismo día, cada uno con una duración distinta para poder
    // identificarlos en el texto renderizado: 10, 11, ... 19 min.
    const workouts = Array.from({ length: 10 }, (_, index) =>
      makeWorkout({
        workoutId: `w${index}`,
        date: '2026-08-04',
        startAt: `2026-08-04T${String(index + 6).padStart(2, '0')}:00:00.000Z`,
        endAt: `2026-08-04T${String(index + 6).padStart(2, '0')}:30:00.000Z`,
        durationMin: 10 + index,
      }))

    const block = formatWhoopWorkoutBlock(workouts, [], TODAY)!
    const lines = block.split('\n')

    // encabezado + desborde + 8 detalladas + guardia
    expect(lines).toHaveLength(11)
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(8)

    // El desborde va inmediatamente después del encabezado y suma los 2 más viejos.
    expect(lines[1]).toBe('+2 entrenamientos anteriores no detallados (21 min en total)')

    // Conserva los 8 más recientes (12..19 min) y descarta los 2 más viejos.
    expect(block).not.toContain('10 min')
    expect(block).not.toContain('11 min')
    expect(block).toContain('12 min')
    expect(block).toContain('19 min')
  })

  it('omits the overflow line when there is no overflow', () => {
    const block = formatWhoopWorkoutBlock([makeWorkout({ workoutId: 'only' })], [], TODAY)!
    expect(block).not.toContain('no detallados')
  })

  it('rounds a fractional overflow duration total', () => {
    const workouts = Array.from({ length: 9 }, (_, index) =>
      makeWorkout({
        workoutId: `fractional-overflow-${index}`,
        startAt: `2026-08-04T${String(index + 6).padStart(2, '0')}:00:00.000Z`,
        endAt: `2026-08-04T${String(index + 6).padStart(2, '0')}:30:00.000Z`,
        durationMin: index === 0 ? 10.4 : 30,
      }))

    const block = formatWhoopWorkoutBlock(workouts, [], TODAY)!
    expect(block).toContain('+1 entrenamientos anteriores no detallados (10 min en total)')
  })

  it('flattens newlines and truncates long session titles', () => {
    const session = makeSession('matched')
    session.title = `Sesion\ncon salto ${'x'.repeat(80)}`

    const block = formatWhoopWorkoutBlock([makeWorkout({ workoutId: 'matched' })], [session], TODAY)!
    const line = block.split('\n').find((candidate) => candidate.startsWith('- '))!

    expect(block.split('\n')).toHaveLength(3)  // encabezado + 1 detallada + guardia
    expect(line).toContain('Sesion con salto')
    expect(line).toContain('…')
    expect(line).not.toContain('\n')
  })

  it('closes with the strain guard line', () => {
    const block = formatWhoopWorkoutBlock([makeWorkout({ workoutId: 'one' })], [], TODAY)!
    expect(block.split('\n').at(-1)).toBe(
      'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta. '
      + 'Las zonas son distribucion de FC medida: no propongas objetivos por zona, '
      + 'el producto no tiene sesiones con objetivo de zona.',
    )
  })
})

describe('formatWhoopWorkoutBlock — zonas', () => {
  const ZONES = { z0: 0, z1: 0, z2: 600_000, z3: 900_000, z4: 500_000, z5: 100_000 }

  /** Mismo helper del archivo, con las métricas que el bloque debe imprimir. */
  function zoneWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
    return makeWorkout({
      workoutId: 'wz', sportName: 'squash', durationMin: 60,
      strain: 12.4, avgHr: 142, maxHr: 181, ...overrides,
    })
  }

  it('inserta la zona alta entre strain y FC', () => {
    const block = formatWhoopWorkoutBlock(
      [zoneWorkout({ zoneDurations: ZONES })], [], TODAY,
    )
    expect(block).toContain('60 min · strain 12.4 · 10 min zona alta · FC 142/181')
  })

  it('un entrenamiento sin zonas produce exactamente la línea de la Entrega 2', () => {
    const block = formatWhoopWorkoutBlock([zoneWorkout()], [], TODAY)
    expect(block).toContain('60 min · strain 12.4 · FC 142/181')
    expect(block).not.toContain('zona alta')
    expect(block).not.toContain('cobertura')
  })

  it('usa punto decimal, igual que strain', () => {
    const block = formatWhoopWorkoutBlock(
      [zoneWorkout({ zoneDurations: ZONES, percentRecorded: 72.45 })], [], TODAY,
    )
    expect(block).toContain('· cobertura 72.4%')
    expect(block).not.toContain('72,4')
  })

  it.each([
    [100], [92.4],
  ])('no menciona la cobertura cuando es %s', (percentRecorded) => {
    const block = formatWhoopWorkoutBlock(
      [zoneWorkout({ zoneDurations: ZONES, percentRecorded })], [], TODAY,
    )
    expect(block).not.toContain('cobertura')
  })

  it('dice «cobertura ?» solo con zonas y sin porcentaje', () => {
    const withZones = formatWhoopWorkoutBlock(
      [zoneWorkout({ zoneDurations: ZONES })], [], TODAY,
    )
    expect(withZones).toContain('· cobertura ?')

    // Sin zonas NO aparece, aunque falte el porcentaje: es el caso de todo
    // entrenamiento anterior al flag.
    const withoutZones = formatWhoopWorkoutBlock([zoneWorkout()], [], TODAY)
    expect(withoutZones).not.toContain('cobertura ?')
  })

  it('la guardia prohíbe proponer objetivos por zona', () => {
    const block = formatWhoopWorkoutBlock(
      [zoneWorkout({ zoneDurations: ZONES })], [], TODAY,
    )
    expect(block).toContain('no propongas objetivos por zona')
  })
})
