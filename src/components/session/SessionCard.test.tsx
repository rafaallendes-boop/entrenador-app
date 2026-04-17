import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../../types'
import SessionCard, { SQUASH_BLOCKS_DURATION_GUIDANCE } from './SessionCard'

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
})
