import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildOutputs, buildRepairContext } from './probe-selectors.mjs'
import { baseWeekProposals, RUNNING_SLOT } from './probe-selectors/cases.mjs'
import { installNetworkGuard, loadRuntime } from './probe-selectors/runtime.mjs'

let runtime
let guard
beforeAll(async () => { guard = installNetworkGuard(); runtime = await loadRuntime() })
afterAll(async () => { try { await runtime?.close() } finally { guard?.restore() } })

describe('E1: rutas reales, sin proveedor', () => {
  it('los casos E0 de chat y reparación cierran la dosis final', () => {
    const output = buildOutputs(runtime)
    for (const row of output.chat) {
      expect(row.duration.itemCount, row.name).toBeGreaterThan(0)
      expect(row.duration.deltaMin, row.name).toBeCloseTo(0)
    }
    for (const row of output.repairRunning) {
      expect(row.targetPresent, row.name).toBe(true)
      expect(row.duration.unknownBlocks, row.name).toBe(0)
      expect(row.duration.knownMin, row.name).toBeCloseTo(row.resolvedDurationMin)
      expect(row.resolvedDurationMin, row.name).toBeLessThanOrEqual(row.requestedDurationMin)
      if (row.resolvedRunningType === 'tempo' || row.resolvedRunningType === 'intervals') {
        expect(row.pace.sharedPaceWithWork, row.name).toBe(false)
        expect(JSON.stringify(row.blocks), row.name).not.toContain('55-70')
      }
    }
  })

  it('repair repetido conserva running y el total de squash, incluido tempo con perfil', () => {
    const context = buildRepairContext('partner', 'base')
    context.profile.runningProfile = { thresholdPace: '4:50', z2PaceMin: '6:00', z2PaceMax: '6:30' }
    const proposals = baseWeekProposals().filter(s => s.date !== RUNNING_SLOT.date)
    proposals.push({ ...RUNNING_SLOT, sessionType: 'running', title: 'Tempo', runningType: 'tempo', durationMin: 30, rpe: 6 })
    const first = runtime.repairGeneratedWeek(proposals, context)
    expect(first.failure).toBeUndefined()
    const second = runtime.repairGeneratedWeek(first.sessions, context)
    expect(second.failure).toBeUndefined()
    expect(second.sessions.filter(s => s.sessionType === 'running')).toEqual(first.sessions.filter(s => s.sessionType === 'running'))
    expect(second.sessions).toEqual(first.sessions)
    for (const session of second.sessions.filter(s => s.sessionType === 'squash' && s.squashDetails.sessionKind !== 'match')) {
      expect(session.squashDetails.drills.reduce((n, d) => n + d.durationMin, 0)).toBeCloseTo(session.durationMin)
    }
  })

  it('Week Creator hidrata y repara running sin perder duración ni usar ritmo umbral en entrada', async () => {
    const { hydrateWeekCreatorResponse } = await runtime.vite.ssrLoadModule('/src/services/weekCreator/WeekCreatorLocalHydrator.ts')
    const response = { message: '', actions: [{ type: 'create_week', reason: 'E1', targetDate: '2026-06-01',
      sessions: baseWeekProposals().map((s, i) => i === 1 ? { ...s, sessionType: 'running', title: 'Tempo', runningType: 'tempo', durationMin: 20 } : s) }],
    provider: 'gemini', timestamp: 0, filteredCreateWeek: false }
    const result = hydrateWeekCreatorResponse({ response, targetWeekStart: '2026-06-01',
      context: { recentSessions: [], athleteProfile: { id: 'athlete-e1', updatedAt: 0,
        sportContext: { primarySport: 'squash' }, runningProfile: { thresholdPace: '4:50', z2PaceMin: '6:00', z2PaceMax: '6:30' } } },
      config: { trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'], doubleSessionDays: [],
        sessionsPerWeek: 4, maxSessionsPerWeek: 4, sessionDurationMins: 60, allowDoubleSession: false,
        allowedSports: ['squash', 'running'], primarySport: 'squash', currentFitnessLevel: 'fit',
        currentFatigue: 'normal', fromWizard: true, configSource: 'wizard' } })
    expect(result.repairFailure).toBeUndefined()
    const running = result.response.actions?.flatMap(a => a.sessions ?? []).filter(s => s.sessionType === 'running')
    expect(running.length).toBeGreaterThan(0)
    for (const session of running) {
      expect(session.intervalStructure.blocks.reduce((n, b) => n + b.durationMin * (b.repetitions ?? 1), 0)).toBeCloseTo(session.durationMin)
      expect(session.intervalStructure.blocks[0].targetPace).not.toBe('4:40-4:50 /km')
    }
    expect(guard.attempts).toEqual([])
  })
})
