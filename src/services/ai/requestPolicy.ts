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
    timeoutMs: 25000,
    allowFallback: true,
  },
  weekly_summary: {
    maxTokens: 1600,
    temperature: 0.25,
    timeoutMs: 20000,
    allowFallback: true,
  },
  week_creator: {
    maxTokens: 3500,
    temperature: 0.4,
    timeoutMs: 30000,
    allowFallback: true,
  },
  plan_builder_week: {
    maxTokens: 8000,
    temperature: 0.35,
    timeoutMs: 45000,
    allowFallback: true,
  },
  plan_builder_pair: {
    maxTokens: 12000,
    temperature: 0.35,
    timeoutMs: 60000,
    allowFallback: true,
  },
  import_extract: {
    maxTokens: 2000,
    temperature: 0.1,
    timeoutMs: 20000,
    allowFallback: true,
  },
}

export function getAIRequestPolicy(requestClass: AIRequestClass): AIRequestPolicy {
  return AI_REQUEST_POLICIES[requestClass]
}

export function buildAITraceId(requestClass: AIRequestClass): string {
  return `${requestClass}-${uuid()}`
}
