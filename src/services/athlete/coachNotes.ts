import { db } from '../../db/db'
import { getAthleteProfile } from '../../db/queries'
import type { AthleteCoachNote } from '../../types'
import { getActiveAthleteId } from './activeAthlete'

export async function getActiveCoachNote(): Promise<AthleteCoachNote | undefined> {
  const athleteId = getActiveAthleteId()
  return athleteId ? db.athleteCoachNotes.get(athleteId) : undefined
}

export async function upsertActiveCoachNote(coachMemory: string | undefined): Promise<AthleteCoachNote | null> {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return null
  const note: AthleteCoachNote = {
    athleteId,
    coachMemory: coachMemory?.trim() || undefined,
    updatedAt: Date.now(),
  }
  await db.athleteCoachNotes.put(note)
  return note
}

export async function getCoachMemoryText(): Promise<string | undefined> {
  const note = await getActiveCoachNote()
  if (note) return note.coachMemory || undefined
  return (await getAthleteProfile())?.coachMemory || undefined
}

/**
 * Reconcile a complete remote snapshot. Missing rows are deletions or notes the
 * current membership can no longer read through RLS. The sync cutoff protects
 * newer local edits that have not been acknowledged remotely yet.
 */
export async function pruneCoachNotesMissingFromRemote(
  membershipAthleteIds: string[],
  remoteAthleteIds: string[],
  deleteBeforeTs: number,
): Promise<string[]> {
  const memberships = new Set(membershipAthleteIds)
  const remote = new Set(remoteAthleteIds)
  const localNotes = await db.athleteCoachNotes.toArray()
  const deleted: string[] = []

  for (const note of localNotes) {
    const accessWasRemoved = !memberships.has(note.athleteId)
    const missingFromCompleteSnapshot = !remote.has(note.athleteId) && note.updatedAt <= deleteBeforeTs
    if (!accessWasRemoved && !missingFromCompleteSnapshot) continue
    await db.athleteCoachNotes.delete(note.athleteId)
    deleted.push(note.athleteId)
  }

  return deleted
}
