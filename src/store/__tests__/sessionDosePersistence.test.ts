import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachAction, Session } from '../../types'

vi.mock('../../services/syncService', () => ({
  pushCoachProposal: vi.fn(async () => {}), pushSession: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}), pushWeekSummary: vi.fn(async () => {}),
  deleteWeekSummaries: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}),
  pullSessionsForDateRange: vi.fn(async () => {}), canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { postProcessCoachActions } from '../../services/ai/actionPostProcessor'
import { applyCreateWeek } from '../../services/planning/applyCreateWeek'
import { useCoachActionsStore } from '../useCoachActionsStore'
import { useCoachMemoryStore } from '../useCoachMemoryStore'
import { useTrainingStore } from '../useTrainingStore'
import { sumTimedBlocks } from '../../services/training/sessionTimeBudget'

describe('E1: propuesta → aceptación → Dexie', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    setSelfAthleteId('ath-e1'); setActiveAthleteId('ath-e1')
    useCoachActionsStore.setState({ proposals: [] })
    useCoachMemoryStore.getState().resetForAthleteSwitch()
    useTrainingStore.getState().resetForAthleteSwitch()
  })
  afterEach(() => {
    db.close(); setActiveAthleteId(null); setSelfAthleteId(null)
    useCoachActionsStore.setState({ proposals: [] })
    useCoachMemoryStore.getState().resetForAthleteSwitch()
    useTrainingStore.getState().resetForAthleteSwitch()
  })

  async function accept(actions: CoachAction[]) {
    await db.coachProposals.put({ id: 'e1', createdAt: 1, status: 'pending', message: 'E1', athleteId: 'ath-e1', actions })
    await useCoachActionsStore.getState().loadProposals()
    return useCoachActionsStore.getState().acceptProposal('e1')
  }

  it.each(['squash', 'running'] as const)('chat guarda %s de 20 min con protocolos incluidos', async sport => {
    const processed = postProcessCoachActions({ message: '', provider: 'gemini', timestamp: 0, filteredCreateWeek: false, requestClass: 'chat_action',
      actions: [{ type: 'add_session', targetDate: '2026-06-01', timeBlock: 'AM', sessionType: sport,
        title: sport, durationMin: 20, reason: 'E1', ...(sport === 'squash' ? { squashKind: 'technical' } : { runningType: 'z2' }) }] },
    { recentSessions: [] }, `Agrega ${sport === 'squash' ? 'squash técnico' : 'running Z2'} de 20 minutos`)
    expect(processed.actions).toHaveLength(1)
    expect((await accept(processed.actions!)).errors).toEqual([])
    const sessions = await db.sessions.toArray()
    expect(sessions).toHaveLength(1)
    const saved = sessions[0]
    expect(saved.durationMin).toBe(20)
    expect(sumTimedBlocks(sport === 'squash' ? saved.squashDetails!.drills : saved.runningDetails!.intervalStructure!.blocks)).toBe(1200)
    expect(saved.warmup?.note).toContain('Incluido')
    expect(saved.cooldown?.note).toContain('Incluido')
    expect(saved.athleteId).toBe('ath-e1')
  })

  it('la aceptación semanal verifica antes de reemplazar y conserva bloques al guardar', async () => {
    const original = { id: 'existing', athleteId: 'ath-e1', date: '2026-06-01', weekStartDate: '2026-06-01',
      timeBlock: 'AM', type: 'running', status: 'planned', title: 'Anterior', durationMin: 30, createdAt: 1, updatedAt: 1 } as Session
    await db.sessions.add(original)
    const store = { loadWeek: async () => {}, addSession: async (row: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
      const saved = { ...row, athleteId: 'ath-e1', id: 'new', createdAt: 2, updatedAt: 2 }
      await db.sessions.add(saved); return saved
    } }
    const session = { date: '2026-06-01', timeBlock: 'AM' as const, sessionType: 'running' as const,
      runningType: 'tempo' as const, title: 'Tempo', durationMin: 20 }
    await expect(applyCreateWeek({ sessions: [{ ...session,
      intervalStructure: { blocks: [{ label: 'Series', distanceKm: 0.4, repetitions: 5 }] } }], athleteProfile: null, store })).rejects.toThrow('No se puede comprobar')
    expect(await db.sessions.get('existing')).toEqual(original)
    await applyCreateWeek({ sessions: [session], athleteProfile: null, store })
    const saved = await db.sessions.get('new')
    expect(sumTimedBlocks(saved!.runningDetails!.intervalStructure!.blocks)).toBe(1200)
    expect(saved!.runningDetails!.intervalStructure!.blocks.every(b => b.targetPace == null)).toBe(true)
  })

  it('acortar vuelve a dosificar y una edición imposible no cambia Dexie', async () => {
    expect((await accept([{ type: 'add_session', reason: 'E1', sessionType: 'running', runningType: 'z2',
      title: 'Running', durationMin: 45, targetDate: '2026-06-01', timeBlock: 'AM' }])).errors).toEqual([])
    const [original] = await db.sessions.toArray()
    expect((await accept([{ type: 'shorten_session', reason: 'E1', sessionId: original.id, newDurationMin: 20 }])).errors).toEqual([])
    const shortened = await db.sessions.get(original.id)
    expect(sumTimedBlocks(shortened!.runningDetails!.intervalStructure!.blocks)).toBe(1200)
    expect(shortened!.warmup?.durationMin).toBe(5)
    expect((await accept([{ type: 'shorten_session', reason: 'E1', sessionId: original.id, newDurationMin: 5 }])).errors.length).toBeGreaterThan(0)
    expect(await db.sessions.get(original.id)).toEqual(shortened)
  })
})
