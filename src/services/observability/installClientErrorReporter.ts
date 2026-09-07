/**
 * Instalación del reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §6, §7 y §9.1.
 *
 * Esta capa hace lo que la máquina de estado no puede hacer sin el navegador:
 * registra listeners, resuelve sesión y scope, carga el manifiesto del propio
 * release y habla con el endpoint. Toda la lógica de decisión vive en
 * `clientErrorReporter.ts` y `errorClassifier.ts`, que son puros.
 *
 * El manifiesto se carga **una sola vez y sin bloquear el arranque**: hasta
 * tenerlo, los eventos salen con categorías y sin frames. Es el estado interino
 * declarado en §9.1, no un fallo.
 */

import { resolveApiUrl } from '../apiUrl'
import { supabase } from '../auth'
import { getActiveAthleteId, getSelfAthleteId } from '../athlete/activeAthlete'
import { isNativePlatform } from '../platform'
import { useAuthStore } from '../../store/useAuthStore'
import type { SyncErrorCategory } from '../syncUtils'
import { resolveBrowserScopeKind } from './browserScope'
import { classifyClientError, readErrorName } from './errorClassifier'
import { normalizeErrorName } from './errorName'
import { normalizeRoute } from './routeNormalizer'
import { loadReleaseManifest } from './releaseManifestLoader'
import { normalizeStackFrames } from './stackFrames'
import {
  createClientErrorReporter,
  type CapturedClientError,
  type ClientErrorReporter,
  type ClientErrorTransportResult,
} from './clientErrorReporter'
import type { ClientErrorComponent, ClientErrorSource } from './clientErrorContract'

const TRANSPORT_TIMEOUT_MS = 3_000

/** Flag de build. Apagada por defecto: la captura se enciende a propósito. */
function isReportingEnabled(): boolean {
  return import.meta.env['VITE_CLIENT_ERROR_REPORTING_ENABLED'] === 'true'
}

/**
 * Orígenes cuyos assets pueden aparecer en un frame legítimo. Se declaran acá,
 * desde configuración confiable — **nunca desde el payload ni desde el propio
 * stack**, que es justamente lo que se está validando.
 */
function trustedOrigins(): ReadonlySet<string> {
  const origins = new Set<string>(['capacitor://localhost'])
  if (typeof location !== 'undefined' && location.origin) origins.add(location.origin)
  const configured = import.meta.env['VITE_API_BASE_URL']
  if (typeof configured === 'string' && configured !== '') {
    try {
      origins.add(new URL(configured).origin)
    } catch {
      // Configuración inválida: no agrega origen. `resolveApiUrl` ya lo reporta.
    }
  }
  return origins
}

async function postEvent(body: string): Promise<ClientErrorTransportResult> {
  try {
    // Sin cliente o sin token **no se intenta**, y eso no es un fallo del
    // canal: devolver `null` acá abriría el breaker por una sesión vencida y
    // consumiría un intento del cap que nunca llegó a usarse.
    if (!supabase) return 'not_attempted'
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return 'not_attempted'

    const response = await fetch(resolveApiUrl('/.netlify/functions/report-client-error'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      // `keepalive` permite que el envío sobreviva a la navegación que muchas
      // veces sigue a un error de render.
      keepalive: true,
      signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
    })
    return response.status
  } catch {
    return null
  }
}

let installed: { dispose: () => void; reporter: ClientErrorReporter } | null = null

/** Inventario del release, `null` mientras no se haya podido establecer. */
let knownAssets: ReadonlySet<string> | null = null

export interface CaptureContext {
  readonly source: ClientErrorSource
  readonly error: unknown
  readonly message?: string | null
  readonly filename?: string | null
  readonly component?: ClientErrorComponent | null
  /**
   * Nombre declarado por la integración, para fuentes que no producen un objeto
   * de error (sync). Gana sobre la lectura del error.
   */
  readonly errorName?: string | null
  readonly syncCategory?: SyncErrorCategory | null
  readonly abortOrigin?: 'fetch' | 'dexie' | 'unknown'
  readonly chunkLoadSignal?: boolean
  readonly moduleLoadEventFired?: boolean
  readonly requestClass?: string | null
}

