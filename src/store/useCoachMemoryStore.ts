import { create } from 'zustand'
import { getAthleteProfile, upsertAthleteProfile } from '../db/queries'
import type { AthleteProfile } from '../types'
import * as syncService from '../services/syncService'
import { getCoachMemoryText, upsertActiveCoachNote } from '../services/athlete/coachNotes'

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
  resetForAthleteSwitch: () => void
}

let latestMemoryLoadRequestId = 0

export const useCoachMemoryStore = create<CoachMemoryState>((set) => ({
  coachMemory: '',
  athleteProfile: null,
  isSaving: false,
  hasLoaded: false,
  lastLoadedAt: null,

  resetForAthleteSwitch: () => {
    latestMemoryLoadRequestId += 1
    set({ coachMemory: '', athleteProfile: null, isSaving: false, hasLoaded: false, lastLoadedAt: null })
  },

  loadMemory: async () => {
    const requestId = ++latestMemoryLoadRequestId
    const [profile, memoryText] = await Promise.all([getAthleteProfile(), getCoachMemoryText()])
    if (requestId !== latestMemoryLoadRequestId) return
    set({ coachMemory: memoryText ?? '', athleteProfile: profile ?? null, hasLoaded: true, lastLoadedAt: Date.now() })
  },

  saveMemory: async (coachMemory) => {
    const requestId = ++latestMemoryLoadRequestId
    set({ isSaving: true })
    try {
      if (!syncService.canWriteAthleteProfileLocally('automatic')) {
        set({ isSaving: false })
        return
      }
      const note = await upsertActiveCoachNote(coachMemory)
      if (note) void syncService.pushCoachNote(note)
      // Un switch de atleta (resetForAthleteSwitch) bumpea el token: descartar el
      // write de estado para no re-contaminar con el perfil del atleta anterior.
      if (requestId !== latestMemoryLoadRequestId) return
      set({ coachMemory: note?.coachMemory ?? '', isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
    } catch (error) {
      if (requestId === latestMemoryLoadRequestId) set({ isSaving: false })
      throw error
    }
  },

  saveAthleteProfile: async (patch, options) => {
    const requestId = ++latestMemoryLoadRequestId
    set({ isSaving: true })
    try {
      const source = options?.source ?? 'automatic'
      if (!syncService.canWriteAthleteProfileLocally(source)) {
        set({ isSaving: false })
        return
      }
      const profile = await upsertAthleteProfile(patch)
      void syncService.pushAthleteProfile(profile, { source })
      // Un switch de atleta (resetForAthleteSwitch) bumpea el token: descartar el
      // write de estado para no re-contaminar con el perfil del atleta anterior.
      if (requestId !== latestMemoryLoadRequestId) return
      set({ athleteProfile: profile, isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
    } catch (error) {
      if (requestId === latestMemoryLoadRequestId) set({ isSaving: false })
      throw error
    }
  },
}))
