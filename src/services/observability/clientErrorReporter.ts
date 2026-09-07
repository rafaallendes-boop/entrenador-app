/**
 * Máquina de estado del reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §7.
 *
 * Todo lo que decide si un evento sale o no vive acá, con transporte y reloj
 * inyectados; la instalación de listeners y el `fetch` real son otra capa.
 *
 * Tres invariantes que no se relajan:
 *
 *  1. **Nunca lanza al consumidor.** Se instala sobre `window.onerror`, un
 *     boundary de React y el camino de sync: si propagara, rompería justo lo
 *     que está observando.
 *  2. **Nunca reintenta.** Un evento se envía una vez o se pierde. El canal
 *     existe para detectar un error nuevo, no para garantizar entrega — y
 *     reintentar durante un loop de render es exactamente la tormenta que el
 *     cap y el breaker están para evitar.
 *  3. **No captura sus propios fallos.** El transporte no reporta; si lo
 *     hiciera, un endpoint caído se realimentaría a sí mismo.
 *
 * La entrega es best-effort y deduplicada: **no hay garantía de una fila por
 * fallo**, y la operación que produjo el error nunca cambia de resultado.
 */

import type {
  ClientErrorPlatform,
  ClientErrorScopeKind,
  ClientErrorSource,
  DiagnosticCode,
} from './clientErrorContract'

/** Techo por sesión de pestaña. Cuenta **intentos**, no envíos exitosos. */
export const MAX_REPORTS_PER_TAB = 10

/** Pausa tras el primer fallo de transporte. El segundo consecutivo cierra. */
export const TRANSPORT_PAUSE_MS = 30_000

export interface CapturedClientError {
  readonly source: ClientErrorSource
  readonly diagnosticCode: DiagnosticCode
  readonly scopeKind: ClientErrorScopeKind
  readonly errorName: string
  readonly component: string | null
  readonly route: string
  readonly stackFrames: string | null
  readonly requestClass: string | null
}

/**
 * Resultado del transporte:
 *   - `number`         → status HTTP obtenido.
 *   - `null`           → se intentó y falló (red caída, timeout).
 *   - `'not_attempted'`→ **no se llegó a intentar** por una condición local,
 *     como no tener token de sesión.
 *
 * El tercer caso es distinto a propósito. Tratarlo como fallo cerraría el canal
 * por un problema de sesión y no del endpoint — y con el refresh token vencido
 * `currentAccountId()` todavía devuelve la cuenta, así que el guard de sesión
 * no lo atrapa. Además consumiría un intento del cap y la firma de dedupe, con
 * lo que ese error no podría reportarse nunca más en la pestaña.
 */
export type ClientErrorTransportResult = number | null | 'not_attempted'

export type ClientErrorTransport = (body: string) => Promise<ClientErrorTransportResult>

export interface ClientErrorReporterDeps {
  readonly transport: ClientErrorTransport
  readonly now: () => number
  readonly enabled: boolean
  /** Identidad opaca de la sesión. `null` significa sin sesión. */
  readonly currentAccountId: () => string | null
  readonly release: string
  readonly platform: ClientErrorPlatform
}

export interface ReporterStats {
  readonly attempts: number
  readonly sent: number
  readonly deduped: number
  readonly discardedByAccountChange: number
  readonly closed: boolean
}

export interface ClientErrorReporter {
  report(event: CapturedClientError): Promise<void>
  stats(): ReporterStats
}

/** Firma local de deduplicación. No es el fingerprint: ése lo calcula el servidor. */
function localSignature(event: CapturedClientError): string {
  return [
    event.source,
    event.diagnosticCode,
    event.errorName,
    event.component ?? '',
    event.route,
    event.stackFrames?.split('\n')[0] ?? '',
  ].join('|')
}

export function createClientErrorReporter(
  deps: ClientErrorReporterDeps,
): ClientErrorReporter {
  const seen = new Set<string>()
  let attempts = 0
  let sent = 0
  let deduped = 0
  let discardedByAccountChange = 0
  let consecutiveFailures = 0
  let pausedUntil = 0
  let closed = false

  function stats(): ReporterStats {
    return { attempts, sent, deduped, discardedByAccountChange, closed }
  }

  async function report(event: CapturedClientError): Promise<void> {
    if (!deps.enabled || closed) return

    const account = deps.currentAccountId()
    if (account === null) return

    if (deps.now() < pausedUntil) return
    if (attempts >= MAX_REPORTS_PER_TAB) return

    // La reserva va antes de cualquier `await`: si fuera después, un componente
    // en loop dispararía N envíos idénticos antes de que el primero resolviera.
    const signature = localSignature(event)
    if (seen.has(signature)) {
      deduped += 1
      return
    }
    seen.add(signature)
    attempts += 1

    const body = JSON.stringify({
      source: event.source,
      diagnostic_code: event.diagnosticCode,
      scope_kind: event.scopeKind,
      error_name: event.errorName,
      component: event.component,
      route: event.route,
      stack_frames: event.stackFrames,
      request_class: event.requestClass,
      release: deps.release,
      platform: deps.platform,
    })

    // **Antes** de enviar, no después. El servidor estampa el `user_id` del
    // token que el transporte resuelve en el momento del envío: si la cuenta
    // cambió durante el vuelo, la fila ya quedó bajo la cuenta equivocada y
    // comprobarlo al volver sólo serviría para contarlo.
    //
    // Queda un residuo declarado: un logout que ocurra *durante* el fetch sigue
    // pudiendo atribuir mal. Cerrarlo del todo exigiría capturar el token en el
    // momento de la captura y no en el del envío.
    if (deps.currentAccountId() !== account) {
      discardedByAccountChange += 1
      seen.delete(signature)
      attempts -= 1
      return
    }

    let status: ClientErrorTransportResult
    try {
      status = await deps.transport(body)
    } catch {
      // El transporte no reporta su propio fallo: se realimentaría.
      status = null
    }

    // No se intentó: se devuelve la reserva para que el mismo error se pueda
    // reportar cuando la condición local se resuelva.
    if (status === 'not_attempted') {
      seen.delete(signature)
      attempts -= 1
      return
    }

    // Segunda verificación, sólo para no contabilizar como éxito ni como fallo
    // de canal algo cuya atribución ya no podemos afirmar.
    if (deps.currentAccountId() !== account) {
      discardedByAccountChange += 1
      return
    }

    if (status === null || status >= 500) {
      consecutiveFailures += 1
      if (consecutiveFailures >= 2) closed = true
      else pausedUntil = deps.now() + TRANSPORT_PAUSE_MS
      return
    }

    // Un 4xx es un contrato mal armado: reintentar no lo arregla, pero tampoco
    // indica que el canal esté caído, así que no abre el breaker.
    if (status >= 400) return

    consecutiveFailures = 0
    sent += 1
  }

  return { report, stats }
}
