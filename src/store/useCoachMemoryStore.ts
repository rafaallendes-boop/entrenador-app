import { create } from 'zustand'
import { getAthleteProfile, upsertAthleteProfile } from '../db/queries'
import type { AthleteProfile } from '../types'
import * as syncService from '../services/syncService'

type AthleteProfileSaveOptions = {
  source?: syncService.AthleteProfileWriteSource
}

interface CoachMemoryState {
  coachMemory: string
  athleteProfile: AthleteProfile | null
  isSaving: boolean
  hasLoaded: boolean
  lastLoadedAt: number | null
  loadMemory: () => Promise<void>
  saveMemory: (coachMemory: string) => Promise<void>
  saveAthleteProfile: (
    patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>,
    options?: AthleteProfileSaveOptions,
  ) => Promise<void>
}

let latestMemoryLoadRequestId = 0

export const useCoachMemoryStore = create<CoachMemoryState>((set) => ({
  coachMemory: '',
  athleteProfile: null,
  isSaving: false,
  hasLoaded: false,
  lastLoadedAt: null,

  loadMemory: async () => {
    const requestId = ++latestMemoryLoadRequestId
    const profile = await getAthleteProfile()
    if (requestId !== latestMemoryLoadRequestId) return
    set({ coachMemory: profile?.coachMemory ?? '', athleteProfile: profile ?? null, hasLoaded: true, lastLoadedAt: Date.now() })
  },

  saveMemory: async (coachMemory) => {
    latestMemoryLoadRequestId += 1
    set({ isSaving: true })
    try {
      if (!syncService.canWriteAthleteProfileLocally('automatic')) {
        set({ isSaving: false })
        return
      }
      const profile = await upsertAthleteProfile({ coachMemory: coachMemory.trim() || undefined })
      void syncService.pushAthleteProfile(profile)
      set({ coachMemory: profile.coachMemory ?? '', athleteProfile: profile, isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },

  saveAthleteProfile: async (patch, options) => {
    latestMemoryLoadRequestId += 1
    set({ isSaving: true })
    try {
      const source = options?.source ?? 'automatic'
      if (!syncService.canWriteAthleteProfileLocally(source)) {
        set({ isSaving: false })
        return
      }
      const profile = await upsertAthleteProfile(patch)
      void syncService.pushAthleteProfile(profile, { source })
      set({ athleteProfile: profile, coachMemory: profile.coachMemory ?? '', isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },
}))
