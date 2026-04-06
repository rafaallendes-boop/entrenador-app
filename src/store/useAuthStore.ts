import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../services/auth'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

export interface SyncDetails {
  pendingOps: number
  lastSyncAt: number | null
  lastSuccessfulSyncAt: number | null
  lastRecoveredSyncAt: number | null
  lastErrorAt: number | null
  lastErrorMessage: string | null
}

interface AuthState {
  user: User | null
  isLoading: boolean
  syncStatus: SyncStatus
  syncError: string | null
  syncDetails: SyncDetails

  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  setSyncStatus: (status: SyncStatus, error?: string) => void
  setSyncDetails: (patch: Partial<SyncDetails>) => void
}

export const useAuthStore = create<AuthState>((set) => {
  // Subscribe to Supabase auth state changes on store creation
  supabase.auth.getSession().then(({ data }) => {
    set({ user: data.session?.user ?? null, isLoading: false })
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    set({ user: session?.user ?? null, isLoading: false })
  })

  return {
    user: null,
    isLoading: true,
    syncStatus: 'idle',
    syncError: null,
    syncDetails: {
      pendingOps: 0,
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      lastRecoveredSyncAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    },

    signInWithGoogle: async () => {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
    },

    signOut: async () => {
      await supabase.auth.signOut()
      set({
        user: null,
        syncStatus: 'idle',
        syncError: null,
        syncDetails: {
          pendingOps: 0,
          lastSyncAt: null,
          lastSuccessfulSyncAt: null,
          lastRecoveredSyncAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
        },
      })
    },

    setSyncStatus: (status, error) => {
      set({ syncStatus: status, syncError: error ?? null })
    },

    setSyncDetails: (patch) => {
      set((state) => ({
        syncDetails: {
          ...state.syncDetails,
          ...patch,
        },
      }))
    },
  }
})
