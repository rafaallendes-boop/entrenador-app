import type { PlanWizardConfig } from '../../types'
import { resolveGoalEventWindow, type GoalEventWindowInput } from '../goalEventWindow'

/**
 * Identidad de un draft para decidir si un shell ya construido sigue sirviendo.
 *
 * Incluye la **ventana** del evento, no sólo su id: el shell se construye desde
 * el calendario, así que mover inicio, término o día clave lo invalida aunque
 * el id y la configuración del wizard no cambien. La ventana se normaliza con el
 * resolver para que un término redundante —igual al inicio— no cuente como
 * cambio y fuerce una regeneración inútil.
 */
export function buildDraftSignature(input: {
  goalEventId: string
  wizardConfig: PlanWizardConfig
  event: GoalEventWindowInput
}): string {
  // Los timestamps quedan fuera para que repetir el wizard con los mismos
  // ajustes reutilice el draft existente.
  const stableConfig: Partial<PlanWizardConfig> = { ...input.wizardConfig }
  delete stableConfig.createdAt
  delete stableConfig.updatedAt

  return JSON.stringify({
    goalEventId: input.goalEventId,
    wizardConfig: stableConfig,
    eventWindow: resolveGoalEventWindow(input.event),
  })
}
