import { describe, expect, it } from 'vitest'
import { hydrateSquashSession } from '../squashSessionHydrator'
import { materializeRunningSession } from '../runningSessionMaterializer'
import { sumTimedBlocks } from '../sessionTimeBudget'
import { doseSquashSession } from '../squashSessionDose'
import { finalizeSessionDose } from '../sessionDoseFinalizer'

describe('E1: presupuesto de sesión', () => {
  it.each([20, 30, 45, 60])('squash respeta %i minutos incluidos los descansos', durationMin => {
    const result = hydrateSquashSession({ kind: 'technical', durationMin, phase: 'build', fatigueLevel: 4,
      goal: 'mejorar squash', recentDrills: [], competitionSoon: false, partnerAvailability: 'partner' })
    expect(result.details.drills.reduce((n, d) => n + (d.durationMin ?? 0), 0)).toBe(durationMin)
    expect(result.details.blocks?.flatMap(b => b.drills)).toEqual(result.details.drills)
    expect(result.details.drills[0].notes).toContain('Calentamiento')
  })

  it.each([20, 30, 45, 60])('running computable en %i minutos', durationMin => {
    for (const runningType of ['z2', 'tempo', 'intervals', 'long'] as const) {
      const result = materializeRunningSession({ runningType, durationMin })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(sumTimedBlocks(result.structure.blocks)).toBe(durationMin * 60)
      expect(result.structure.blocks.every(b => !b.distanceKm && !b.targetPace && !b.targetHrMax)).toBe(true)
      if (runningType === 'intervals') {
        expect(result.structure.blocks.filter(b => b.label.startsWith('Recuperación')).length).toBeGreaterThan(0)
        expect(result.structure.blocks.at(-2)?.label).toContain('Serie')
      }
    }
  })

  it('no copia el umbral en entrada/cierre y no inyecta notas de otra plantilla', () => {
    const result = materializeRunningSession({ runningType: 'tempo', durationMin: 30,
      profile: { thresholdPace: '4:50', easyPaceMin: '6:00', easyPaceMax: '6:30' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.structure.blocks[0].targetPace).toBe('6:00-6:30 /km')
    expect(result.structure.blocks[1].targetPace).toBe('4:40-4:50 /km')
    expect(JSON.stringify(result.structure)).not.toContain('55-70')
  })

  it('una distancia sin tiempo es desconocida; nunca cero', () => {
    expect(sumTimedBlocks([{ distanceKm: 0.4, repetitions: 4 }])).toBeNull()
    expect(sumTimedBlocks([{ durationMin: -1 }])).toBeNull()
    expect(sumTimedBlocks([{ durationMin: 2, repetitions: 3 }, { durationMin: 1, repetitions: 2 }])).toBe(480)
  })

  it('no comprime un tempo bajo el mínimo ni inventa un perfil desde un ritmo inválido', () => {
    expect(materializeRunningSession({ runningType: 'tempo', durationMin: 15 }).ok).toBe(false)
    const result = materializeRunningSession({ runningType: 'tempo', durationMin: 20, profile: { thresholdPace: 'foo' } })
    if (!result.ok) throw new Error('duración factible')
    expect(result.structure.blocks[1].targetPace).toBeUndefined()
  })

  it('dosifica squash de forma idempotente y rechaza entradas imposibles', () => {
    const details = { trainingFocus: 'technical' as const, sessionKind: 'technical' as const,
      drills: [{ name: 'Paralela', durationMin: 52, notes: 'Mantener profundidad.' }] }
    const first = doseSquashSession(details, 20)
    if (!first.ok) throw new Error('composición factible')
    expect(doseSquashSession(first.details, 20)).toEqual(first)
    expect(doseSquashSession(details, 5).ok).toBe(false)
    expect(doseSquashSession(details, NaN).ok).toBe(false)
  })

  it('no acepta descansos textuales ni bloques provistos fuera del presupuesto', () => {
    const session = { date: '2026-06-01', timeBlock: 'AM' as const, sessionType: 'running' as const,
      title: 'Series', runningType: 'intervals' as const, durationMin: 20 }
    expect(finalizeSessionDose({ ...session, intervalStructure: { blocks: [
      { label: 'Series', repetitions: 5, durationMin: 4, notes: 'Recupera 2 minutos entre series.' },
    ] } }).ok).toBe(false)
    expect(finalizeSessionDose({ ...session, intervalStructure: { blocks: [{ label: 'Trabajo', durationMin: 25 }] } }).ok).toBe(false)
  })
})
