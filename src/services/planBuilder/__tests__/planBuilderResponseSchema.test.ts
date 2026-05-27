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
