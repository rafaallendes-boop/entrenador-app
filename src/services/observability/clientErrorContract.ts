/**
 * Contrato compartido del reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §4 y §6.
 *
 * Estas listas son **cerradas y append-only**, y viven declaradas en tres capas:
 * este módulo, la allowlist del endpoint y el `CHECK` de `client_error_events`.
 * Agregar un código es migración + endpoint + cliente, **en ese orden**; quitar
 * uno rompería la validación de las filas ya persistidas con él.
 *
 * `source` y `diagnostic_code` son ejes independientes a propósito: `source` es
 * de dónde llegó el evento, `diagnostic_code` es qué lo causó. Una promesa
 * rechazada por un chunk que no cargó es `unhandled_rejection` + `chunk_load`.
 * Colapsarlos perdería la mitad de la señal justo después de un deploy.
 */

export const DIAGNOSTIC_CODES = Object.freeze([
  'chunk_load',
  'network_failure',
  'timeout',
  'render_failure',
  'storage_failure',
  'data_parse_failure',
  'third_party_failure',
  'unknown',
  'sync_contract_failure',
] as const)

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number]

export const CLIENT_ERROR_SOURCES = Object.freeze([
  'window_error',
  'unhandled_rejection',
  'react_boundary',
  'sync_failure',
] as const)

export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number]

/**
 * Severidad **derivada**, nunca persistida: es un juicio y los juicios se
 * recalibran. Cambiar la regla cambia la lectura histórica sin reescribir filas.
 */
export const CLIENT_ERROR_SEVERITIES = Object.freeze(['alta', 'media', 'baja'] as const)

export type ClientErrorSeverity = (typeof CLIENT_ERROR_SEVERITIES)[number]

/** Contexto del evento. No concede permisos ni participa de RLS. */
export const CLIENT_ERROR_SCOPE_KINDS = Object.freeze(['self', 'managed'] as const)

export type ClientErrorScopeKind = (typeof CLIENT_ERROR_SCOPE_KINDS)[number]

export const CLIENT_ERROR_PLATFORMS = Object.freeze(['web', 'ios'] as const)

export type ClientErrorPlatform = (typeof CLIENT_ERROR_PLATFORMS)[number]

/** Motivos por los que un evento no se emite. No llegan a la base. */
export const CLIENT_ERROR_IGNORE_REASONS = Object.freeze([
  'business_rejection',
  'deliberate_abort',
  'resize_observer_loop',
  'opaque_script_error',
] as const)

export type ClientErrorIgnoreReason = (typeof CLIENT_ERROR_IGNORE_REASONS)[number]

/**
 * Etiquetas de integración para `component`. Son **estáticas y escritas por
 * nosotros**: nunca un `componentStack` crudo, que arrastraría nombres de
 * archivo y estructura interna del árbol de React.
 */
export const CLIENT_ERROR_COMPONENTS = Object.freeze([
  'Dashboard',
  'WeeklyView',
  'DayDetail',
  'ChatCoach',
  'PlanBuilder',
  'PlanBuilderV2',
  'CompetitionPlan',
  'CoachWorkspace',
  'Operations',
  'Settings',
  'ImportPDF',
  'Onboarding',
  'SyncService',
] as const)

export type ClientErrorComponent = (typeof CLIENT_ERROR_COMPONENTS)[number]

/** Espejo de `AIRequestClass`. Sólo viaja cuando el emisor la conoce. */
export const CLIENT_ERROR_REQUEST_CLASSES = Object.freeze([
  'chat_general',
  'chat_action',
  'weekly_summary',
  'week_creator',
  'plan_builder_week',
  'plan_builder_pair',
  'import_extract',
  'coach_assistant_message',
] as const)

export type ClientErrorRequestClass = (typeof CLIENT_ERROR_REQUEST_CLASSES)[number]

export function isClientErrorComponent(value: unknown): value is ClientErrorComponent {
  return typeof value === 'string' && (CLIENT_ERROR_COMPONENTS as readonly string[]).includes(value)
}

export function isClientErrorRequestClass(value: unknown): value is ClientErrorRequestClass {
  return (
    typeof value === 'string' &&
    (CLIENT_ERROR_REQUEST_CLASSES as readonly string[]).includes(value)
  )
}

export function isDiagnosticCode(value: unknown): value is DiagnosticCode {
  return typeof value === 'string' && (DIAGNOSTIC_CODES as readonly string[]).includes(value)
}

export function isClientErrorSource(value: unknown): value is ClientErrorSource {
  return typeof value === 'string' && (CLIENT_ERROR_SOURCES as readonly string[]).includes(value)
}

export function isClientErrorScopeKind(value: unknown): value is ClientErrorScopeKind {
  return typeof value === 'string' && (CLIENT_ERROR_SCOPE_KINDS as readonly string[]).includes(value)
}

export function isClientErrorPlatform(value: unknown): value is ClientErrorPlatform {
  return typeof value === 'string' && (CLIENT_ERROR_PLATFORMS as readonly string[]).includes(value)
}
