import { describe, expect, it } from 'vitest'
import { materializeRunningTemplate } from '../runningTemplateMaterializer'
import { finalizeSessionDose } from '../sessionDoseFinalizer'

describe('F04 — convertir tempo a Z2 deja tarjeta y bloques coherentes', () => {
  it('objetivos de la tarjeta y ritmos de los bloques describen la misma sesión', () => {
    const profile = { id: 'review-athlete', updatedAt: 0, sportContext: { primarySport: 'squash' as const },
      runningProfile: { z2PaceMin: '6:00', z2PaceMax: '6:30', thresholdPace: '4:50' } }
    const tempo = materializeRunningTemplate({ template: 'tempo_continuo', durationMin: 45, profile: profile.runningProfile })
    if (!tempo.ok) throw new Error(tempo.message)
    const converted = finalizeSessionDose({
      date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', title: 'Tempo', durationMin: 45,
      runningType: 'tempo', targetPaceMin: '4:50', targetPaceMax: '5:00',
      runningTemplateRef: tempo.templateRef, intervalStructure: tempo.structure,
    }, profile, { neighboringHardSession: true, phase: 'base', fatigueLevel: 4 })
    if (!converted.ok) throw new Error(converted.message)
    expect(converted.session.runningType).toBe('z2')
    expect(converted.session.targetPaceMin).toBe('6:00')
    expect(converted.session.targetPaceMax).toBe('6:30')
    const paces = converted.session.intervalStructure?.blocks.map(block => block.targetPace) ?? []
    expect(paces.length).toBeGreaterThan(0)
    for (const pace of paces) expect(['6:00 /km', '6:30 /km', undefined]).toContain(pace)
    expect(paces).not.toContain('4:50 /km')
    expect(paces).not.toContain('5:00 /km')
  })
})
