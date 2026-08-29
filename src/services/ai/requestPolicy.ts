import type { AIRequestClass } from '../../types'
import { v4 as uuid } from '../../utils/uuid'

export interface AIRequestPolicy {
  maxTokens: number
  temperature: number
  timeoutMs: number
  allowFallback: boolean
}

export const AI_REQUEST_POLICIES: Record<AIRequestClass, AIRequestPolicy> = {
  chat_general: {
    maxTokens: 2400,
    temperature: 0.55,
    timeoutMs: 15000,
    allowFallback: true,
  },
  chat_action: {
    maxTokens: 4200,
    temperature: 0.45,
    timeoutMs: 18000,
    allowFallback: true,
  },
  weekly_summary: {
    maxTokens: 1600,
    temperature: 0.25,
    timeoutMs: 18000,
    allowFallback: true,
  },
  week_creator: {
    maxTokens: 2500,
    temperature: 0.4,
    timeoutMs: 23000,
    allowFallback: true,
  },
  plan_builder_week: {
    maxTokens: 3500,
    temperature: 0.35,
    timeoutMs: 22000,
    allowFallback: true,
  },
  plan_builder_pair: {
    maxTokens: 4200,
    temperature: 0.35,
    timeoutMs: 23000,
    allowFallback: true,
  },
  import_extract: {
    maxTokens: 2000,
    temperature: 0.1,
    timeoutMs: 18000,
    allowFallback: true,
  },
  coach_assistant_message: {
    maxTokens: 260,
    temperature: 0.5,
    timeoutMs: 15000,
    allowFallback: false,
  },
}

export function getAIRequestPolicy(requestClass: AIRequestClass): AIRequestPolicy {
  return AI_REQUEST_POLICIES[requestClass]
}

/**
 * Output cap for the detailed (medical) week_creator contract. The 2500 cap in
 * the policy above was sized from skeleton-contract output only; the detailed
 * contract carries full per-sport exercises/drills/protocols and was observed
 * truncating (`finishReason=length`) at exactly 2500. This ceiling gives it
 * headroom without restoring the old 8000 guardrail-free budget. It doubles as
 * the proxy ceiling for week_creator, so keep the two in sync.
 */
export const WEEK_CREATOR_DETAILED_MAX_TOKENS = 4000

/** Skeleton contract keeps the validated 2500 cap; the detailed contract gets headroom. */
export function resolveWeekCreatorMaxTokens(useSkeletonContract: boolean): number {
  return useSkeletonContract
    ? AI_REQUEST_POLICIES.week_creator.maxTokens
    : WEEK_CREATOR_DETAILED_MAX_TOKENS
}

export function buildAITraceId(requestClass: AIRequestClass): string {
  return `${requestClass}-${uuid()}`
}

export function buildAIGenerationId(requestClass: AIRequestClass): string {
  return `${requestClass}-generation-${uuid()}`
}
