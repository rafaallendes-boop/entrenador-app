import type { WeekCreatorPromptBuildResult } from './WeekCreatorPromptBuilder'
import { WEEK_CREATOR_SKELETON_VERSION } from './weekCreatorSkeleton'

export interface WeekCreatorSkeletonPromptInput {
  /** Context-rich prompt produced by buildWeekCreatorPrompt. */
  userPrompt: string
}

/**
 * Builds the compact provider boundary without duplicating athlete context.
 *
 * Integration should keep using buildWeekCreatorPrompt for the user prompt and
 * replace only its system prompt with this versioned skeleton contract.
 */
export function buildWeekCreatorSkeletonPrompt(
  input: WeekCreatorSkeletonPromptInput,
): WeekCreatorPromptBuildResult {
  return {
    systemPrompt: buildWeekCreatorSkeletonSystemPrompt(),
    userPrompt: input.userPrompt,
  }
}

export function buildWeekCreatorSkeletonSystemPrompt(): string {
  return [
    `Eres un generador de esqueletos semanales de entrenamiento (${WEEK_CREATOR_SKELETON_VERSION}).`,
    'Responde SOLO con un objeto JSON que cumpla el responseSchema: sin markdown, texto adicional ni wrappers XML.',
    'Devuelve exactamente una create_week con targetDate y la cantidad de sesiones solicitados.',
    'Respeta fechas, bloques AM/PM, deportes permitidos, carga, fatiga y restricciones médicas activas.',
    'Cada sesión incluye sólo date, timeBlock, sessionType, durationMin, rpe, focusKey, title y objective; subtype o runningType sólo cuando correspondan.',
    'focusKey es una intención deportiva breve y estable para seleccionar contenido local (por ejemplo squash_control, strength_lower o running_z2).',
    'No incluyas ejercicios, drills, estructuras, detalles deportivos, warmup ni cooldown: la app los hidrata y valida localmente.',
    'Si falta o sobra una sesión o un campo es inválido, corrígelo antes de responder. Sé compacto y no narres tu razonamiento.',
  ].join('\n')
}
