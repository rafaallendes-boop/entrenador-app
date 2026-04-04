import { create } from 'zustand'
import { getAthleteProfile, upsertAthleteProfile } from '../db/queries'
import type { AthleteProfile } from '../types'
import * as syncService from '../services/syncService'

interface CoachMemoryState {
  coachMemory: string
  athleteProfile: AthleteProfile | null
  isSaving: boolean
  loadMemory: () => Promise<void>
  saveMemory: (coachMemory: string) => Promise<void>
  saveAthleteProfile: (patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>) => Promise<void>
}

export const useCoachMemoryStore = create<CoachMemoryState>((set) => ({
  coachMemory: '',
  athleteProfile: null,
  isSaving: false,

  loadMemory: async () => {
    const profile = await getAthleteProfile()
    set({ coachMemory: profile?.coachMemory ?? '', athleteProfile: profile ?? null })
  },

  saveMemory: async (coachMemory) => {
    set({ isSaving: true })
    try {
      const profile = await upsertAthleteProfile({ coachMemory: coachMemory.trim() || undefined })
      void syncService.pushAthleteProfile(profile)
      set({ coachMemory: profile.coachMemory ?? '', athleteProfile: profile, isSaving: false })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },

  saveAthleteProfile: async (patch) => {
    set({ isSaving: true })
    try {
      const profile = await upsertAthleteProfile(patch)
      void syncService.pushAthleteProfile(profile)
      set({ athleteProfile: profile, coachMemory: profile.coachMemory ?? '', isSaving: false })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },
}))
