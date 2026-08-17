import type { HandlerEvent } from '@netlify/functions'

/**
 * Extracted from the inline event literal in `enqueuePlanEntitlement.test.ts`
 * (Task 5) so `enqueuePlanUsageGate.test.ts` (Task 6) doesn't duplicate it.
 * Matches the minimal shape `isGeneratePlanPayload` accepts: a plan id, and
 * at least one week whose `planId` matches the plan.
 */
export function buildEnqueueEvent(
  overrides: { authorization?: string; body?: unknown } = {},
): HandlerEvent {
  const body = overrides.body ?? {
    plan: { id: 'plan-1' },
    weeks: [{ id: 'week-1', planId: 'plan-1' }],
    profile: {},
    wizardConfig: {},
  }
  return {
    httpMethod: 'POST',
    headers: { authorization: overrides.authorization ?? 'Bearer token-1' },
    body: JSON.stringify(body),
  } as unknown as HandlerEvent
}
