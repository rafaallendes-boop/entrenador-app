import type { ChatContext } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { buildWeekCreatorStructuredSystemPrompt } from '../week/prompts/weekPrompt'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'
import type { WeekCreatorFailure } from './WeekCreatorFailurePolicy'
import { buildWeekCreatorSkeletonSystemPrompt } from './WeekCreatorSkeletonPromptBuilder'
import type { WeekCreatorSkeleton } from './weekCreatorSkeleton'

type TargetedRepairPromptInput = {
  userMessage: string
  targetWeekStart: string
  planningStartDate: string
  weekEndDate: string
  config: WeekCreatorEffectiveConfig
  failure: WeekCreatorFailure
  failedResponse: CoachNormalizedResponse
  failedSkeleton?: WeekCreatorSkeleton
  skeletonOutput?: boolean
}

/**
 * A second model request is intentionally a correction request, not another
 * creative week generation. It carries only the failed object and the hard
 * scheduling/safety envelope needed to repair it.
 */
export function buildWeekCreatorTargetedRepairPrompt(
  context: ChatContext,
  input: TargetedRepairPromptInput,
): { systemPrompt: string; userPrompt: string } {
  const restrictions = [
    context.athleteProfile?.recoveryProfile?.restrictions?.trim(),
    input.config.injuryNotes?.trim(),
  ].filter((value): value is string => Boolean(value))

  const failedObject = JSON.stringify(input.failedSkeleton ?? {
    message: input.failedResponse.message,
    actions: input.failedResponse.actions ?? [],
  })

  return {
    systemPrompt: input.skeletonOutput
      ? buildWeekCreatorSkeletonSystemPrompt()
      : buildWeekCreatorStructuredSystemPrompt(),
    userPrompt: [
      'Corrige el objeto JSON fallido. No regeneres creativamente la semana ni agregues decisiones nuevas.',
      `Solicitud original: ${input.userMessage}`,
      `Código de validación: ${input.failure.code}`,
      `Error concreto: ${input.failure.error}`,
      'Envelope obligatorio:',
      `- targetDate: ${input.targetWeekStart}`,
      `- rango de sesiones: ${input.planningStartDate}..${input.weekEndDate}`,
      `- cantidad exacta: ${input.config.sessionsPerWeek}`,
      `- días permitidos: ${input.config.trainingDays.join(', ')}`,
      `- días dobles permitidos: ${(input.config.doubleSessionDays ?? []).join(', ') || 'ninguno'}`,
      `- restricciones horarias: ${input.config.scheduleConstraints?.trim() || 'ninguna'}`,
      `- deportes permitidos: ${input.config.allowedSports.join(', ')}`,
      `- deporte principal: ${input.config.primarySport ?? input.config.allowedSports[0] ?? 'no definido'}`,
      `- duración objetivo: ${input.config.sessionDurationMins} min`,
      `- fitness/fatiga: ${input.config.currentFitnessLevel}/${input.config.currentFatigue}`,
      `- restricciones activas: ${restrictions.join(' · ') || 'ninguna'}`,
      input.skeletonOutput
        ? 'Devuelve un solo esqueleto create_week corregido; no agregues ejercicios, drills ni detalles deportivos.'
        : 'Devuelve una sola acción create_week corregida y conserva todo campo válido del objeto original.',
      `Objeto fallido: ${failedObject}`,
    ].join('\n'),
  }
}
