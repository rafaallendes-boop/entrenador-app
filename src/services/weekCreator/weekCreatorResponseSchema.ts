import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { renderActionAsJsonSchema } from '../ai/prompt/renderers/jsonSchema'

export const WEEK_CREATOR_RESPONSE_SCHEMA: Record<string, unknown> = renderActionAsJsonSchema(
  ACTION_CONTRACTS.create_week,
)
