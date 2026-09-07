/**
 * Contrato de la tarjeta de errores de cliente en `/ops`.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §8 y §9.2.
 *
 * La **severidad no viene de SQL**: la RPC devuelve los hechos agrupados y acá
 * se deriva con `deriveSeverity`, la misma función que usa el resto del sistema.
 * Así recalibrar el criterio cambia también la lectura de lo ya ocurrido, sin
 * migración ni reescritura de filas.
 *
 * El orden importa y está fijado por el spec: **ordenar por severidad antes de
 * recortar el top**. Recortar por volumen primero dejaría fuera un error grave
 * de poca frecuencia, que es justo el que hay que ver.
 *
 * Los tres estados de la tarjeta son distintos a propósito: `ready` con total
 * cero significa «sin eventos»; `not_installed`, que la tabla o la RPC no
 * existen; `unavailable`, que la consulta falló. Un timeout o un permiso
 * denegado **no** se disfrazan de cero.
 */

import { deriveSeverity } from './errorSeverity'
import type {
  ClientErrorSeverity,
  ClientErrorSource,
  DiagnosticCode,
} from './clientErrorContract'

export interface ClientErrorGroup {
  readonly fingerprint: string
  readonly release: string
  readonly source: ClientErrorSource
  readonly diagnosticCode: DiagnosticCode
  readonly errorName: string
  readonly component: string | null
  readonly route: string
  readonly count: number
  /** Cuentas distintas afectadas. Nunca se expone quiénes son. */
  readonly accounts: number
  readonly firstSeen: string
  readonly lastSeen: string
}

export interface RankedClientErrorGroup extends ClientErrorGroup {
  readonly severity: ClientErrorSeverity
}

export interface UnknownBreakdownEntry {
  readonly source: ClientErrorSource
  readonly errorName: string
  readonly route: string
  readonly release: string
  readonly count: number
}

export interface ClientErrorWindow {
  readonly groups: readonly ClientErrorGroup[]
  readonly total: number
  readonly unknown: {
    readonly total: number
    readonly share: number
    readonly breakdown: readonly UnknownBreakdownEntry[]
  }
}

export interface ClientErrorRetentionHealth {
  readonly status: 'ok' | 'behind' | 'unavailable'
  readonly expiredRemaining: number | null
  readonly oldestExpiredAt: string | null
  readonly checkedAt: string | null
}

export interface ClientErrorMetrics {
  readonly status: 'ready' | 'not_installed' | 'unavailable'
  readonly windows?: {
    readonly day: ClientErrorWindow
    readonly week: ClientErrorWindow
  }
  readonly retention?: ClientErrorRetentionHealth
}

const SEVERITY_RANK: Readonly<Record<ClientErrorSeverity, number>> = {
  alta: 0,
  media: 1,
  baja: 2,
}

/**
 * Deriva severidad, ordena y **después** recorta. No muta la entrada.
 *
 * Criterios, en orden: severidad descendente, volumen descendente, última
 * aparición descendente.
 */
export function rankClientErrorGroups(
  groups: readonly ClientErrorGroup[],
  limit: number,
): readonly RankedClientErrorGroup[] {
  const ranked: RankedClientErrorGroup[] = groups.map((group) => ({
    ...group,
    severity: deriveSeverity({
      source: group.source,
      diagnosticCode: group.diagnosticCode,
      route: group.route,
    }),
  }))

  ranked.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (bySeverity !== 0) return bySeverity
    if (a.count !== b.count) return b.count - a.count
    return b.lastSeen.localeCompare(a.lastSeen)
  })

  return ranked.slice(0, limit)
}

function isWindow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate['groups'])) return false
  if (typeof candidate['total'] !== 'number') return false
  const unknown = candidate['unknown']
  if (typeof unknown !== 'object' || unknown === null) return false
  const unknownRecord = unknown as Record<string, unknown>
  return (
    typeof unknownRecord['total'] === 'number' &&
    typeof unknownRecord['share'] === 'number' &&
    Array.isArray(unknownRecord['breakdown'])
  )
}

export function isClientErrorMetrics(value: unknown): value is ClientErrorMetrics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const status = candidate['status']
  if (status !== 'ready' && status !== 'not_installed' && status !== 'unavailable') return false

  // Sólo `ready` promete ventanas. Los otros dos estados existen precisamente
  // para no tener que inventar datos.
  if (status !== 'ready') return true

  const windows = candidate['windows']
  if (typeof windows !== 'object' || windows === null) return false
  const windowsRecord = windows as Record<string, unknown>
  return isWindow(windowsRecord['day']) && isWindow(windowsRecord['week'])
}
