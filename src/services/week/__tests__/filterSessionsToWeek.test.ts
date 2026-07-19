import { afterEach, describe, expect, it } from 'vitest'

import type { CoachSessionProposal } from '../../../types'
import { filterSessionsToWeek } from '../shared'

function proposals(...dates: string[]): CoachSessionProposal[] {
  return dates.map((date) => ({ date })) as CoachSessionProposal[]
}

describe('filterSessionsToWeek', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('keeps the seven days of the week and nothing else', () => {
    process.env.TZ = 'UTC'
    const kept = filterSessionsToWeek(
      proposals('2026-08-30', '2026-08-31', '2026-09-06', '2026-09-07'),
      '2026-08-31',
    )
    expect(kept.map((session) => session.date)).toEqual(['2026-08-31', '2026-09-06'])
  })

  // Santiago adelanta el reloj el 2026-09-06, dentro de esta semana. Sumar
  // 7*24h fijos al lunes dejaba la ventana una hora corta, así que el lunes
  // siguiente caía dentro y la semana pasaba a tener ocho días.
  it('no absorbe el lunes siguiente cuando la semana cruza el cambio de hora', () => {
    process.env.TZ = 'America/Santiago'
    const kept = filterSessionsToWeek(
      proposals('2026-08-31', '2026-09-06', '2026-09-07'),
      '2026-08-31',
    )
    expect(kept.map((session) => session.date)).toEqual(['2026-08-31', '2026-09-06'])
  })

  it('conserva la semana completa cuando el reloj se atrasa', () => {
    process.env.TZ = 'America/Santiago'
    // Santiago atrasa el reloj el 2026-04-04, dentro de esta semana.
    const kept = filterSessionsToWeek(
      proposals('2026-03-30', '2026-04-05', '2026-04-06'),
      '2026-03-30',
    )
    expect(kept.map((session) => session.date)).toEqual(['2026-03-30', '2026-04-05'])
  })

  it('descarta fechas mal formadas', () => {
    process.env.TZ = 'UTC'
    const kept = filterSessionsToWeek(proposals('2026-08-31', 'no-es-fecha'), '2026-08-31')
    expect(kept.map((session) => session.date)).toEqual(['2026-08-31'])
  })
})
