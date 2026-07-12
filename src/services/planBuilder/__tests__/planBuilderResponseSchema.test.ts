import { describe, expect, it } from 'vitest'
import { PLAN_BUILDER_PAIR_RESPONSE_SCHEMA, PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'

describe('PLAN_BUILDER_WEEK_RESPONSE_SCHEMA', () => {
  it('exposes a JSON schema with create_week as the discriminated action', () => {
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toBeDefined()
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toHaveProperty('type')
    const serialized = JSON.stringify(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA)
    expect(serialized).toContain('create_week')
    expect(serialized).toContain('targetDate')
    expect(serialized).toContain('sessions')
  })

  it('keeps a strict shared JSON Schema for Claude and OpenAI', () => {
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toHaveProperty('type', 'object')
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toHaveProperty('additionalProperties', false)
    const sessions = (PLAN_BUILDER_WEEK_RESPONSE_SCHEMA as {
      properties: { sessions: { items: Record<string, unknown> } }
    }).properties.sessions.items
    expect(sessions).toHaveProperty('additionalProperties', false)
  })

  it('constrains the compact session enums so the provider cannot invent values', () => {
    type SchemaNode = {
      enum?: string[]
      minimum?: number
      maximum?: number
      items?: SchemaNode
      properties?: Record<string, SchemaNode>
    }
    const session = (PLAN_BUILDER_WEEK_RESPONSE_SCHEMA as {
      properties: { sessions: { items: { properties: Record<string, SchemaNode> } } }
    }).properties.sessions.items.properties

    expect(session.subtype.enum).toEqual(['training', 'match', 'competitive', 'control', 'light'])
    expect(session.runningType.enum).toEqual(['z2', 'tempo', 'intervals', 'long'])
    expect(session.sessionType.enum).toEqual(['squash', 'running', 'cycling', 'strength', 'mobility', 'recovery'])
    expect(session.rpe).toMatchObject({ minimum: 1, maximum: 10 })
    expect(session).not.toHaveProperty('exercises')
    expect(session).not.toHaveProperty('squashDetails')
  })

  it('is intentionally smaller than week_creator because repairWeek hydrates details', async () => {
    const { WEEK_CREATOR_RESPONSE_SCHEMA } = await import('../../weekCreator/weekCreatorResponseSchema')
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).not.toEqual(WEEK_CREATOR_RESPONSE_SCHEMA)
    expect(JSON.stringify(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).length)
      .toBeLessThan(JSON.stringify(WEEK_CREATOR_RESPONSE_SCHEMA).length)
  })
})

describe('PLAN_BUILDER_PAIR_RESPONSE_SCHEMA', () => {
  it('wraps two create_week schemas inside an actions array', () => {
    expect(PLAN_BUILDER_PAIR_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        actions: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
        },
      },
      required: ['actions'],
    })
  })
})
