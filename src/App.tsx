import { BrowserRouter, Navigate, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { addDays } from 'date-fns'
import AppShell from './components/layout/AppShell'
import AuthGate from './components/auth/AuthGate'
import ConsentGate from './components/legal/ConsentGate'
import CoachScopeGuard from './components/layout/CoachScopeGuard'
import { ROUTES } from './constants/routes'
import { useAuthStore } from './store/useAuthStore'
import {
  runFullSync,
  migrateLocalDataToCloud,
  prepareLocalDataForUser,
  hasInitialRemotePullCompleted,
  pullMemberships,
  pullSessionsForDateRange,
} from './services/syncService'
import { resolveWeekStartToRefresh, useTrainingStore } from './store/useTrainingStore'
import { useCoachMemoryStore } from './store/useCoachMemoryStore'
import { usePlanBuilderStore } from './store/usePlanBuilderStore'
import { useEntitlementStore } from './store/useEntitlementStore'
import { currentWeekStartISO, fromISO, toISO } from './utils/date'
import { db } from './db/db'
import { hasSkippedOnboarding, needsOnboarding } from './utils/onboarding'
import { isSupabaseConfigured } from './services/auth'
import { backfillLocalAthleteScope } from './services/athlete/athleteScopeMigration'
import { hydrateActiveAthlete } from './services/athlete/hydrateActiveAthlete'
import { getActiveAthleteId } from './services/athlete/activeAthlete'
import NativeBridge from './components/native/NativeBridge'
import RouteRobotsMeta from './components/seo/RouteRobotsMeta'
import { NATIVE_RESUME_EVENT } from './services/nativeApp'
import { pullWorkouts } from './services/readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from './services/readiness/autoCompleteFromWorkouts'
import { capturePendingClaimTokenFromUrl } from './services/athlete/claimGate'
import { isIOSPlatform } from './services/platform'
import {
  invalidateSessionBootstrap,
  runSessionBootstrap,
} from './services/bootstrap/sessionBootstrap'
import { roleOwnsLegacySelfData } from './services/athlete/athleteScopeKind'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const WeeklyView = lazy(() => import('./pages/WeeklyView'))
const DayDetail = lazy(() => import('./pages/DayDetail'))
const ChatCoach = lazy(() => import('./pages/ChatCoach'))
const PlanBuilderPage = lazy(() => import('./pages/PlanBuilderPage'))
const CompetitionPlanPage = lazy(() => import('./pages/CompetitionPlanPage'))
const PlanBuilderV2Page = lazy(() => import('./pages/PlanBuilderV2Page'))
const ImportPDF = lazy(() => import('./pages/ImportPDF'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const CoachWorkspacePage = lazy(() => import('./pages/CoachWorkspacePage'))
const OperationsPage = lazy(() => import('./pages/OperationsPage'))
const NativeWelcomePreviewPage = lazy(() => import('./pages/NativeWelcomePreviewPage'))
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const HealthDisclaimerPage = lazy(() => import('./pages/HealthDisclaimerPage'))
const WhoopDisclaimerPage = lazy(() => import('./pages/WhoopDisclaimerPage'))
const CoachesLandingPage = lazy(() => import('./pages/CoachesLandingPage'))

// La instalación vive en `main.tsx`, antes de `createRoot`: un efecto corre
// después del primer commit y perdería los errores de arranque.
import { captureClientError } from './services/observability/installClientErrorReporter'
import type { ClientErrorComponent } from './services/observability/clientErrorContract'

const AUTO_SYNC_RETRY_COOLDOWN_MS = 15_000

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
    </div>
  )
}

class AppRouteBoundary extends Component<
  { children: ReactNode; resetKey: string; area?: ClientErrorComponent },
  { hasError: boolean; message: string | null }
> {
  state: { hasError: boolean; message: string | null } = { hasError: false, message: null }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Error inesperado',
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[router] route render failed', error, info.componentStack)
    // Se envía la etiqueta estática del área, nunca `info.componentStack`, que
    // arrastraría nombres de archivo y estructura interna del árbol.
    captureClientError({
      source: 'react_boundary',
      error,
      component: this.props.area ?? null,
    })
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: null })
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          No se pudo cargar esta vista.
          {/* El mensaje crudo interpola ids y fragmentos de fila: en producción
              no se le muestra al usuario. En dev se conserva para depurar. */}
          {!import.meta.env.PROD && this.state.message && (
            <span className="mt-1 block text-xs text-rose-200/80">{this.state.message}</span>
          )}
        </div>
        <a
          href={ROUTES.HOME}
          className="inline-flex items-center rounded-full border border-brand/30 bg-brand/15 px-4 py-2 text-sm font-semibold text-brand-light transition-colors hover:bg-brand/25"
        >
          Volver al inicio
        </a>
      </div>
    )
  }
}

