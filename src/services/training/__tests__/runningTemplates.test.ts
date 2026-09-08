import { describe, expect, it } from 'vitest'
import { RUNNING_SESSION_LIBRARY } from '../runningSessionLibrary'
import { materializeRunningTemplate } from '../runningTemplateMaterializer'
import { selectRunningSession, deriveRunningProgressionState } from '../runningSelector'
import { sumTimedBlocks } from '../sessionTimeBudget'
import { finalizeSessionDose } from '../sessionDoseFinalizer'
import { resolveRunningSupportPolicy, runningProfileWithRestrictions, hasNeighboringHardSession } from '../runningPolicy'
import type { AthleteProfile, Session } from '../../../types'

const profile = { fiveKTime: '25:00', tenKTime: '52:00', halfMarathonTime: '1:55:00', thresholdPace: '5:00', z2PaceMax: '6:30' }
const context = { fatigueLevel: 4, phase: 'base' as const, recentSessions: [], goal: '', sportProfile: 'sport_support' as const, primarySport: 'squash', referenceDate: '2026-09-07' }

describe('recetas de running y contratos de selección', () => {
  it.each(RUNNING_SESSION_LIBRARY)('$id tiene una dosis ejecutable y recuperaciones dentro del presupuesto', definition => {
    const dose = materializeRunningTemplate({ template: definition, durationMin: definition.prescription.defaultMinutes, profile })
    expect(dose.ok, definition.id).toBe(true)
    if (!dose.ok) return
    expect(sumTimedBlocks(dose.structure.blocks)).toBe(definition.prescription.defaultMinutes * 60)
    expect(dose.templateRef).toEqual({ source: 'running_template', id: definition.id, version: 1 })
    expect(dose.structure.blocks[0].role).toBe('warmup')
    expect(dose.structure.blocks.at(-1)?.role).toBe('cooldown')
    if (definition.prescription.kind === 'repeats') expect(dose.structure.blocks.some(b => b.role === 'recovery')).toBe(true)
  })

  it.each(['repeats_400', 'repeats_800', 'repeats_1k'])('%s preserva distancia y no inventa ritmo sin perfil', id => {
    expect(materializeRunningTemplate({ template: id, durationMin: 60 }).ok).toBe(false)
    const dose = materializeRunningTemplate({ template: id, durationMin: 60, profile })
    if (!dose.ok) throw Error(dose.message)
    const works = dose.structure.blocks.filter(b => b.distanceKm)
    expect(works.length).toBeGreaterThan(1)
    expect(new Set(works.map(b => b.distanceKm))).toEqual(new Set([id === 'repeats_400' ? 0.4 : id === 'repeats_800' ? 0.8 : 1]))
    expect(works.every(b => b.durationKind === 'estimated')).toBe(true)
    expect(dose.structure.blocks[0].targetPace).not.toBe(works[0].targetPace)
  })

  it('repetir Z2 permite continuidad y quince minutos nunca selecciona una hora', () => {
    for (const recentSessions of [[], ['easy_aerobic'], ['easy_aerobic', 'easy_aerobic']]) {
      const selected = selectRunningSession({ ...context, recentSessions, sessionDurationMin: 15 })
      expect(selected.session?.family).toBe('easy_aerobic')
      expect(selected.session?.durationMin).toBe(15)
      expect(sumTimedBlocks(selected.session!.intervalStructure.blocks)).toBe(900)
    }
  })

  it('no relaja restricciones cuando el pool está vacío, incluida moderate-high', () => {
    expect(selectRunningSession({ ...context, sessionDurationMin: 5 }).session).toBeNull()
    expect(selectRunningSession({ ...context, requestedRunningType: 'tempo', phase: 'peak', fatigueLevel: 8, sessionDurationMin: 45 }).session).toBeNull()
    expect(selectRunningSession({ ...context, runningProfile: { impactRestriction: 'no_running' } }).session).toBeNull()
    for (const fatigueLevel of [2, 6, 8]) {
      const result = selectRunningSession({ ...context, fatigueLevel, sessionDurationMin: 40, recentSessions: ['easy_aerobic', 'recovery'] })
      expect(['low', ...(fatigueLevel < 6 ? ['moderate'] : [])]).toContain(result.session?.intensity)
    }
  })

  it('progreso necesita ejecución medida y cambia dosis; planned y futuro no cuentan', () => {
    const history = ['2026-09-05', '2026-09-03'].map(date => ({ type: 'running', date, timeBlock: 'AM', status: 'adjusted', durationMin: 30, actualDurationMin: 30, actualRpe: 5, runningDetails: { runningType: 'z2' } })) as Session[]
    const held = selectRunningSession({ ...context, sessionDurationMin: 45, historicalSessions: history.map(s => ({ ...s, actualRpe: undefined })) })
    const progressed = selectRunningSession({ ...context, sessionDurationMin: 45, historicalSessions: history })
    expect(held.session?.durationMin).toBe(30)
    expect(progressed.session?.durationMin).toBe(31)
    expect(deriveRunningProgressionState({ ...context, historicalSessions: history.map(s => ({ ...s, status: 'planned' })) }).intent).toBe('hold')
    expect(deriveRunningProgressionState({ ...context, historicalSessions: history.map(s => ({ ...s, date: '2026-09-08' })) }).currentFamily).toBeUndefined()
  })

  it('identidad conocida gana al título traducido; edición de receta borra la referencia', () => {
    const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile })
    if (!dose.ok) throw Error(dose.message)
    const historical = { date: '2026-09-05', timeBlock: 'AM', status: 'completed', type: 'running', title: 'Título traducido', runningDetails: { runningType: 'z2', templateRef: dose.templateRef } } as Session
    expect(deriveRunningProgressionState({ ...context, historicalSessions: [historical] }).currentFamily).toBe('intervals_vo2')
    const result = finalizeSessionDose({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', title: 'Series editadas', durationMin: 60, runningType: 'intervals', runningTemplateRef: dose.templateRef, intervalStructure: { blocks: dose.structure.blocks.map(b => b.distanceKm ? { ...b, distanceKm: 0.5 } : b) } }, { runningProfile: profile } as AthleteProfile)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.runningTemplateRef).toBeUndefined()
  })

  it('preserva unidades legadas y computa recuperación aditiva sin doble contar', () => {
    expect(sumTimedBlocks([{ durationMin: 2, repetitions: 4 }])).toBe(480)
    expect(sumTimedBlocks([{ durationMin: 8, repetitions: 4, durationBasis: 'total', recoverySeconds: 60 }])).toBe(660)
  })

  it('comparte presupuesto de apoyo, vecinos y restricciones semánticas', () => {
    expect(resolveRunningSupportPolicy({ primarySport: 'squash', phase: 'taper', runningMinutesThisWeek: 65 }).durationCap).toBe(10)
    expect(resolveRunningSupportPolicy({ primarySport: 'running', phase: 'base', neighboringHardSession: true }).lowOnly).toBe(true)
    expect(hasNeighboringHardSession([{ date: '2026-09-06', type: 'squash', status: 'planned', subtype: 'competitive' }], '2026-09-07')).toBe(true)
    expect(runningProfileWithRestrictions({ recoveryProfile: { restrictions: 'Sin impacto' } } as AthleteProfile).impactRestriction).toBe('no_running')
    expect(runningProfileWithRestrictions({ recoveryProfile: { previousInjuries: 'Dolor de rodilla ya recuperado' } } as AthleteProfile).impactRestriction).toBeUndefined()
  })
})
