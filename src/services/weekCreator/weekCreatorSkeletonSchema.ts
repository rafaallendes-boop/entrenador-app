import {
  WEEK_CREATOR_SKELETON_RUNNING_TYPES,
  WEEK_CREATOR_SKELETON_SESSION_TYPES,
  WEEK_CREATOR_SKELETON_SQUASH_KINDS,
  WEEK_CREATOR_SKELETON_SQUASH_SUBTYPES,
  WEEK_CREATOR_SKELETON_TIME_BLOCKS,
} from './weekCreatorSkeleton'

/**
 * Provider-neutral schema for the compact Week Creator v2 response.
 *
 * It intentionally uses only the JSON Schema/OpenAPI subset supported by the
 * app's OpenAI, Anthropic and Gemini schema normalizers. Gemini drops
 * additionalProperties; standard providers retain it.
 */
export const WEEK_CREATOR_SKELETON_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  additionalProperties: false,
  properties: {
    type: { type: 'STRING', enum: ['create_week'] },
    reason: { type: 'STRING' },
    targetDate: { type: 'STRING' },
    weekObjectives: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    sessions: {
      type: 'ARRAY',
      minItems: 1,
      items: {
        type: 'OBJECT',
        additionalProperties: false,
        properties: {
          date: { type: 'STRING' },
          timeBlock: { type: 'STRING', enum: WEEK_CREATOR_SKELETON_TIME_BLOCKS },
          sessionType: { type: 'STRING', enum: WEEK_CREATOR_SKELETON_SESSION_TYPES },
          durationMin: { type: 'INTEGER', minimum: 5 },
          rpe: { type: 'INTEGER', minimum: 1, maximum: 10 },
          focusKey: { type: 'STRING' },
          title: { type: 'STRING' },
          objective: { type: 'STRING' },
          squashKind: { type: 'STRING', enum: WEEK_CREATOR_SKELETON_SQUASH_KINDS },
          subtype: { type: 'STRING', enum: WEEK_CREATOR_SKELETON_SQUASH_SUBTYPES },
          runningType: { type: 'STRING', enum: WEEK_CREATOR_SKELETON_RUNNING_TYPES },
        },
        required: [
          'date',
          'timeBlock',
          'sessionType',
          'durationMin',
          'rpe',
          'focusKey',
          'title',
          'objective',
        ],
      },
    },
  },
  required: ['type', 'reason', 'targetDate', 'sessions'],
}
