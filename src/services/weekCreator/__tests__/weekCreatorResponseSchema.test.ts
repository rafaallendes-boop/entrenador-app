import { describe, expect, it } from 'vitest'

import { WEEK_CREATOR_RESPONSE_SCHEMA } from '../weekCreatorResponseSchema'

type JsonSchemaNode = {
  type?: string
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  enum?: string[]
  items?: JsonSchemaNode
}

function getSessionProperties(): Record<string, JsonSchemaNode> {
  const root = WEEK_CREATOR_RESPONSE_SCHEMA as JsonSchemaNode
  const sessions = root.properties?.sessions
  const sessionProperties = sessions?.items?.properties

  if (!sessionProperties) {
    throw new Error('WEEK_CREATOR_RESPONSE_SCHEMA.sessions.items.properties is missing')
  }

  return sessionProperties
}

describe('WEEK_CREATOR_RESPONSE_SCHEMA', () => {
  it('keeps cyclingDetails aligned with the app session contract', () => {
    const cyclingDetails = getSessionProperties().cyclingDetails

    expect(cyclingDetails.properties).toEqual(expect.objectContaining({
      sessionCategory: { type: 'STRING' },
      sessionFamily: { type: 'STRING' },
      targetStructure: { type: 'STRING' },
      intensityReference: { type: 'STRING' },
      executionNotes: { type: 'STRING' },
    }))
    expect(cyclingDetails.required).toEqual(['sessionCategory', 'targetStructure'])
    expect(cyclingDetails.properties).not.toHaveProperty('targetPowerMin')
    expect(cyclingDetails.properties).not.toHaveProperty('targetCadenceMin')
  })

  it('declares squash blocks with the kind discriminator the normalizer expects', () => {
    const squashDetails = getSessionProperties().squashDetails
    const block = squashDetails.properties?.blocks?.items

    expect(block?.properties).toHaveProperty('kind')
    expect(block?.properties?.kind).toEqual(expect.objectContaining({
      type: 'STRING',
      enum: expect.arrayContaining(['technical', 'control', 'shadows', 'match']),
    }))
    expect(block?.properties).not.toHaveProperty('label')
    expect(block?.required).toEqual(['kind', 'drills'])
  })

  it('keeps mobilityDetails aligned with the app session contract', () => {
    const mobilityDetails = getSessionProperties().mobilityDetails

    expect(mobilityDetails.properties).toEqual(expect.objectContaining({
      focusAreas: {
        type: 'ARRAY',
        items: { type: 'STRING' },
      },
      context: expect.objectContaining({
        type: 'STRING',
        enum: expect.arrayContaining(['post_run', 'post_cycling', 'post_strength', 'full_body']),
      }),
      targetStructure: { type: 'STRING' },
      executionNotes: { type: 'STRING' },
    }))
    expect(mobilityDetails.required).toEqual(['focusAreas', 'context', 'targetStructure'])
    expect(mobilityDetails.properties).not.toHaveProperty('durationPerAreaMin')
  })
})