/** Lee `stack` sin confiar en el objeto: puede ser un getter que lanza. */
function readStack(error: unknown): string | undefined {
  try {
    if (error instanceof Error) return error.stack
    if (typeof error === 'object' && error !== null && 'stack' in error) {
      const stack = (error as { stack: unknown }).stack
      return typeof stack === 'string' ? stack : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Traduce una captura cruda al evento que viaja. **La instantánea de scope se
 * toma acá, antes de cualquier `await`**: tomarla después atribuiría una tarea
 * asíncrona al atleta visible al terminar, no al de la operación que falló.
 */
function toCapturedEvent(context: CaptureContext): CapturedClientError | null {
  const outcome = classifyClientError({
    source: context.source,
    error: context.error,
    message: context.message ?? null,
    filename: context.filename ?? null,
    syncCategory: context.syncCategory ?? null,
    abortOrigin: context.abortOrigin,
    chunkLoadSignal: context.chunkLoadSignal,
    moduleLoadEventFired: context.moduleLoadEventFired,
  })
  if (outcome.kind === 'ignored') return null

  const scopeKind = resolveBrowserScopeKind(getActiveAthleteId(), getSelfAthleteId())
  const rawStack = readStack(context.error)

  return {
    source: context.source,
    diagnosticCode: outcome.diagnosticCode,
    scopeKind,
    // Se usa el mismo lector que el clasificador: si él resolvió `chunk_load`
    // leyendo el `name` de un objeto plano, persistir `InvalidName` sería
    // incoherente y ensuciaría también el fingerprint del servidor.
    errorName: normalizeErrorName(context.errorName ?? readErrorName(context.error)),
    component: context.component ?? null,
    route: normalizeRoute(typeof location === 'undefined' ? null : location.pathname),
    stackFrames: normalizeStackFrames(rawStack, knownAssets, trustedOrigins()),
    requestClass: context.requestClass ?? null,
  }
}

/** Punto de entrada único de captura. Nunca lanza ni devuelve nada al llamador. */
export function captureClientError(context: CaptureContext): void {
  if (installed === null) return
  try {
    const event = toCapturedEvent(context)
    if (event === null) return
    void installed.reporter.report(event)
  } catch {
    // Observar no puede romper lo observado.
  }
}

/**
 * Instalación idempotente. Devuelve la función de limpieza, que retira los
 * listeners: sin ella, un remount en desarrollo duplicaría cada evento.
 */
export function installClientErrorReporter(): () => void {
  if (installed !== null) return installed.dispose
  if (typeof window === 'undefined') return () => {}

  const reporter = createClientErrorReporter({
    transport: postEvent,
    now: () => Date.now(),
    enabled: isReportingEnabled(),
    currentAccountId: () => useAuthStore.getState().user?.id ?? null,
    release: __APP_RELEASE__,
    platform: isNativePlatform() ? 'ios' : 'web',
  })

  const onError = (event: ErrorEvent): void => {
    captureClientError({
      source: 'window_error',
      error: event.error,
      message: event.message,
      filename: event.filename,
    })
  }

  const onRejection = (event: PromiseRejectionEvent): void => {
    captureClientError({ source: 'unhandled_rejection', error: event.reason })
  }

  // `vite:preloadError` es **ambiguo**: el helper de Vite lo dispara tanto por
  // un preload rechazado como por un error lanzado al evaluar el módulo. Se
  // registra el hecho, no se afirma `chunkLoadSignal`.
  const onPreloadError = (event: Event): void => {
    const payload = (event as Event & { payload?: unknown }).payload
    captureClientError({
      source: 'unhandled_rejection',
      error: payload,
      moduleLoadEventFired: true,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('vite:preloadError', onPreloadError)

  installed = {
    reporter,
    dispose: () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('vite:preloadError', onPreloadError)
      installed = null
    },
  }

  // No se espera: hasta tener el manifiesto, los eventos salen sin frames.
  // Un fallo de esta carga no se reporta — se realimentaría sobre sí mismo.
  if (isReportingEnabled()) {
    void loadReleaseManifest(__APP_RELEASE__, { fetchFn: fetch.bind(globalThis) })
      .then((assets) => {
        knownAssets = assets
      })
      .catch(() => {
        knownAssets = null
      })
  }

  return installed.dispose
}

/** Sólo para pruebas: deja el módulo como si nunca se hubiera instalado. */
export function resetClientErrorReporterForTests(): void {
  installed?.dispose()
  installed = null
  knownAssets = null
}
