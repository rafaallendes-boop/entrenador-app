import { describe, it, expect } from 'vitest'
import { captureStrengthTemplateSnapshot, computeTemplateSignature } from '../strengthTemplateSnapshot'
import type { CoachSessionProposal } from '../../../types'

function session(date: string, names: string[]): CoachSessionProposal {
  return {
    date, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: names.map((name) => ({ name, sets: 3, reps: 8 })),
  } as CoachSessionProposal
}

describe('captureStrengthTemplateSnapshot', () => {
  it('la identidad del slot no usa la posición: dos listas con el mismo contenido en distinto orden dan slotKeys distintos por ocurrencia, no por posición', () => {
    const snapshot = captureStrengthTemplateSnapshot([
      session('2026-06-09', ['Sentadilla trasera', 'Press vertical', 'Press vertical']),
    ])
    expect(snapshot.slots.map((slot) => slot.slotKey)).toEqual([
      '0:back_squat:0',
      '0:overhead_press:0',
      '0:overhead_press:1',
    ])
    expect(snapshot.slots.map((slot) => slot.sessionKey)).toEqual([
      '2026-06-09|AM',
      '2026-06-09|AM',
      '2026-06-09|AM',
    ])
  })

  it('es inmutable: mutar la sesión original no altera el snapshot', () => {
    const original = session('2026-06-09', ['Sentadilla trasera'])
    const snapshot = captureStrengthTemplateSnapshot([original])
    original.exercises![0]!.name = 'Otro'
    expect(snapshot.slots[0]!.name).toBe('Sentadilla trasera')
  })
})

describe('computeTemplateSignature', () => {
  it('distingue dos templates con los mismos ids repartidos en sesiones distintas', () => {
    const juntos = captureStrengthTemplateSnapshot([
      session('2026-06-09', ['Sentadilla trasera', 'Press vertical']),
    ])
    const separados = captureStrengthTemplateSnapshot([
      session('2026-06-09', ['Sentadilla trasera']),
      session('2026-06-10', ['Press vertical']),
    ])
    expect(computeTemplateSignature(juntos)).not.toBe(computeTemplateSignature(separados))
  })

  it('es estable para la misma entrada', () => {
    const a = captureStrengthTemplateSnapshot([session('2026-06-09', ['Sentadilla trasera'])])
    const b = captureStrengthTemplateSnapshot([session('2026-06-09', ['Sentadilla trasera'])])
    expect(computeTemplateSignature(a)).toBe(computeTemplateSignature(b))
  })
})
