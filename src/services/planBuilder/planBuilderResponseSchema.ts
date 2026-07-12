/**
 * Compact structured output for Plan Builder.
 *
 * Claude only decides the weekly skeleton. Sport-specific details (strength
 * exercises, squash drills, mobility/cycling structures and warmups) are
 * hydrated deterministically by repairWeek; general warmup/cooldown protocols
 * are added by applyCreateWeek when the plan is accepted. Keeping those fields
 * out reduces schema input and repeated output without weakening the final
 * session contract.
 */
export const PLAN_BUILDER_WEEK_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['create_week'] },
    reason: { type: 'string' },
    targetDate: { type: 'string' },
    weekObjectives: { type: 'array', items: { type: 'string' } },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          timeBlock: { type: 'string', enum: ['AM', 'PM'] },
          sessionType: {
            type: 'string',
            enum: ['squash', 'running', 'cycling', 'strength', 'mobility', 'recovery'],
          },
          title: { type: 'string' },
          durationMin: { type: 'integer' },
          rpe: { type: 'integer', minimum: 1, maximum: 10 },
          objective: { type: 'string' },
          subtype: { type: 'string', enum: ['training', 'match', 'competitive', 'control', 'light'] },
          runningType: { type: 'string', enum: ['z2', 'tempo', 'intervals', 'long'] },
        },
        required: ['date', 'timeBlock', 'sessionType', 'title', 'durationMin', 'rpe', 'objective'],
      },
    },
  },
  required: ['type', 'reason', 'targetDate', 'sessions'],
}

/**
 * Schema for plan_builder_pair: response is `{ actions: [create_week, create_week] }`.
 * Two create_week objects expected, one per requested week.
 */
export const PLAN_BUILDER_PAIR_RESPONSE_SCHEMA: Record<string, unknown> = {
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
}
