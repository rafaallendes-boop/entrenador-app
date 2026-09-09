// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session, WhoopWorkout } from '../../types'
import SessionCard, { SQUASH_BLOCKS_DURATION_GUIDANCE } from './SessionCard'

afterEach(cleanup)

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: (selector: (state: { cycleSessionStatus: () => void; updateSession: () => Promise<void> }) => unknown) =>
    selector({
      cycleSessionStatus: () => undefined,
      updateSession: async () => undefined,
    }),
}))

vi.mock('../../services/trainingProtocols', () => ({
  normalizeGeneratedProtocol: () => undefined,
}))

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    date: overrides.date ?? '2026-04-09',
    timeBlock: overrides.timeBlock ?? 'AM',
    type: overrides.type ?? 'squash',
    status: overrides.status ?? 'planned',
    title: overrides.title ?? 'Sesion squash',
    durationMin: overrides.durationMin ?? 60,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  } as Session
}

describe('SessionCard exercises', () => {
  it('muestra estructura y ejercicios de recuperación al expandir la sesión', () => {
    render(<SessionCard session={makeSession({
      type: 'recovery',
      title: 'Recuperación activa',
      mobilityDetails: {
        context: 'recovery',
        focusAreas: ['espalda'],
        targetStructure: 'Respiración controlada: 3 series de 5 respiraciones',
      },
      exercises: [{ id: 'r1', name: 'Respiración controlada', sets: 3, reps: '5', completed: false }],
    })} />)
    fireEvent.click(screen.getByText('Recuperación activa'))
    expect(screen.getByText('Respiración controlada: 3 series de 5 respiraciones')).toBeTruthy()
    expect(screen.getByText('Respiración controlada')).toBeTruthy()
  })

  it('muestra ejercicios en una sesión de squash', () => {
    render(
      <SessionCard
        session={makeSession({
          type: 'squash',
          exercises: [
            {
              id: 'e1',
              name: 'Drill de pared',
              sets: 3,
              reps: '10',
              completed: false,
            },
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByText('Sesion squash'))

    expect(screen.queryByText('Drill de pared')).not.toBeNull()
  })

  it('resume ejercicios y superseries de una sesion de fuerza en la cabecera', () => {
    render(
      <SessionCard
        session={makeSession({
          type: 'strength',
          exercises: [
            { id: '1', name: 'Clean', sets: 4, reps: 3, completed: false, supersetGroup: 'g1' },
            { id: '2', name: 'Dominadas', sets: 4, reps: 8, completed: false, supersetGroup: 'g1' },
            { id: '3', name: 'Plancha frontal', sets: 3, reps: '30s', completed: false },
          ],
        })}
      />,
    )

    expect(screen.getByText('3 ejercicios · 1 superserie')).not.toBeNull()
  })

  it('usa singular cuando hay un solo ejercicio y ningun grupo', () => {
    render(
      <SessionCard
        session={makeSession({
          type: 'strength',
          exercises: [{ id: '1', name: 'Clean', sets: 4, reps: 3, completed: false }],
        })}
      />,
    )

    expect(screen.getByText('1 ejercicio')).not.toBeNull()
  })

  it('no resume ejercicios fuera de fuerza', () => {
    render(
      <SessionCard
        session={makeSession({
          type: 'squash',
          exercises: [
            { id: 'e1', name: 'Drill de pared', sets: 3, reps: '10', completed: false },
            { id: 'e2', name: 'Drill cruzado', sets: 3, reps: '10', completed: false },
          ],
        })}
      />,
    )

    expect(screen.queryByText(/\d+ ejercicios?/)).toBeNull()
  })
})

describe('SessionCard squash match badges', () => {
  it('renders a dedicated practice-match badge', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={makeSession({
          subtype: 'match',
          squashDetails: {
            trainingFocus: 'tactical',
            sessionMode: 'practice_match',
            drills: [{ name: 'Partido de entrenamiento libre a 5 games' }],
          },
        })}
      />,
    )

    expect(html).toContain('Partido entrenamiento')
    expect(html).not.toContain('>Partido<')
  })

  it('does not render the practice badge for legacy or competition matches', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={makeSession({
          subtype: 'match',
          squashDetails: {
            trainingFocus: 'tactical',
            sessionMode: 'competition_match',
            drills: [{ name: 'Partido objetivo' }],
          },
        })}
      />,
    )

    expect(html).not.toContain('Partido entrenamiento')
  })

  it('renders a dedicated competition badge for real squash matches', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={makeSession({
          subtype: 'match',
          squashDetails: {
            trainingFocus: 'tactical',
            sessionMode: 'competition_match',
            drills: [{ name: 'Partido objetivo' }],
          },
        })}
      />,
    )

    expect(html).toContain('Partido competitivo')
    expect(html).not.toContain('>Partido<')
  })

  it('renders the mixed session kind badge when squash blocks are present', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={makeSession({
          subtype: 'control',
          squashDetails: {
            trainingFocus: 'technical',
            sessionKind: 'mixed',
            sessionMode: 'drill_session',
            blocks: [
              { kind: 'shadows', durationMin: 18, drills: [{ name: 'Ghosting 4 esquinas', durationMin: 18 }] },
              { kind: 'control', durationMin: 24, drills: [{ name: '100 drops solo', durationMin: 24 }] },
            ],
            drills: [
              { name: 'Ghosting 4 esquinas', durationMin: 18 },
              { name: '100 drops solo', durationMin: 24 },
            ],
          },
        })}
      />,
    )

    expect(html).toContain('Sombras + Control')
  })

  it('renders shadow/control sessions as drills when stale metadata says practice match', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={makeSession({
          subtype: 'match',
          title: 'Squash - Sombras y Salidas',
          squashDetails: {
            trainingFocus: 'technical',
            sessionKind: 'match',
            sessionMode: 'practice_match',
            blocks: [
              { kind: 'shadows', drills: [{ name: 'Split-step y vuelta a la T' }] },
              { kind: 'control', drills: [{ name: 'Voleas en solitario' }] },
            ],
            drills: [
              { name: 'Split-step y vuelta a la T' },
              { name: 'Voleas en solitario' },
            ],
          },
        })}
      />,
    )

    expect(html).toContain('Sombras + Control')
    expect(html).not.toContain('Match-play de entrenamiento')
    expect(html).not.toContain('>Partido<')
  })

  it('uses the session total duration as the main time reference for squash details', () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={makeSession({
          objective: 'Sesion tecnica de control',
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'drill_session',
            blocks: [
              { kind: 'control', durationMin: 14, drills: [{ name: '100 paralelas de fondo', durationMin: 14 }] },
            ],
            drills: [{ name: '100 paralelas de fondo', durationMin: 14 }],
          },
        })}
      />,
    )

    expect(SQUASH_BLOCKS_DURATION_GUIDANCE).toContain('La duracion total de la sesion es la referencia principal')
    expect(html).toContain('1h')
    expect(html).not.toContain('14min')
  })

  it('shows canonical guidance for a persisted squash drill with missing notes', () => {
    render(
      <SessionCard
        session={makeSession({
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'drill_session',
            blocks: [
              { kind: 'technical', drills: [{ name: 'Volea y vuelta a la T', durationMin: 10 }] },
            ],
            drills: [{ name: 'Volea y vuelta a la T', durationMin: 10 }],
          },
        })}
      />,
    )

    fireEvent.click(screen.getByText('Sesion squash'))

    expect(screen.getByText(/unir ataque temprano con recuperación real/i)).toBeTruthy()
  })
})

