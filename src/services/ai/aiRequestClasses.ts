import type { AIRequestClass } from '../../types'

/**
 * Enumeración exhaustiva y ejecutable de las clases de request. Una unión de
 * TypeScript no existe en runtime y no se puede recorrer: `satisfies` obliga a
 * que esta lista esté completa al compilar, y `Object.keys` la hace iterable
 * al testear.
 */
export const ALL_AI_REQUEST_CLASSES = {
  chat_general: true,
  chat_action: true,
  weekly_summary: true,
  week_creator: true,
  plan_builder_week: true,
  plan_builder_pair: true,
  import_extract: true,
  coach_assistant_message: true,
} satisfies Record<AIRequestClass, true>
