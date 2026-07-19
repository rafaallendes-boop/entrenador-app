import { describe, expect, it } from 'vitest'
import { sanitizeExerciseLibraryRef } from '../exerciseLibraryRef'

describe('sanitizeExerciseLibraryRef', () => {
  it('acepta refs válidos de ambas fuentes', () => {
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: 'boast_drive' }))
      .toEqual({ source: 'squash_drill', id: 'boast_drive' })
    expect(sanitizeExerciseLibraryRef({ source: 'strength_exercise', id: 'back_squat' }))
      .toEqual({ source: 'strength_exercise', id: 'back_squat' })
  })

  it('descarta source desconocido, id vacío y formas no-objeto', () => {
    expect(sanitizeExerciseLibraryRef({ source: 'running_drill', id: 'x' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: '' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: '   ' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef('squash_drill:boast')).toBeUndefined()
    expect(sanitizeExerciseLibraryRef(null)).toBeUndefined()
    expect(sanitizeExerciseLibraryRef(undefined)).toBeUndefined()
    expect(sanitizeExerciseLibraryRef([])).toBeUndefined()
  })

  it('devuelve solo source e id (descarta campos extra)', () => {
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: 'x', extra: 1 }))
      .toEqual({ source: 'squash_drill', id: 'x' })
  })
})
