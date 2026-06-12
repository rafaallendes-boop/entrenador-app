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

  it('constrains squash and session enums so the provider cannot invent values', () => {
    type SchemaNode = {
      enum?: string[]
      items?: SchemaNode
      properties?: Record<string, SchemaNode>
    }
    const session = (PLAN_BUILDER_WEEK_RESPONSE_SCHEMA as {
      properties: { sessions: { items: { properties: Record<string, SchemaNode> } } }
    }).properties.sessions.items.properties

    expect(session.subtype.enum).toEqual(['training', 'match', 'competitive', 'control', 'light'])
    expect(session.runningType.enum).toEqual(['z2', 'tempo', 'intervals', 'long'])
    expect(session.exercises.items.properties?.group.enum).toEqual(['push', 'pull', 'legs', 'core', 'olympic', 'cardio', 'mobility', 'other'])
    expect(session.squashDetails.properties?.trainingFocus.enum).toEqual(['technical', 'tactical', 'physical', 'conditioned_games'])
    expect(session.squashDetails.properties?.sessionMode.enum).toEqual(['drill_session', 'practice_match', 'competition_match'])
    expect(session.squashDetails.properties?.sessionKind.enum).toEqual(['technical', 'control', 'shadows', 'match', 'mixed'])
  })

  it('matches the schema used by week_creator (single source of truth)', async () => {
    const { WEEK_CREATOR_RESPONSE_SCHEMA } = await import('../../weekCreator/weekCreatorResponseSchema')
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toEqual(WEEK_CREATOR_RESPONSE_SCHEMA)
  })
})

describe('PLAN_BUILDER_PAIR_RESPONSE_SCHEMA', () => {
  it('wraps two create_week schemas inside an actions array', () => {
    expect(PLAN_BUILDER_PAIR_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
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
