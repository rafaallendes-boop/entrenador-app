import { db } from '../db/db'
import { useChatStore } from '../store/useChatStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { clearStoredChatSessionId, getOrCreateChatSessionId } from '../utils/chatSession'
import { currentWeekStartISO, fromISO, toISO } from '../utils/date'
import { addDays } from 'date-fns'
import type { Session } from '../types'

export type LocalDataGroup =
  | 'trainingData'
  | 'chatHistory'
  | 'coachProposals'
  | 'coachMemory'

export type LocalDataSelection = Partial<Record<LocalDataGroup, boolean>>

export interface LocalDataCounts {
  trainingData: {
    sessions: number
    dayLogs: number
    weekSummaries: number
  }
  chatHistory: number
  coachProposals: number
  coachMemory: number
}

export async function getRecentCoachSessions(weeks: 1 | 2 | 3 | 4 = 4): Promise<Session[]> {
  const currentWeekStart = currentWeekStartISO()
  const start = toISO(addDays(fromISO(currentWeekStart), -(weeks - 1) * 7))
  const end = toISO(addDays(fromISO(currentWeekStart), 6))

  const sessions = await db.sessions.where('date').between(start, end, true, true).toArray()
  return sessions
    .filter((session) => session.source === 'coach')
    .sort((a, b) => b.date.localeCompare(a.date) || a.timeBlock.localeCompare(b.timeBlock))
}

export async function deleteCoachSessionsByIds(ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (uniqueIds.length === 0) return 0

  const trainingStore = useTrainingStore.getState()
  let deleted = 0

  for (const id of uniqueIds) {
    const session = await db.sessions.get(id)
    if (!session || session.source !== 'coach') continue
    await trainingStore.deleteSession(id)
    deleted += 1
  }

  return deleted
}

export async function getLocalDataCounts(): Promise<LocalDataCounts> {
  const [sessions, dayLogs, weekSummaries, chatHistory, coachProposals, coachMemory] = await Promise.all([
    db.sessions.count(),
    db.dayLogs.count(),
    db.weekSummaries.count(),
    db.chatMessages.count(),
    db.coachProposals.count(),
    db.athleteProfiles.count(),
  ])

  return {
    trainingData: { sessions, dayLogs, weekSummaries },
    chatHistory,
    coachProposals,
    coachMemory,
  }
}

export async function clearSelectedLocalAppData(selection: LocalDataSelection): Promise<LocalDataGroup[]> {
  const groups = (Object.entries(selection) as Array<[LocalDataGroup, boolean | undefined]>)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([group]) => group)

  if (groups.length === 0) return []

  await db.transaction(
    'rw',
    [db.sessions, db.dayLogs, db.weekSummaries, db.chatMessages, db.coachProposals, db.athleteProfiles],
    async () => {
      if (selection.trainingData) {
        await db.sessions.clear()
        await db.dayLogs.clear()
        await db.weekSummaries.clear()
      }
      if (selection.chatHistory) {
        await db.chatMessages.clear()
      }
      if (selection.coachProposals) {
        await db.coachProposals.clear()
      }
      if (selection.coachMemory) {
        await db.athleteProfiles.clear()
      }
    },
  )

  syncStoresAfterClear(selection)
  return groups
}

export async function clearAllLocalAppData(): Promise<void> {
  await clearSelectedLocalAppData({
    trainingData: true,
    chatHistory: true,
    coachProposals: true,
    coachMemory: true,
  })
}

function syncStoresAfterClear(selection: LocalDataSelection): void {
  if (selection.trainingData) {
    useTrainingStore.setState({
      sessions: [],
      dayLogs: {},
      currentWeekSummary: null,
      allWeekSummaries: [],
      isLoading: false,
      loadedWeekStart: null,
    })
  }

  if (selection.chatHistory) {
    clearStoredChatSessionId()
    const nextSessionId = getOrCreateChatSessionId()
    useChatStore.setState({
      messages: [],
      currentSessionId: nextSessionId,
      isLoading: false,
      streamingText: '',
      error: null,
    })
  }

  if (selection.coachProposals) {
    useCoachActionsStore.setState({ proposals: [] })
  }

  if (selection.coachMemory) {
    useCoachMemoryStore.setState({ coachMemory: '', athleteProfile: null, isSaving: false, hasLoaded: true })
  }
}
