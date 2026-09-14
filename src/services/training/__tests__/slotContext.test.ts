import { describe, expect, it } from 'vitest'
import type { DayLog, Session } from '../../../types'
import { captureSources, compareSlots, deriveSlotContext, shiftIsoDate } from '../slotContext'

const scope = { athleteId: 'ath_a', epoch: 1, requestId: 'req-1' }
const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026, hora local

function session(id: string, date: string, timeBlock: Session['timeBlock'] | undefined, status: Session['status'], extra: Partial<Session> = {}): Session {
  return { id, date, weekStartDate: date, timeBlock, type: 'strength', status, title: id, durationMin: 60, createdAt: 0, updatedAt: 0, ...extra } as Session
}
function log(id: string, date: string, extra: Partial<DayLog> = {}): DayLog {
  return { id, date, updatedAt: 0, ...extra }
}
function capture(sessions: Session[], dayLogs: DayLog[] = []) {
  return captureSources({ scope, now: NOW, profile: { id: 'ath_a', updatedAt: 7 }, sessions, dayLogs })
}

describe('captureSources', () => {
  it('fija corte, fecha local y revisión del perfil, y es inmune a mutaciones posteriores', () => {
    const input = [session('a', '2026-09-14', 'AM', 'completed')]
    const result = capture(input)
    input.push(session('b', '2026-09-15', 'AM', 'completed'))
    expect(result.sessions.map(s => s.id)).toEqual(['a'])
    expect(result.knowledgeCutoff).toBe(new Date(NOW).toISOString())
    expect(result.knowledgeDate).toBe('2026-09-16')
    expect(result.profileRevision).toBe(7)
    expect(Object.isFrozen(result.sessions)).toBe(true)
  })

  it('aísla y congela registros y objetos anidados sin congelar la fuente', () => {
    const profile = { id: 'a', updatedAt: 0, strengthProfile: { squat1RM: 100 } }
    const row = session('a', '2026-09-14', 'AM', 'completed')
    row.actualRpe = 6
    const day = log('l', '2026-09-14')
    day.painLevel = 2
    const result = captureSources({ scope, now: NOW, profile, sessions: [row], dayLogs: [day] })
    profile.strengthProfile.squat1RM = 200
    row.actualRpe = 10
    day.painLevel = 9
    expect(result.profile?.strengthProfile?.squat1RM).toBe(100)
    expect(result.sessions[0].actualRpe).toBe(6)
    expect(result.dayLogs[0].painLevel).toBe(2)
    expect(Object.isFrozen(profile.strengthProfile)).toBe(false)
    expect(Object.isFrozen(result.profile?.strengthProfile)).toBe(true)
    expect(Object.isFrozen(result.sessions[0])).toBe(true)
    expect(Object.isFrozen(result.dayLogs[0])).toBe(true)
  })

  it('deduplica por id conservando la última aparición', () => {
    const result = capture([session('a', '2026-09-14', 'AM', 'planned'), session('a', '2026-09-14', 'AM', 'completed')])
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].status).toBe('completed')
  })
})

describe('deriveSlotContext', () => {
  it('historial de progresión: sólo ejecutadas estrictamente antes del slot (F11)', () => {
    const ctx = deriveSlotContext(capture([
      session('before', '2026-09-07', 'AM', 'completed'),
      session('adjusted', '2026-09-08', 'PM', 'adjusted'),
      session('skipped', '2026-09-09', 'AM', 'skipped'),
      session('planned-before', '2026-09-10', 'AM', 'planned'),
      session('same-slot', '2026-09-11', 'AM', 'completed'),
      session('after', '2026-09-15', 'AM', 'completed'),
    ]), { date: '2026-09-11', timeBlock: 'AM' })
    expect(ctx.progressionHistory.map(s => s.id)).toEqual(['adjusted', 'before'])
    expect(ctx.signalHistory.map(s => s.id)).toEqual(['planned-before', 'skipped', 'adjusted', 'before'])
  })

  it('AM es anterior a PM el mismo día', () => {
    const sessions = [session('morning', '2026-09-11', 'AM', 'completed')]
    expect(deriveSlotContext(capture(sessions), { date: '2026-09-11', timeBlock: 'PM' }).progressionHistory).toHaveLength(1)
    expect(deriveSlotContext(capture(sessions), { date: '2026-09-11', timeBlock: 'AM' }).progressionHistory).toHaveLength(0)
    expect(compareSlots({ date: '2026-09-11', timeBlock: 'AM' }, { date: '2026-09-11', timeBlock: 'PM' })).toBeLessThan(0)
  })

  it('exposición: excluye la sesión objetivo por identidad, no por slot', () => {
    const ctx = deriveSlotContext(capture([
      session('target', '2026-09-16', 'PM', 'planned'),
      session('same-slot-other', '2026-09-16', 'PM', 'planned'),
      session('earlier-planned', '2026-09-14', 'AM', 'planned'),
      session('next-week', '2026-09-21', 'AM', 'planned'),
    ]), { date: '2026-09-16', timeBlock: 'PM' }, { targetSessionId: 'target' })
    expect(ctx.exposure.map(s => s.id)).toEqual(['earlier-planned', 'same-slot-other'])
  })

  it('vecinos duros de semanas contiguas entran sólo si el consumidor los declara duros', () => {
    const sessions = [
      session('hard-prev', '2026-09-10', 'AM', 'completed', { rpe: 9 }),
      session('easy-prev', '2026-09-11', 'AM', 'completed', { rpe: 3 }),
    ]
    const ctx = deriveSlotContext(capture(sessions), { date: '2026-09-16', timeBlock: 'AM' }, {
      window: { neighborWeeks: 1, isHardNeighbor: (s) => (s.rpe ?? 0) >= 8 },
    })
    expect(ctx.exposure.map(s => s.id)).toEqual(['hard-prev'])
  })

  it('sesión legacy sin timeBlock se trata como AM y se declara', () => {
    const ctx = deriveSlotContext(capture([session('legacy', '2026-09-11', undefined, 'completed')]), { date: '2026-09-11', timeBlock: 'PM' })
    expect(ctx.progressionHistory.map(s => s.id)).toEqual(['legacy'])
    expect(ctx.legacySlotSessionIds).toEqual(['legacy'])
  })

  it('day logs hasta la fecha del slot inclusive, más reciente primero', () => {
    const ctx = deriveSlotContext(capture([], [log('l1', '2026-09-14'), log('l3', '2026-09-17'), log('l2', '2026-09-16')]), { date: '2026-09-16', timeBlock: 'AM' })
    expect(ctx.dayLogs.map(l => l.id)).toEqual(['l2', 'l1'])
  })

  it('shiftIsoDate cruza meses sin depender de la zona horaria', () => {
    expect(shiftIsoDate('2026-09-01', -7)).toBe('2026-08-25')
  })
})
