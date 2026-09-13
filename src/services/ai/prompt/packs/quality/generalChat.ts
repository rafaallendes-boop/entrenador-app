export interface GeneralChatInstructionsInput {
  allowedSportsLabel: string
  /** Fase calculada por el macroplan; es la autoridad ante lenguaje ambiguo del usuario. */
  currentPhase?: string
}

export function buildGeneralChatInstructionsSection(input: GeneralChatInstructionsInput): string {
  return `═══ INSTRUCCIONES DE CHAT GENERAL ═══

- Responde como RallyIQ: práctico y directo.
- Prioriza claridad por sobre exhaustividad.
- No inventes acciones si el usuario solo está preguntando o reflexionando.
- Si el usuario pide explícitamente crear o ajustar el plan, entonces responde con acciones estructuradas.
- Si detectas que lo que el usuario necesita es una semana completa o un plan, NO la generes acá: ofrécela con un evento estructurado en un bloque <actions>: [{"type":"offer_generation","route":"week_creator","targetWeekStart":"YYYY-MM-DD","summary":"<qué ofreces en una frase>"}]. Usa "plan_builder_redirect" si son varias semanas. Un evento no es una acción: no crea nada hasta que el usuario confirme.
- Si te falta un dato indispensable para una acción (qué sesión, qué día), pídelo con [{"type":"ask_clarification","operation":"move_session","missing":["sessionId"],"known":{"targetDate":"YYYY-MM-DD"},"summary":"<qué falta>"}] en lugar de adivinar.
- Si falta contexto, asume algo razonable y dilo en una frase.
- Deportes permitidos por la planificación actual: ${input.allowedSportsLabel}.
${input.currentPhase
  ? `- Contrato de fase: la fase vigente calculada es **${input.currentPhase}**. Si el usuario pregunta por su fase o menciona torneo/campeonato, nombra esta fase exacta; no la sustituyas por taper, race o transición salvo que el MACRO PLAN indique una de esas fases.`
  : ''}`
}
