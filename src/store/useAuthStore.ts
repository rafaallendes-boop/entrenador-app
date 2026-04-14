import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from '../services/auth'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

export interface SyncDetails {
  pendingOps: number
  syncAttemptInFlight: boolean
  pendingUpserts: number
  pendingDeletes: number
  oldestPendingOpAt: number | null
  pendingTables: string[]
  lastSyncAt: number | null
  lastSuccessfulSyncAt: number | null
  lastRecoveredSyncAt: number | null
  lastErrorAt: number | null
  lastErrorMessage: string | null
  lastErrorCategory: string | null
  lastBlockedTable: string | null
  retryScheduledAt: number | null
  consecutiveFailures: number
  autoRepairInProgress: boolean
  lastAutoRepairAt: number | null
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
  if (isSupabaseConfigured && supabase) {
    // Subscribe to Supabase auth state changes on store creation
    supabase.auth.getSession().then(({ data }) => {
      set({ user: data.session?.user ?? null, isLoading: false })
    })

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, isLoading: false })
    })
  }

  return {
    user: null,
    isLoading: isSupabaseConfigured,
    syncStatus: 'idle',
    syncError: null,
    syncDetails: {
      pendingOps: 0,
      syncAttemptInFlight: false,
      pendingUpserts: 0,
      pendingDeletes: 0,
      oldestPendingOpAt: null,
      pendingTables: [],
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      lastRecoveredSyncAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      lastErrorCategory: null,
      lastBlockedTable: null,
      retryScheduledAt: null,
      consecutiveFailures: 0,
      autoRepairInProgress: false,
      lastAutoRepairAt: null,
    },

    signInWithGoogle: async () => {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.')
      }

      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getAuthRedirectUrl() },
      })
    },

    signOut: async () => {
      if (supabase) {
        await supabase.auth.signOut()
      }

      set({
        user: null,
        syncStatus: 'idle',
        syncError: null,
        syncDetails: {
          pendingOps: 0,
          syncAttemptInFlight: false,
          pendingUpserts: 0,
          pendingDeletes: 0,
          oldestPendingOpAt: null,
          pendingTables: [],
          lastSyncAt: null,
          lastSuccessfulSyncAt: null,
          lastRecoveredSyncAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          lastErrorCategory: null,
          lastBlockedTable: null,
          retryScheduledAt: null,
          consecutiveFailures: 0,
          autoRepairInProgress: false,
          lastAutoRepairAt: null,
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
