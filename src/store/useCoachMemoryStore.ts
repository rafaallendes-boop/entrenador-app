import { create } from 'zustand'
import { getAthleteProfile, upsertAthleteProfile } from '../db/queries'
import * as syncService from '../services/syncService'

interface CoachMemoryState {
  coachMemory: string
  isSaving: boolean
  loadMemory: () => Promise<void>
  saveMemory: (coachMemory: string) => Promise<void>
}

export const useCoachMemoryStore = create<CoachMemoryState>((set) => ({
  coachMemory: '',
  isSaving: false,

  loadMemory: async () => {
    const profile = await getAthleteProfile()
    set({ coachMemory: profile?.coachMemory ?? '' })
  },

  saveMemory: async (coachMemory) => {
    set({ isSaving: true })
    try {
      const profile = await upsertAthleteProfile({ coachMemory: coachMemory.trim() || undefined })
      void syncService.pushAthleteProfile(profile)
      set({ coachMemory: profile.coachMemory ?? '', isSaving: false })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },
}))