describe('SessionCard Whoop badge', () => {
  it('shows the badge only while an auto-completed session remains completed', () => {
    const autoCompletion = {
      source: 'whoop_workout' as const,
      workoutId: 'w-1',
      completedAt: '2026-07-09T15:00:00.000Z',
    }
    const completed = renderToStaticMarkup(
      <SessionCard session={makeSession({ status: 'completed', autoCompletion })} />,
    )
    const reverted = renderToStaticMarkup(
      <SessionCard session={makeSession({ status: 'planned', autoCompletion })} />,
    )
    const manual = renderToStaticMarkup(
      <SessionCard session={makeSession({ status: 'completed' })} />,
    )

    expect(completed).toContain('Sincronizado Whoop')
    expect(reverted).not.toContain('Sincronizado Whoop')
    expect(manual).not.toContain('Sincronizado Whoop')
  })
})

describe('SessionCard — detalle de Whoop', () => {
  // `makeSession(overrides)` ya existe en este archivo (línea ~23).
  // `SessionAutoCompletion.completedAt` es **string**, no number (types/index.ts:448-452).
  function makeWhoopSession(): Session {
    return makeSession({
      status: 'completed',
      autoCompletion: {
        source: 'whoop_workout',
        workoutId: 'w1',
        completedAt: '2026-08-04T10:30:00.000Z',
      },
    })
  }

  const workout: WhoopWorkout = {
    id: 'whoop:athlete-1:w1',
    workoutId: 'w1',
    athleteId: 'athlete-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    strain: 11.2,
    avgHr: 148,
    maxHr: 172,
    distanceM: 5000,
    scoreState: 'SCORED',
    updatedAt: 1,
  }

  it('renders the real workout metrics when a workout is provided', () => {
    render(<SessionCard session={makeWhoopSession()} whoopWorkout={workout} />)

    expect(screen.getByText('11.2')).not.toBeNull()
    expect(screen.getByText('148 / 172 bpm')).not.toBeNull()
    expect(screen.getByText('5,00 km')).not.toBeNull()
    expect(screen.getByText('6:00 /km')).not.toBeNull()
  })

  it('renders nothing extra when no workout is provided', () => {
    render(<SessionCard session={makeWhoopSession()} />)
    expect(screen.queryByText('11.2')).toBeNull()
  })

  it('renders nothing for a manually completed session', () => {
    render(<SessionCard session={makeSession({ status: 'completed' })} whoopWorkout={workout} />)
    expect(screen.queryByText('11.2')).toBeNull()
  })

  it('renders nothing when the workout does not belong to this session', () => {
    const otherWorkout = { ...workout, workoutId: 'w-otro' }
    render(<SessionCard session={makeWhoopSession()} whoopWorkout={otherWorkout} />)
    expect(screen.queryByText('11.2')).toBeNull()
  })

  it('rounds a fractional durationMin instead of rendering raw decimals', () => {
    // `durationMin: 30` en el fixture base es un entero que no puede exponer
    // este bug. Un backup/import solo garantiza finitud (`requireFiniteNumber`
    // en dataExport.ts), no enteridad, así que una fila real puede traer esto.
    const fractionalWorkout = { ...workout, durationMin: 47.833333333333336 }
    render(<SessionCard session={makeWhoopSession()} whoopWorkout={fractionalWorkout} />)
    expect(screen.getByText('48 min')).not.toBeNull()
    expect(screen.queryByText('47.833333333333336 min')).toBeNull()
  })

  it('distinguishes the pending notice from the unscorable one', () => {
    // Un workout no SCORED nunca tiene métricas: `normalizeWorkouts` no lee
    // `score` fuera de SCORED, así que el fixture las borra todas, no solo strain.
    const unscored = {
      ...workout,
      strain: undefined,
      avgHr: undefined,
      maxHr: undefined,
      distanceM: undefined,
    }

    const { unmount } = render(
      <SessionCard
        session={makeWhoopSession()}
        whoopWorkout={{ ...unscored, scoreState: 'PENDING_SCORE' as const }}
      />,
    )
    expect(screen.getByText(/todavía no puntuó/)).not.toBeNull()
    // Solo sobrevive la duración.
    expect(screen.getByText('30 min')).not.toBeNull()
    unmount()

    render(
      <SessionCard
        session={makeWhoopSession()}
        whoopWorkout={{ ...unscored, scoreState: 'UNSCORABLE' as const }}
      />,
    )
    expect(screen.getByText(/no pudo puntuar/)).not.toBeNull()
  })
})

