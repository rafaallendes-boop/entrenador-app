import type { AIRequestClass } from '../../types'

export const OPENAI_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number]

const GPT_5_ORIGINAL_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
const GPT_5_1_EFFORTS = ['none', 'low', 'medium', 'high'] as const
const GPT_5_2_PLUS_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const
const GPT_5_6_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export function supportsOpenAIReasoningEffort(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gpt-5')
}

/**
 * GPT-5 model generations do not accept the same reasoning values. In
 * particular, the original GPT-5 family uses `minimal` and does not accept
 * `none`, while GPT-5.1+ uses `none`; xhigh arrived later and max is GPT-5.6.
 */
export function getSupportedOpenAIReasoningEfforts(
  model: string,
): readonly OpenAIReasoningEffort[] {
  const normalized = model.trim().toLowerCase()
  const versionMatch = /^gpt-5\.(\d+)/.exec(normalized)
  const minorVersion = versionMatch ? Number(versionMatch[1]) : undefined

  if (minorVersion != null && minorVersion >= 6) return GPT_5_6_EFFORTS
  if (minorVersion != null && minorVersion >= 2) return GPT_5_2_PLUS_EFFORTS
  if (minorVersion === 1) return GPT_5_1_EFFORTS
  return GPT_5_ORIGINAL_EFFORTS
}

export function getDefaultOpenAIReasoningEffort(
  model: string,
  requestClass: AIRequestClass,
): OpenAIReasoningEffort {
  const supported = getSupportedOpenAIReasoningEfforts(model)
  switch (requestClass) {
    case 'chat_action':
    case 'week_creator':
    case 'plan_builder_week':
    case 'plan_builder_pair':
      return 'low'
    case 'chat_general':
    case 'weekly_summary':
    case 'import_extract':
      return supported.includes('none') ? 'none' : 'minimal'
  }
}
