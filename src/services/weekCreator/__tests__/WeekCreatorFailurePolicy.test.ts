import { describe, expect, it } from 'vitest'

import type { CoachNormalizedResponse } from '../../ai/types'
import {
  classifyWeekCreatorProviderFailure,
  classifyWeekCreatorValidationFailure,
} from '../WeekCreatorFailurePolicy'

function response(
  meta: CoachNormalizedResponse['meta'] = {
    hadActionsMarkup: true,
    actionParseFailed: false,
    likelyTruncated: false,
    outcome: 'schema_invalid',
  },
): CoachNormalizedResponse {
  return {
    message: '',
    provider: 'mock',
    timestamp: 0,
    traceId: 'trace-policy',
    requestClass: 'week_creator',
    meta,
  }
}

describe('WeekCreatorFailurePolicy', () => {
  it('classifies repairable validation codes without inspecting the message text', () => {
    const failure = classifyWeekCreatorValidationFailure({
      validationCode: 'schedule_constraint',
      error: 'texto humano que puede cambiar',
      response: response(),
      activeRestrictionsPresent: false,
    })

    expect(failure).toMatchObject({
      code: 'schedule_constraint',
      category: 'locally_repairable',
      decision: 'local_fallback',
    })
  })

  it('does not retry missing or unparsable create_week output', () => {
    const missing = classifyWeekCreatorValidationFailure({
      validationCode: 'missing_create_week',
      response: response(),
      activeRestrictionsPresent: false,
    })
    const parseInvalid = classifyWeekCreatorValidationFailure({
      validationCode: 'missing_create_week',
      response: response({
        hadActionsMarkup: true,
        actionParseFailed: true,
        likelyTruncated: false,
        outcome: 'parse_invalid',
      }),
      activeRestrictionsPresent: false,
    })

    expect(missing).toMatchObject({ category: 'unsafe_or_ambiguous', decision: 'local_fallback' })
    expect(parseInvalid).toMatchObject({
      code: 'actions_parse_failed',
      category: 'unsafe_or_ambiguous',
      decision: 'local_fallback',
      outcome: 'parse_invalid',
    })
  })

  it('allows only a targeted correction for a malformed recoverable action', () => {
    const regular = classifyWeekCreatorValidationFailure({
      validationCode: 'invalid_action_contract',
      response: response(),
      activeRestrictionsPresent: false,
    })
    const medicallySensitive = classifyWeekCreatorValidationFailure({
      validationCode: 'invalid_action_contract',
      response: response(),
      activeRestrictionsPresent: true,
    })

    expect(regular).toMatchObject({
      category: 'targeted_model_repair',
      decision: 'targeted_model_repair',
    })
    expect(medicallySensitive).toMatchObject({
      category: 'unsafe_or_ambiguous',
      decision: 'local_fallback',
    })
  })

  it('keeps provider failures separate and retryable', () => {
    expect(classifyWeekCreatorProviderFailure(new Error('timeout'))).toMatchObject({
      code: 'provider_error',
      category: 'provider_failure',
      decision: 'provider_retry',
    })
  })
})
