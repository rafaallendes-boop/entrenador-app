import { create } from 'zustand'
import { getAthleteProfile, upsertAthleteProfile } from '../db/queries'
import type { AthleteProfile } from '../types'
import * as syncService from '../services/syncService'

interface CoachMemoryState {
  coachMemory: string
  athleteProfile: AthleteProfile | null
  isSaving: boolean
  hasLoaded: boolean
  loadMemory: () => Promise<void>
  saveMemory: (coachMemory: string) => Promise<void>
  saveAthleteProfile: (patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>) => Promise<void>
}

let latestMemoryLoadRequestId = 0

export const useCoachMemoryStore = create<CoachMemoryState>((set) => ({
  coachMemory: '',
  athleteProfile: null,
  isSaving: false,
  hasLoaded: false,

  loadMemory: async () => {
    const requestId = ++latestMemoryLoadRequestId
    const profile = await getAthleteProfile()
    if (requestId !== latestMemoryLoadRequestId) return
    set({ coachMemory: profile?.coachMemory ?? '', athleteProfile: profile ?? null, hasLoaded: true })
  },

  saveMemory: async (coachMemory) => {
    latestMemoryLoadRequestId += 1
    set({ isSaving: true })
    try {
      const profile = await upsertAthleteProfile({ coachMemory: coachMemory.trim() || undefined })
      void syncService.pushAthleteProfile(profile)
      set({ coachMemory: profile.coachMemory ?? '', athleteProfile: profile, isSaving: false, hasLoaded: true })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },

  saveAthleteProfile: async (patch) => {
    latestMemoryLoadRequestId += 1
    set({ isSaving: true })
    try {
      const profile = await upsertAthleteProfile(patch)
      void syncService.pushAthleteProfile(profile)
      set({ athleteProfile: profile, coachMemory: profile.coachMemory ?? '', isSaving: false, hasLoaded: true })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },
}))
