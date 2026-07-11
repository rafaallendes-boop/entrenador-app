import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { ATHLETE_PROFILE_LOCAL_ID, setActiveAthleteId, setSelfAthleteId } from '../activeAthlete'
import {
  getActiveCoachNote,
  getCoachMemoryText,
  pruneCoachNotesMissingFromRemote,
  upsertActiveCoachNote,
} from '../coachNotes'

describe('coachNotes', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_1')
    setActiveAthleteId('ath_1')
  })

  it('stores one trimmed note per active athlete', async () => {
    await upsertActiveCoachNote('  nota self  ')
    setActiveAthleteId('ath_2')
    await upsertActiveCoachNote('nota managed')
    expect((await getActiveCoachNote())?.coachMemory).toBe('nota managed')
    setActiveAthleteId('ath_1')
    expect((await getActiveCoachNote())?.coachMemory).toBe('nota self')
  })

  it('dual-reads legacy profile memory without resurrecting a cleared note', async () => {
    await db.athleteProfiles.put({
      id: ATHLETE_PROFILE_LOCAL_ID, athleteId: 'ath_1', coachMemory: 'legacy', updatedAt: 1,
    })
    expect(await getCoachMemoryText()).toBe('legacy')
    await upsertActiveCoachNote(undefined)
    expect(await getCoachMemoryText()).toBeUndefined()
  })

  it('removes an old cached note that a complete RLS-filtered snapshot omits', async () => {
    await db.athleteCoachNotes.bulkPut([
      { athleteId: 'ath_1', coachMemory: 'hidden', updatedAt: 10 },
      { athleteId: 'ath_2', coachMemory: 'remote', updatedAt: 10 },
      { athleteId: 'ath_3', coachMemory: 'pending', updatedAt: 30 },
    ])

    const deleted = await pruneCoachNotesMissingFromRemote(
      ['ath_1', 'ath_2', 'ath_3'],
      ['ath_2'],
      20,
    )

    expect(deleted).toEqual(['ath_1'])
    expect(await db.athleteCoachNotes.get('ath_1')).toBeUndefined()
    expect(await db.athleteCoachNotes.get('ath_2')).toBeDefined()
    expect(await db.athleteCoachNotes.get('ath_3')).toBeDefined()
  })

  it('removes cached notes immediately when membership access is revoked', async () => {
    await db.athleteCoachNotes.put({ athleteId: 'ath_revoked', coachMemory: 'private', updatedAt: 30 })

    await pruneCoachNotesMissingFromRemote([], [], 20)

    expect(await db.athleteCoachNotes.get('ath_revoked')).toBeUndefined()
  })
})