function RouteBoundary({ children, area }: { children: ReactNode; area?: ClientErrorComponent }) {
  const location = useLocation()
  return (
    <AppRouteBoundary resetKey={location.pathname} area={area}>
      {children}
    </AppRouteBoundary>
  )
}

/**
 * Redirects first-time users (no sports configured) to onboarding.
 * Escape hatch: if primarySport has legacy free-text, skip the redirect.
 */
function OnboardingGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore(s => s.user)
  const syncAttemptInFlight = useAuthStore(s => s.syncDetails.syncAttemptInFlight)
  const awaitingProfileRecreationAfterReset = useAuthStore(s => s.syncDetails.awaitingProfileRecreationAfterReset)
  const memoryLoadRequiredAfterSyncAt = useAuthStore(s => s.syncDetails.memoryLoadRequiredAfterSyncAt)
  const memoryLoadedForSyncAt = useAuthStore(s => s.syncDetails.memoryLoadedForSyncAt)
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)
  const hasLoadedMemory = useCoachMemoryStore(s => s.hasLoaded)

  useEffect(() => {
    if (location.pathname === ROUTES.ONBOARDING) return
    if (!hasLoadedMemory) return
    if (syncAttemptInFlight) return
    if (
      isSupabaseConfigured &&
      user?.id &&
      memoryLoadRequiredAfterSyncAt != null &&
      memoryLoadedForSyncAt !== memoryLoadRequiredAfterSyncAt
    ) return
    if (isSupabaseConfigured && user?.id && memoryLoadRequiredAfterSyncAt == null) return

    if (isSupabaseConfigured && user?.id && awaitingProfileRecreationAfterReset) {
      navigate(ROUTES.ONBOARDING, { replace: true })
      return
    }

    const skippedOnboarding = hasSkippedOnboarding(user?.id)

    // Multi-device safety: if we have a signed-in user but have never completed a remote pull
    // (e.g. sync failed before the profile was fetched), do NOT redirect to onboarding — a
    // profile may already exist in the cloud on another device. Wait for a successful sync.
    if (
      isSupabaseConfigured &&
      user?.id &&
      needsOnboarding(athleteProfile) &&
      !skippedOnboarding &&
      !hasInitialRemotePullCompleted(user.id)
    ) return

    if (needsOnboarding(athleteProfile) && !skippedOnboarding) {
      navigate(ROUTES.ONBOARDING, { replace: true })
    }
  }, [athleteProfile, awaitingProfileRecreationAfterReset, hasLoadedMemory, location.pathname, memoryLoadRequiredAfterSyncAt, memoryLoadedForSyncAt, navigate, syncAttemptInFlight, user?.id])

  return <>{children}</>
}

