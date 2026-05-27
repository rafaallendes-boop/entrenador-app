import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { renderActionAsJsonSchema } from '../ai/prompt/renderers/jsonSchema'

/**
 * Schema reused for plan_builder_week structured output.
 * Identical to WEEK_CREATOR_RESPONSE_SCHEMA: both consume create_week contract.
 * Defined here to keep plan_builder ownership of its provider config clear.
 */
export const PLAN_BUILDER_WEEK_RESPONSE_SCHEMA: Record<string, unknown> = renderActionAsJsonSchema(
  ACTION_CONTRACTS.create_week,
)

/**
 * Schema for plan_builder_pair: response is `{ actions: [create_week, create_week] }`.
 * Two create_week objects expected, one per requested week.
 */
export const PLAN_BUILDER_PAIR_RESPONSE_SCHEMA: Record<string, unknown> = {
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
}