/** Regresión del code review del 2026-09-08 (hallazgos 12 y las tres líneas de squash). */
describe('SessionCard — estructura de running y contexto de squash', () => {
  function runningSession(blocks: unknown[]) {
    return makeSession({
      type: 'running', title: 'Running',
      runningDetails: { runningType: 'z2', intervalStructure: { blocks } },
    } as Partial<Session>)
  }

  it('un bloque continuo se lee en minutos, no en segundos', () => {
    render(<SessionCard session={runningSession([{ label: 'Trote Z2 continuo', durationMin: 30, role: 'work' }])} />)
    fireEvent.click(screen.getByText('Running'))
    expect(screen.getByText(/30 min/)).toBeTruthy()
    expect(screen.queryByText(/1800 s/)).toBeNull()
  })

  it('un bloque por repetición se lee en segundos', () => {
    render(<SessionCard session={runningSession([
      { label: 'Series', durationMin: 1, repetitions: 6, durationBasis: 'per_repetition', role: 'work' },
    ])} />)
    fireEvent.click(screen.getByText('Running'))
    expect(screen.getByText(/60 s/)).toBeTruthy()
  })

  it('una serie corta sin basis declarado también se lee en segundos', () => {
    // Caso real observado en el smoke del 2026-09-08: las repeticiones de 400 m
    // se persisten sin `durationBasis`, y a 113 s "1.9 min" no es lenguaje de
    // entrenador. El corte de 3 minutos las devuelve a segundos.
    render(<SessionCard session={runningSession([
      { label: 'Repetición 1', durationMin: 113 / 60, distanceKm: 0.4, repetitions: 1,
        durationKind: 'estimated', role: 'work' },
      { label: 'Recuperación suave', durationMin: 1.5, role: 'recovery' },
    ])} />)
    fireEvent.click(screen.getByText('Running'))
    expect(screen.getByText(/113 s/)).toBeTruthy()
    expect(screen.getByText(/90 s/)).toBeTruthy()
    expect(screen.queryByText(/1\.9 min/)).toBeNull()
  })

  it('un bloque por distancia marca las repeticiones y el tiempo estimado', () => {
    render(<SessionCard session={runningSession([
      { label: 'Series 400', distanceKm: 0.4, repetitions: 5, durationMin: 1.5,
        durationBasis: 'per_repetition', durationKind: 'estimated', role: 'work' },
    ])} />)
    fireEvent.click(screen.getByText('Running'))
    expect(screen.getByText(/5×0\.4km/)).toBeTruthy()
    expect(screen.getByText(/estimados/)).toBeTruthy()
  })

  it('el ritmo no duplica el sufijo /km', () => {
    render(<SessionCard session={runningSession([
      { label: 'Rodaje', durationMin: 30, targetPace: '6:00-6:30 /km', role: 'work' },
    ])} />)
    fireEvent.click(screen.getByText('Running'))
    expect(screen.queryByText(/\/km\/km/)).toBeNull()
    expect(screen.getByText(/6:00-6:30 \/km/)).toBeTruthy()
  })

  it('muestra objetivo y resultado técnico de squash', () => {
    render(<SessionCard session={makeSession({
      type: 'squash', title: 'Squash',
      squashDetails: {
        trainingFocus: 'technical', sessionKind: 'technical', sessionMode: 'drill_session',
        drills: [{ name: 'Tiros paralelos profundos', durationMin: 60 }],
        selectionReason: 'Elección manual',
        technicalIntent: { family: 'drive_patterns', successTarget: 80 },
        technicalResult: { attempts: 20, successes: 18 },
      },
    } as Partial<Session>)} />)
    fireEvent.click(screen.getByText('Squash'))
    expect(screen.getByText(/drive patterns/)).toBeTruthy()
    expect(screen.getByText(/80% de aciertos/)).toBeTruthy()
    expect(screen.getByText(/18\/20 aciertos/)).toBeTruthy()
    expect(screen.getByText(/Elección manual/)).toBeTruthy()
  })
})
