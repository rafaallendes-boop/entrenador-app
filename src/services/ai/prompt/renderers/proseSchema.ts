import {
  ACTION_CONTRACTS,
  type ActionCatalogContext,
  type ActionContract,
  type ActionKind,
  type OutputContractDensity,
} from '../core/outputContract'

export function renderActionAsProse(
  action: ActionContract,
  density: OutputContractDensity,
): string {
  if (!action.prose) {
    throw new Error(`Action "${action.kind}" has no prose schema defined for density "${density}".`)
  }
  return action.prose[density].join('\n')
}

/**
 * Renders the "ACCIONES DISPONIBLES" section for an arbitrary subset of actions.
 * Each line follows the convention `- <action_name> — <fields>`.
 * Actions without a `catalog` function are skipped silently — callers control
 * which actions to include via the `kinds` array, so a missing catalog is not
 * an error, just an opt-out.
 */
export function renderActionCatalog(
  kinds: readonly ActionKind[],
  ctx: ActionCatalogContext = {},
): string {
  return kinds
    .map((kind) => ACTION_CONTRACTS[kind].catalog?.(ctx))
    .filter((line): line is string => Boolean(line && line.length > 0))
    .join('\n')
}

export function renderWeekCreatorTargetInstructions(
  action: ActionContract,
  targetWeekStart: string,
  structuredOutput = false,
): string[] {
  if (structuredOutput) {
    return [
      `Debes devolver EXACTAMENTE un objeto JSON ${action.kind} con targetDate=${targetWeekStart}.`,
      'No uses markdown, texto conversacional, code fences ni <actions>.',
    ]
  }

  return [
    `Debes devolver EXACTAMENTE una acción ${action.kind} con targetDate=${targetWeekStart}.`,
    'No devuelvas texto conversacional fuera de <actions>.',
  ]
}

export function renderWeekCreatorContractReminder(
  action: ActionContract,
  structuredOutput = false,
): string {
  if (structuredOutput) {
    return `Contrato de salida obligatorio: aunque la solicitud venga de un chip o sea breve, responde solo con un objeto JSON {"type":"${action.kind}", ...}.`
  }

  return `Contrato de salida obligatorio: aunque la solicitud venga de un chip o sea breve, responde solo con <actions>[{ "type": "${action.kind}", ... }]</actions> y no con texto libre.`
}
