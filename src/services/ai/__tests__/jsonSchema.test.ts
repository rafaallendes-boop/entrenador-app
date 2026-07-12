import { describe, expect, it } from 'vitest'
import {
  normalizeJsonSchemaForGemini,
  normalizeJsonSchemaForStandardProvider,
} from '../jsonSchema'

describe('normalizeJsonSchemaForGemini', () => {
  it('removes unsupported strictness only at the Gemini boundary', () => {
    const sharedSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessions: {
          type: 'array',
          items: { type: 'object', additionalProperties: false },
        },
      },
    }

    expect(normalizeJsonSchemaForGemini(sharedSchema)).toEqual({
      type: 'OBJECT',
      properties: {
        sessions: {
          type: 'ARRAY',
          items: { type: 'OBJECT' },
        },
      },
    })
    expect(sharedSchema.additionalProperties).toBe(false)
  })

  it('drops unknown JSON Schema keywords recursively instead of maintaining a denylist', () => {
    expect(normalizeJsonSchemaForGemini({
      type: 'object',
      const: 'unsupported',
      anyOf: [{ type: 'string' }],
      properties: {
        value: { type: 'string', const: 'x' },
      },
    })).toEqual({
      type: 'OBJECT',
      properties: { value: { type: 'STRING' } },
    })
  })

  it('keeps strict JSON Schema keywords for Claude and OpenAI', () => {
    expect(normalizeJsonSchemaForStandardProvider({
      type: 'OBJECT',
      additionalProperties: false,
      properties: { value: { type: 'STRING', const: 'x' } },
    })).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string', const: 'x' } },
    })
  })
})
