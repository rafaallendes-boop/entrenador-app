import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { Browser } from '@capacitor/browser'
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from '../services/auth'
import { rememberPendingAuthContext } from '../services/authDeepLinks'
import { isNativePlatform } from '../services/platform'
import type { SyncTierHealthMap } from '../types/syncDiagnostics'
import {
  setActiveAthleteId as setActiveAthleteHolder,
  setSelfAthleteId,
} from '../services/athlete/activeAthlete'
import { clearCoachPlanningHydrationRegistry } from '../services/athlete/coachPlanningHydrationRegistry'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'degraded'

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
  lastErrorEntity: string | null
  retryScheduledAt: number | null
  consecutiveFailures: number
  autoRepairInProgress: boolean
  lastAutoRepairAt: number | null
  awaitingProfileRecreationAfterReset: boolean
  memoryLoadRequiredAfterSyncAt: number | null
  memoryLoadedForSyncAt: number | null
  tierHealthMap: SyncTierHealthMap
}

const DEFAULT_TIER_HEALTH_MAP: SyncTierHealthMap = {
  A: 'healthy',
  B: 'healthy',
  C: 'healthy',
}

interface AuthState {
  user: User | null
  isLoading: boolean
  activeAthleteId: string | null
  syncStatus: SyncStatus
  syncError: string | null
  syncDetails: SyncDetails

  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  setActiveAthleteId: (id: string | null) => void
  setSyncStatus: (status: SyncStatus, error?: string) => void
  setSyncDetails: (patch: Partial<SyncDetails>) => void
}

let authBootstrapVersion = 0

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isLoading: isSupabaseConfigured,
    activeAthleteId: null,
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
      lastErrorEntity: null,
      retryScheduledAt: null,
      consecutiveFailures: 0,
      autoRepairInProgress: false,
      lastAutoRepairAt: null,
      awaitingProfileRecreationAfterReset: false,
      memoryLoadRequiredAfterSyncAt: null,
      memoryLoadedForSyncAt: null,
      tierHealthMap: DEFAULT_TIER_HEALTH_MAP,
    },

    signInWithGoogle: async () => {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.')
      }

      if (typeof window !== 'undefined') await rememberPendingAuthContext()

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAuthRedirectUrl(),
          skipBrowserRedirect: isNativePlatform(),
        },
      })
      if (error) throw error
      if (isNativePlatform()) {
        if (!data.url) throw new Error('Supabase no entregó una URL de autenticación.')
        await Browser.open({ url: data.url, presentationStyle: 'popover' })
      }
    },

    signOut: async () => {
      clearCoachPlanningHydrationRegistry()
      setActiveAthleteHolder(null)
      setSelfAthleteId(null)
      if (supabase) {
        await supabase.auth.signOut()
      }

      set({
        user: null,
        activeAthleteId: null,
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
          lastErrorEntity: null,
          retryScheduledAt: null,
          consecutiveFailures: 0,
          autoRepairInProgress: false,
          lastAutoRepairAt: null,
          awaitingProfileRecreationAfterReset: false,
          memoryLoadRequiredAfterSyncAt: null,
          memoryLoadedForSyncAt: null,
          tierHealthMap: DEFAULT_TIER_HEALTH_MAP,
        },
      })
    },

    setActiveAthleteId: (id) => {
      set({ activeAthleteId: id })
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
  }))

if (isSupabaseConfigured && supabase) {
  const bootstrapVersion = ++authBootstrapVersion
  void supabase.auth.getSession()
    .then(({ data }) => {
      if (bootstrapVersion !== authBootstrapVersion) return
      useAuthStore.setState({ user: data.session?.user ?? null, isLoading: false })
    })
    .catch(() => {
      if (bootstrapVersion !== authBootstrapVersion) return
      useAuthStore.setState({ user: null, isLoading: false })
    })

  supabase.auth.onAuthStateChange((_event, session) => {
    authBootstrapVersion += 1
    const nextUser = session?.user ?? null
    if (useAuthStore.getState().user?.id !== nextUser?.id) {
      clearCoachPlanningHydrationRegistry()
      setActiveAthleteHolder(null)
      setSelfAthleteId(null)
      useAuthStore.setState({ activeAthleteId: null })
    }
    useAuthStore.setState({ user: nextUser, isLoading: false })
  })
}
