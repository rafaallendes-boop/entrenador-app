import type { CoachNormalizedResponse } from '../ai/types'
import type { RepairFailure } from '../planBuilder/repairWeek'

export type WeekCreatorFailureCategory =
  | 'locally_repairable'
  | 'targeted_model_repair'
  | 'unsafe_or_ambiguous'
  | 'provider_failure'

export type WeekCreatorValidationCode =
  | 'missing_create_week'
  | 'multiple_create_week'
  | 'extra_actions'
  | 'invalid_action_contract'
  | 'wrong_target_date'
  | 'invalid_week_dates'
  | 'session_count_mismatch'
  | 'slot_collision'
  | 'invalid_double_session'
  | 'duplicate_primary_same_day'
  | 'duplicate_squash_content'
  | 'duplicate_strength_content'
  | 'unavailable_day'
  | 'schedule_constraint'
  | 'unsupported_sport'
  | 'missing_sport_details'
  | 'missing_primary_sport'
  | 'missing_support_sport'

export type WeekCreatorFailureCode =
  | WeekCreatorValidationCode
  | 'actions_parse_failed'
  | 'schema_invalid'
  | 'provider_error'
  | 'safety_blocked'
  | RepairFailure['errorClass']

export type WeekCreatorFailureDecision =
  | 'local_fallback'
  | 'targeted_model_repair'
  | 'provider_retry'
  /** Terminal: neither a provider retry nor local fallback is safe. */
  | 'safe_decline'

export type WeekCreatorFailure = {
  code: WeekCreatorFailureCode
  category: WeekCreatorFailureCategory
  decision: WeekCreatorFailureDecision
  error: string
  outcome: 'parse_invalid' | 'schema_invalid' | 'quality_rejected' | 'safety_blocked'
  warnings: string[]
}

type ValidationFailureInput = {
  validationCode?: WeekCreatorValidationCode
  error?: string
  response: CoachNormalizedResponse
  activeRestrictionsPresent: boolean
}

const LOCALLY_REPAIRABLE_CODES = new Set<WeekCreatorValidationCode>([
  'extra_actions',
  'wrong_target_date',
  'invalid_week_dates',
  'session_count_mismatch',
  'slot_collision',
  'invalid_double_session',
  'duplicate_primary_same_day',
  'duplicate_squash_content',
  'duplicate_strength_content',
  'unavailable_day',
  'schedule_constraint',
  'unsupported_sport',
  'missing_sport_details',
  'missing_primary_sport',
  'missing_support_sport',
])

/**
 * Converts validation output into the stable decision contract used by the
 * engine. Human-readable error strings are deliberately telemetry only.
 */
export function classifyWeekCreatorValidationFailure(
  input: ValidationFailureInput,
): WeekCreatorFailure {
  const error = input.error?.trim() || 'La respuesta del modelo no pasó la validación del Week Creator.'
  const meta = input.response.meta

  if (meta?.actionParseFailed || meta?.outcome === 'parse_invalid') {
    return buildFailure('actions_parse_failed', 'unsafe_or_ambiguous', 'local_fallback', error, 'parse_invalid', meta?.warnings)
  }

  const code = input.validationCode ?? 'schema_invalid'
  if (code === 'invalid_action_contract' && !input.activeRestrictionsPresent) {
    return buildFailure(code, 'targeted_model_repair', 'targeted_model_repair', error, 'schema_invalid', meta?.warnings)
  }

  if (LOCALLY_REPAIRABLE_CODES.has(code as WeekCreatorValidationCode)) {
    return buildFailure(code, 'locally_repairable', 'local_fallback', error, 'schema_invalid', meta?.warnings)
  }

  // Missing/competing weeks are ambiguous. An invalid contract with an active
  // injury/restriction also stays local: do not ask a model to infer a medical
  // decision from a malformed object.
  return buildFailure(code, 'unsafe_or_ambiguous', 'local_fallback', error, 'schema_invalid', meta?.warnings)
}

export function classifyWeekCreatorProviderFailure(error: unknown): WeekCreatorFailure {
  const message = error instanceof Error ? error.message : String(error)
  return buildFailure(
    'provider_error',
    'provider_failure',
    'provider_retry',
    message,
    'schema_invalid',
  )
}

/**
 * A fail-closed repair rejection is not a repaired empty week. Retry the
 * provider with a fresh candidate and retain its stable quality error class in
 * telemetry if both attempts fail.
 */
export function classifyWeekCreatorRepairFailure(failure: RepairFailure): WeekCreatorFailure {
  return buildFailure(
    failure.errorClass,
    'unsafe_or_ambiguous',
    failure.errorClass === 'quality.session.dose_infeasible' ? 'safe_decline' : 'provider_retry',
    failure.message,
    'quality_rejected',
  )
}

function buildFailure(
  code: WeekCreatorFailureCode,
  category: WeekCreatorFailureCategory,
  decision: WeekCreatorFailureDecision,
  error: string,
  outcome: WeekCreatorFailure['outcome'],
  normalizationWarnings: string[] = [],
): WeekCreatorFailure {
  return {
    code,
    category,
    decision,
    error,
    outcome,
    warnings: [
      `week_creator_failure:${code}`,
      `week_creator_failure_category:${category}`,
      error,
      ...normalizationWarnings,
    ],
  }
}
