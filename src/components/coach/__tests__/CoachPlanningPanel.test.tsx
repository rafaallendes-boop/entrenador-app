import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Athlete, Session } from '../../../types'

vi.mock('../../../services/athlete/coachScopedReads', () => ({
  getWeekSessionsForAthlete: vi.fn(),
}))

import CoachPlanningPanel from '../CoachPlanningPanel'

const SELF: Athlete = {
  id: 'ath_user-1',
  ownerAccountId: 'user-1',
  linkedAccountId: 'user-1',
  displayName: 'Rafa',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}
const MANAGED: Athlete = {
  id: 'ath_m_a',
  ownerAccountId: 'user-1',
  linkedAccountId: null,
  displayName: 'Ana',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}

function session(partial: Partial<Session>): Session {
  return {
    id: 'session',
    athleteId: 'ath_user-1',
    date: '2026-07-14',
    timeBlock: 'am',
    type: 'squash',
    status: 'planned',
    title: 'Técnica de squash',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as Session
}

function render(overrides: Partial<React.ComponentProps<typeof CoachPlanningPanel>> = {}) {
  return renderToStaticMarkup(
    <CoachPlanningPanel
      athletes={[SELF, MANAGED]}
      selfId={SELF.id}
      activeAthleteId={SELF.id}
      ownerAccountId="user-1"
      pendingAction={null}
      onTrainAs={vi.fn()}
      initialSessions={[]}
      initialPhase="ready"
      {...overrides}
    />,
  )
}

describe('CoachPlanningPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('muestra selector, navegacion semanal y sesiones con estado', () => {
    const html = render({
      initialSessions: [
        session({ id: 'planned', status: 'planned' }),
        session({ id: 'completed', status: 'completed', title: 'Partido' }),
      ],
    })

    expect(html).toContain('id="planning-athlete"')
    expect(html).toContain('aria-label="Semana anterior"')
    expect(html).toContain('aria-label="Semana siguiente"')
    expect(html).toContain('Hoy')
    expect(html).toContain('Planificada')
    expect(html).toContain('Completada')
  })

  it('sin cache y con hidratacion en curso muestra cargando, no el estado vacio', () => {
    const html = render({ initialSessions: [], initialPhase: 'loading' })
    expect(html).toContain('Cargando la semana')
    expect(html).not.toContain('no tiene sesiones')
  })

  it('una semana vacía hidratada muestra solo la grilla editable de siete días', () => {
    const html = render({ initialSessions: [], initialPhase: 'ready' })
    expect(html).not.toContain('Esta semana no tiene sesiones planificadas')
    expect(html.match(/\+ Agregar sesión/g)).toHaveLength(7)
  })

  it('conserva los datos locales y avisa discretamente si falla la hidratacion', () => {
    const html = render({
      initialSessions: [session({ id: 'cached' })],
      initialPhase: 'ready',
      initialNotice: true,
    })
    expect(html).toContain('Técnica de squash')
    expect(html).toContain('No se pudo actualizar desde el servidor')
  })

  it('sin cache muestra error y permite reintentar', () => {
    const html = render({ initialSessions: [], initialPhase: 'error' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Reintentar')
  })

  it('ofrece entrenar como el atleta seleccionado cuando no es el activo', () => {
    const html = render({ activeAthleteId: null })
    expect(html).toContain('Entrenar como este atleta')
  })
})
