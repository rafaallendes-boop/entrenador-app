import { describe, expect, it } from 'vitest'
import { ALL_AI_REQUEST_CLASSES } from '../aiRequestClasses'
import { AI_REQUEST_POLICIES } from '../requestPolicy'
import { getDefaultOpenAIReasoningEffort } from '../openAIReasoning'
import { REQUEST_CLASS_MIN_TIER } from '../../entitlements/entitlementPolicy'
import { bucketForClass } from '../../entitlements/quotaBuckets'

const CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES) as Array<keyof typeof ALL_AI_REQUEST_CLASSES>

describe('exhaustividad de AIRequestClass', () => {
  it('incluye la clase del asistente del coach', () => {
    expect(CLASSES).toContain('coach_assistant_message')
  })

  it('toda clase tiene policy, tier y bucket', () => {
    for (const requestClass of CLASSES) {
      expect(AI_REQUEST_POLICIES[requestClass], requestClass).toBeDefined()
      expect(REQUEST_CLASS_MIN_TIER[requestClass], requestClass).toBeDefined()
      expect(bucketForClass(requestClass), requestClass).not.toBeNull()
    }
  })

  it('el asistente del coach es advanced y no comparte contador con el chat', () => {
    expect(REQUEST_CLASS_MIN_TIER.coach_assistant_message).toBe('advanced')
    expect(bucketForClass('coach_assistant_message')?.id).toBe('coach_assistant')
  })

  it('fija la policy operativa del asistente y deshabilita fallback', () => {
    expect(AI_REQUEST_POLICIES.coach_assistant_message).toEqual({
      maxTokens: 260,
      temperature: 0.5,
      timeoutMs: 15_000,
      allowFallback: false,
    })
  })

  it('el asistente usa el esfuerzo mínimo compatible si se selecciona OpenAI', () => {
    expect(getDefaultOpenAIReasoningEffort('gpt-5.6', 'coach_assistant_message')).toBe('none')
    expect(getDefaultOpenAIReasoningEffort('gpt-5', 'coach_assistant_message')).toBe('minimal')
  })
})
