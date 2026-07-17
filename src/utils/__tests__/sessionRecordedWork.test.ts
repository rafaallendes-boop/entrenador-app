import { describe, expect, it } from 'vitest'
import type { Session } from '../../types'
import { hasRecordedWork } from '../sessionRecordedWork'

const base = {
  id: 's', date: '2026-07-14', timeBlock: 'AM', type: 'squash', status: 'planned',
  title: 'S', durationMin: 60, createdAt: 1, updatedAt: 1,
} as Session

describe('hasRecordedWork', () => {
  it('devuelve false para una sesión planificada limpia', () => {
    expect(hasRecordedWork(base)).toBe(false)
  })

  it('detecta status completed y adjusted', () => {
    expect(hasRecordedWork({ ...base, status: 'completed' })).toBe(true)
    expect(hasRecordedWork({ ...base, status: 'adjusted' })).toBe(true)
  })

  it('considera valores cero como trabajo registrado', () => {
    expect(hasRecordedWork({ ...base, actualDurationMin: 0 })).toBe(true)
    expect(hasRecordedWork({ ...base, actualRpe: 0 })).toBe(true)
  })

  it('detecta señales individuales y descarta notas vacías', () => {
    expect(hasRecordedWork({ ...base, completedAt: 1 })).toBe(true)
    expect(hasRecordedWork({
      ...base, sessionFeedback: { rating: 3, energyDuringSession: 3, capturedAt: 1 },
    })).toBe(true)
    expect(hasRecordedWork({ ...base, completionNotes: 'hecho' })).toBe(true)
    expect(hasRecordedWork({ ...base, completionNotes: '  ' })).toBe(false)
    expect(hasRecordedWork({
      ...base, autoCompletion: { source: 'whoop_workout', workoutId: 'w', completedAt: 'x' },
    })).toBe(true)
  })

  it('detecta ejercicios completados', () => {
    expect(hasRecordedWork({
      ...base, exercises: [{ id: 'e', name: 'x', sets: 3, reps: '10', completed: true }],
    })).toBe(true)
    expect(hasRecordedWork({
      ...base, exercises: [{ id: 'e', name: 'x', sets: 3, reps: '10', completed: false }],
    })).toBe(false)
  })
})
