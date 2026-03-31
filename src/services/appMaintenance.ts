import { db } from '../db/db'
import { clearStoredChatSessionId } from '../utils/chatSession'

export async function clearAllLocalAppData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.sessions, db.dayLogs, db.weekSummaries, db.chatMessages, db.coachProposals, db.athleteProfiles],
    async () => {
      await db.sessions.clear()
      await db.dayLogs.clear()
      await db.weekSummaries.clear()
      await db.chatMessages.clear()
      await db.coachProposals.clear()
      await db.athleteProfiles.clear()
    },
  )

  clearStoredChatSessionId()
}
