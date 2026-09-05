import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestAssistantDraft } from '../requestAssistantDraft'
import { CoachEngine } from '../../ai/CoachEngine'
import type { TriageSignal } from '../../athlete/coachRosterTriage'

const SIGNALS: TriageSignal[] = [{ kind: 'no-check-in', days: 4 }]

afterEach(() => { vi.restoreAllMocks() })

describe('el Asistente propone su atleta explícito', () => {
  it('pasa targetAthleteId a extractRaw', async () => {
    const spy = vi.spyOn(CoachEngine, 'extractRaw').mockResolvedValue('{"body":"ok"}')

    await requestAssistantDraft('ath_m_1', SIGNALS)

    expect(spy.mock.calls[0]?.[2]).toMatchObject({ targetAthleteId: 'ath_m_1' })
  })
})
