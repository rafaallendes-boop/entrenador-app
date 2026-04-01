import { db } from '../db/db'
import { useChatStore } from '../store/useChatStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { clearStoredChatSessionId, getOrCreateChatSessionId } from '../utils/chatSession'

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
    useCoachMemoryStore.setState({ coachMemory: '', isSaving: false })
  }
}