export default function App() {
  const user = useAuthStore(s => s.user)
  const isAuthLoading = useAuthStore(s => s.isLoading)
  const userId = user?.id ?? null
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)
  const hasLoadedMemory = useCoachMemoryStore(s => s.hasLoaded)

  useEffect(() => {
    // D6: capture before authentication so the token survives the OAuth redirect.
    capturePendingClaimTokenFromUrl()
    void db.open().catch(console.error)
  }, [])

  useEffect(() => {
    if (!hasLoadedMemory || !athleteProfile) return
    void usePlanBuilderStore.getState().resumeGenerationJobs(athleteProfile)
  }, [athleteProfile, hasLoadedMemory])

  useEffect(() => {
    if (!userId) {
      // El logout también debe invalidar una corrida que espera I/O; no basta
      // con resetear el store, porque la frontera anterior podría continuar.
      invalidateSessionBootstrap()
      useEntitlementStore.getState().reset()
      return
    }

    // Esta limpieza ocurre ANTES de cruzar la frontera async. Si cambió la
    // cuenta, el holder no puede conservar por un frame el rol anterior
    // mientras `prepareLocalDataForUser` todavía está vaciando Dexie.
    if (useEntitlementStore.getState().userId !== userId) {
      useEntitlementStore.getState().reset()
    }

    let cancelled = false
    let syncInFlight = false
    let lastAutoRetryAt = 0
    let bootstrapReady = false
    let bootstrapInFlight = false

    // Un rol ilegible NO invalida la sesión: `unknown` sigue el camino de
    // `athlete` (ver `athleteScopeKind.ts`). Exigir un rol resuelto acá dejaba
    // `bootstrapReady` en false para siempre en una sesión offline, así que
    // ningún `online`/`focus`/`visible` posterior llegaba a sincronizar.
    const isCurrentResolvedSession = () => {
      const entitlement = useEntitlementStore.getState()
      return !cancelled
        && useAuthStore.getState().user?.id === userId
        && entitlement.userId === userId
    }

    const hydrateScope = async (id: string) => {
      await hydrateActiveAthlete(id)
      if (!isCurrentResolvedSession()) return
      useAuthStore.getState().setActiveAthleteId(getActiveAthleteId())
    }

    const syncSignedInUser = async (
      reason: 'initial' | 'online' | 'visible' | 'focus' = 'initial',
      options: { fromBootstrap?: boolean; shouldMigrate?: boolean } = {},
    ) => {
      // Los listeners siguen vivos, pero no pueden sincronizar ni adoptar scope
      // antes de que la frontera de cuenta y el rol estén resueltos.
      if ((!bootstrapReady && !options.fromBootstrap) || !isCurrentResolvedSession()) return
      if (syncInFlight) return
      if (reason !== 'initial') {
        const now = Date.now()
        if (now - lastAutoRetryAt < AUTO_SYNC_RETRY_COOLDOWN_MS) return
        lastAutoRetryAt = now
      }
      syncInFlight = true
      const syncBoundaryAt = Date.now()
      useAuthStore.getState().setSyncDetails({
        memoryLoadRequiredAfterSyncAt: syncBoundaryAt,
        memoryLoadedForSyncAt: null,
      })

      try {
        // El bootstrap ya hizo estas tres operaciones en orden. Los re-syncs
        // las conservan para refrescar roster/scope, pero nunca backfillean un
        // coach bajo el self legacy.
        if (!options.fromBootstrap) {
          await pullMemberships(userId)
          if (!isCurrentResolvedSession()) return
          let skipScopeHydration = false
          if (roleOwnsLegacySelfData(useEntitlementStore.getState().accountRole)) {
            const backfilled = await backfillLocalAthleteScope(userId)
            if (!isCurrentResolvedSession()) return
            // `null` = claim pendiente. Hidratar el scope acá lo ataría al self
            // legacy antes de que el claim decida a qué atleta pertenece.
            skipScopeHydration = backfilled === null
          }
          if (!skipScopeHydration) {
            await hydrateScope(userId)
            if (!isCurrentResolvedSession()) return
          }
        }

        // Sólo el bootstrap cruza la frontera destructiva y calcula esta marca.
        // Un coach no migra datos legacy como si fuesen su atleta self.
        if (options.shouldMigrate && roleOwnsLegacySelfData(useEntitlementStore.getState().accountRole)) {
          await migrateLocalDataToCloud(userId)
          if (!isCurrentResolvedSession()) return
        }

        // Prioriza los datos que el usuario está mirando. El sync completo también
        // trae sesiones, pero incluye varias tablas y puede demorar en conexiones
        // móviles. Este pull acotado permite hidratar el calendario primero.
        const trainingStateBeforeSync = useTrainingStore.getState()
        const priorityWeekStart = resolveWeekStartToRefresh(trainingStateBeforeSync, currentWeekStartISO())
        const priorityWeekEnd = toISO(addDays(fromISO(priorityWeekStart), 6))
        try {
          await pullSessionsForDateRange(priorityWeekStart, priorityWeekEnd)
        } catch (error) {
          // El sync completo que sigue mantiene el retry y los diagnósticos
          // habituales; un fallo de esta optimización no debe bloquearlo.
          console.warn('[app] priority week pull failed', error)
        }
        if (!isCurrentResolvedSession()) return

        // La semana puede haber cambiado mientras el request estaba en vuelo.
        // Releer el último destino evita volver a mostrar una semana anterior.
        const trainingStateAfterPriorityPull = useTrainingStore.getState()
        const weekStartAfterPriorityPull = resolveWeekStartToRefresh(
          trainingStateAfterPriorityPull,
          priorityWeekStart,
        )
        await trainingStateAfterPriorityPull.loadWeek(weekStartAfterPriorityPull)
        if (!isCurrentResolvedSession()) return

        await runFullSync(userId)
        if (!isCurrentResolvedSession()) return

        // Refrescar el calendario antes de WHOOP y memoria: ninguno de esos pulls
        // debe retrasar la aparición de entrenamientos recién sincronizados.
        const trainingStateAfterSync = useTrainingStore.getState()
        const weekStartAfterSync = resolveWeekStartToRefresh(trainingStateAfterSync, currentWeekStartISO())
        await Promise.all([
          trainingStateAfterSync.loadWeek(weekStartAfterSync),
          trainingStateAfterSync.loadAllSummaries(),
        ])
        if (!isCurrentResolvedSession()) return

        await pullWorkouts()
          .then(() => autoCompleteFromWorkouts())
          .catch((error) => console.warn('[whoop:auto-complete] pull+run failed', error))
        if (!isCurrentResolvedSession()) return

        const { loadMemory } = useCoachMemoryStore.getState()
        await loadMemory()
        if (!isCurrentResolvedSession()) return

        useAuthStore.getState().setSyncDetails({
          memoryLoadedForSyncAt: syncBoundaryAt,
        })
      } catch (error) {
        const { loadMemory } = useCoachMemoryStore.getState()
        try {
          await loadMemory()
          if (isCurrentResolvedSession()) {
            useAuthStore.getState().setSyncDetails({
              memoryLoadedForSyncAt: syncBoundaryAt,
            })
          }
        } catch (memoryError) {
          console.error('[app] failed to reload athlete profile after sync error', memoryError)
        }
        console.error('[app] signed-in sync failed', error)
      } finally {
        syncInFlight = false
      }
    }

    const startBootstrap = () => {
      if (bootstrapInFlight || bootstrapReady || cancelled) return
      bootstrapInFlight = true
      let shouldMigrate = false
      void runSessionBootstrap(userId, {
        prepareLocalDataForUser: async (id) => {
          await db.open().catch(() => {})
          capturePendingClaimTokenFromUrl()
          const result = await prepareLocalDataForUser(id)
          shouldMigrate = result.shouldMigrate
        },
        hydrateRole: async (id) => {
          await useEntitlementStore.getState().hydrate(id)
          return useEntitlementStore.getState().accountRole
        },
        pullMemberships,
        backfillLegacyScope: backfillLocalAthleteScope,
        hydrateAthleteScope: hydrateScope,
        runFullSync: async () => syncSignedInUser('initial', {
          fromBootstrap: true,
          shouldMigrate,
        }),
      }).then(() => {
        if (isCurrentResolvedSession()) bootstrapReady = true
      }).catch((error) => {
        if (!cancelled) console.error('[bootstrap] failed', error)
      }).finally(() => {
        bootstrapInFlight = false
      })
    }

    const requestResync = (reason: 'online' | 'visible' | 'focus') => {
      if (!bootstrapReady) {
        startBootstrap()
        return
      }
      void syncSignedInUser(reason)
    }

    startBootstrap()

    const handleOnline = () => {
      requestResync('online')
    }

    // Shared foreground/resume auto-sync policy: skip while a schema_mismatch
    // error is pending its own retry, otherwise sync if the focus heuristic says so.
    const maybeAutoSyncOnForeground = (reason: 'focus' | 'visible') => {
      const { syncStatus, syncDetails } = useAuthStore.getState()
      if (syncStatus === 'error' && syncDetails.lastErrorCategory === 'schema_mismatch' && syncDetails.retryScheduledAt == null) return
      if (shouldAutoSyncOnFocus(syncStatus, syncDetails)) {
        requestResync(reason)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') maybeAutoSyncOnForeground('visible')
    }

    const handleFocus = () => maybeAutoSyncOnForeground('focus')

    const handleNativeResume = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      maybeAutoSyncOnForeground('focus')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    window.addEventListener(NATIVE_RESUME_EVENT, handleNativeResume)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = window.setInterval(() => {
      const { syncStatus, syncDetails } = useAuthStore.getState()
      if (syncStatus === 'syncing' || syncDetails.syncAttemptInFlight) return
      if (syncStatus === 'error' && syncDetails.lastErrorCategory === 'schema_mismatch' && syncDetails.retryScheduledAt == null) return
      if (syncDetails.pendingOps === 0 && syncStatus === 'error' && syncDetails.retryScheduledAt == null) return
      if (syncDetails.pendingOps === 0 && syncStatus !== 'error' && syncStatus !== 'offline') return
      const retryAt = syncDetails.retryScheduledAt
      if (retryAt != null && retryAt > Date.now()) return
      requestResync('visible')
    }, 15000)

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener(NATIVE_RESUME_EVENT, handleNativeResume)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [userId])

  return (
    <BrowserRouter>
      <NativeBridge />
      <RouteRobotsMeta />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {isIOSPlatform() && !user && !isAuthLoading && (
            <Route path={ROUTES.HOME} element={<NativeWelcomePreviewPage />} />
          )}
          <Route path={ROUTES.IOS_WELCOME_PREVIEW} element={<NativeWelcomePreviewPage />} />
          <Route path={ROUTES.FEATURES} element={<RouteBoundary><FeaturesPage /></RouteBoundary>} />
          <Route path={ROUTES.PRICING} element={<RouteBoundary><PricingPage /></RouteBoundary>} />
          <Route path={ROUTES.TERMS} element={<RouteBoundary><TermsPage /></RouteBoundary>} />
          <Route path={ROUTES.PRIVACY} element={<RouteBoundary><PrivacyPage /></RouteBoundary>} />
          <Route path={ROUTES.HEALTH_DISCLAIMER} element={<RouteBoundary><HealthDisclaimerPage /></RouteBoundary>} />
          <Route path={ROUTES.WHOOP_DISCLAIMER} element={<RouteBoundary><WhoopDisclaimerPage /></RouteBoundary>} />
          <Route path={ROUTES.COACHES} element={<RouteBoundary><CoachesLandingPage /></RouteBoundary>} />
          <Route path="*" element={(
            <AuthGate>
              <ConsentGate>
                <CoachScopeGuard />
                <OnboardingGuard>
                  <Routes>
                  <Route path={ROUTES.ONBOARDING} element={<OnboardingPage />} />
                  <Route element={<AppShell />}>
                    <Route path={ROUTES.HOME} element={<RouteBoundary area="Dashboard"><Dashboard /></RouteBoundary>} />
                    <Route path={ROUTES.WEEK} element={<RouteBoundary area="WeeklyView"><WeeklyView /></RouteBoundary>} />
                    <Route path="/day/:date" element={<RouteBoundary area="DayDetail"><DayDetail /></RouteBoundary>} />
                    <Route path={ROUTES.CHAT} element={<RouteBoundary area="ChatCoach"><ChatCoach /></RouteBoundary>} />
                    <Route path={ROUTES.PLAN_BUILDER} element={<RouteBoundary area="PlanBuilder"><PlanBuilderPage /></RouteBoundary>} />
                    <Route path={ROUTES.COMPETITION_PLAN} element={<RouteBoundary area="CompetitionPlan"><CompetitionPlanPage /></RouteBoundary>} />
                    <Route path={ROUTES.PLAN_BUILDER_V2} element={<RouteBoundary area="PlanBuilderV2"><PlanBuilderV2Page /></RouteBoundary>} />
                    <Route path="/history" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                    <Route path={ROUTES.COACH} element={<RouteBoundary area="CoachWorkspace"><CoachWorkspacePage /></RouteBoundary>} />
                    <Route path={ROUTES.OPS} element={<RouteBoundary area="Operations"><OperationsPage /></RouteBoundary>} />
                    <Route path="/dashboard" element={<Navigate to={ROUTES.HOME} replace />} />
                    <Route path="/plan" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                    <Route path="/plan/dashboard" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                    <Route path={ROUTES.SETTINGS} element={<RouteBoundary area="Settings"><SettingsPage /></RouteBoundary>} />
                    <Route path={ROUTES.IMPORT} element={<RouteBoundary area="ImportPDF"><ImportPDF /></RouteBoundary>} />
                    <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
                  </Route>
                  </Routes>
                </OnboardingGuard>
              </ConsentGate>
            </AuthGate>
          )} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function shouldAutoSyncOnFocus(
  syncStatus: ReturnType<typeof useAuthStore.getState>['syncStatus'],
  syncDetails: ReturnType<typeof useAuthStore.getState>['syncDetails'],
): boolean {
  if (syncStatus === 'syncing' || syncDetails.syncAttemptInFlight) return false
  return true
}
