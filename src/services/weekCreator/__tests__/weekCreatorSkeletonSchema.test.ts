import { describe, expect, it } from 'vitest'

import { normalizeJsonSchemaForGemini, normalizeJsonSchemaForStandardProvider } from '../../ai/jsonSchema'
import {
  WEEK_CREATOR_SKELETON_SESSION_TYPES,
  WEEK_CREATOR_SKELETON_VERSION,
  type WeekCreatorSkeleton,
} from '../weekCreatorSkeleton'
import { WEEK_CREATOR_RESPONSE_SCHEMA } from '../weekCreatorResponseSchema'
import { WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA } from '../weekCreatorSkeletonSchema'

type JsonSchemaNode = {
  type?: string
  additionalProperties?: boolean
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  enum?: readonly string[]
  items?: JsonSchemaNode
  minimum?: number
  maximum?: number
  minItems?: number
}

function getSessionSchema(schema: unknown = WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA): JsonSchemaNode {
  const root = schema as JsonSchemaNode
  const session = root.properties?.sessions?.items
  if (!session) throw new Error('sessions.items schema is missing')
  return session
}

describe('WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA', () => {
  it('exposes only coordination fields and the two minimal sport hints', () => {
    const session = getSessionSchema()

    expect(Object.keys(session.properties ?? {})).toEqual([
      'date',
      'timeBlock',
      'sessionType',
      'durationMin',
      'rpe',
      'focusKey',
      'title',
      'objective',
      'subtype',
      'runningType',
    ])
    expect(session.required).toEqual([
      'date',
      'timeBlock',
      'sessionType',
      'durationMin',
      'rpe',
      'focusKey',
      'title',
      'objective',
    ])
    expect(session.additionalProperties).toBe(false)
    expect(session.properties).not.toHaveProperty('exercises')
    expect(session.properties).not.toHaveProperty('squashDetails')
    expect(session.properties).not.toHaveProperty('cyclingDetails')
    expect(session.properties).not.toHaveProperty('mobilityDetails')
    expect(session.properties).not.toHaveProperty('intervalStructure')
    expect(session.properties?.sessionType.enum).toEqual(WEEK_CREATOR_SKELETON_SESSION_TYPES)
    expect(session.properties?.rpe).toEqual({ type: 'INTEGER', minimum: 1, maximum: 10 })
    expect((WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA as JsonSchemaNode).properties?.sessions?.minItems).toBe(1)
  })

  it('normalizes to standard JSON Schema for OpenAI and Anthropic', () => {
    const standard = normalizeJsonSchemaForStandardProvider(
      WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA,
    ) as JsonSchemaNode
    const session = getSessionSchema(standard)

    expect(standard.type).toBe('object')
    expect(standard.additionalProperties).toBe(false)
    expect(session.type).toBe('object')
    expect(session.properties?.durationMin.type).toBe('integer')
    expect(session.properties?.focusKey.type).toBe('string')
  })

  it('normalizes to the supported Gemini responseSchema subset', () => {
    const gemini = normalizeJsonSchemaForGemini(
      WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA,
    ) as JsonSchemaNode
    const session = getSessionSchema(gemini)

    expect(gemini.type).toBe('OBJECT')
    expect(gemini).not.toHaveProperty('additionalProperties')
    expect(session.type).toBe('OBJECT')
    expect(session).not.toHaveProperty('additionalProperties')
    expect(session.properties?.rpe).toEqual({ type: 'INTEGER', minimum: 1, maximum: 10 })
  })

  it('is materially smaller than the legacy executable-detail schema', () => {
    const compactChars = JSON.stringify(WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA).length
    const legacyChars = JSON.stringify(WEEK_CREATOR_RESPONSE_SCHEMA).length

    expect(compactChars).toBeLessThan(legacyChars * 0.5)
  })

  it('keeps the TypeScript boundary compatible with a representative payload', () => {
    const response = {
      type: 'create_week',
      reason: 'Coordinar carga y recuperación.',
      targetDate: '2026-07-20',
      weekObjectives: ['Consolidar control de la T'],
      sessions: [{
        date: '2026-07-20',
        timeBlock: 'AM',
        sessionType: 'squash',
        durationMin: 60,
        rpe: 7,
        focusKey: 'squash_control',
        title: 'Control de la T',
        objective: 'Sostener precisión bajo fatiga moderada.',
        subtype: 'control',
      }],
    } satisfies WeekCreatorSkeleton

    expect(response.type).toBe('create_week')
    expect(WEEK_CREATOR_SKELETON_VERSION).toBe('v1')
  })
})
