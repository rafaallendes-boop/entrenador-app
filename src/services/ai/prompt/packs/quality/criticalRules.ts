export type QualityDensity = 'compact' | 'full'

export interface CriticalRulesInput {
  allowedSportsLabel: string
  density: QualityDensity
}

export function buildCriticalRulesSection(input: CriticalRulesInput): string {
  return input.density === 'compact'
    ? buildCompactCriticalRulesSection(input.allowedSportsLabel)
    : buildFullCriticalRulesSection(input.allowedSportsLabel)
}

function buildFullCriticalRulesSection(allowedSportsLabel: string): string {
  return `REGLAS CRÍTICAS:
1. Si el usuario pide "crear semana", "armar semana", "planificar semana", "dame la propuesta", "dame un plan", "dame la semana", "construye la semana", "hazme la semana", "qué hacemos esta semana", "propuesta de semana" → DEBES responder con create_week. No solo texto. No describas el plan y luego pidas confirmación — créalo directamente.
2. Si el usuario pide "agregar sesión", "pon un X el día Y", "agrega X" → DEBES responder con add_session. No solo texto.
3. Si el usuario pide "cambia los ejercicios", "agrégale X", "reemplaza", "mejora la propuesta", "incorpora X", "agrega running", "agrega squash", "baja squash", "sube running" o redistribuir la semana → DEBES priorizar update_session, move_session, replace_session_type o delete_session sobre add_session cuando la intención sea reemplazar o ajustar lo ya existente. No acumules sesiones o ejercicios viejos si la idea es sustituirlos.
4. Si falta contexto → asume valores razonables para el atleta y explícalo en 1 frase.
5. Si no hay sesiones en la semana → crea una semana base COMPLETA sin pedir confirmación.
6. NUNCA respondas con solo texto cuando se pidió una acción. Si describiste el plan en texto, DEBES incluir el bloque <actions> al final en la misma respuesta.
7. SOLO puedes usar deportes permitidos por la planificación actual: ${allowedSportsLabel}. Si running no está en esa lista, NO lo agregues.
8. Si el usuario pide "plan completo", "todas las semanas", "plan hasta el evento" o especifica semanas exactas con fechas de lunes → genera MÚLTIPLES acciones create_week EN EL MISMO bloque <actions>, UNA POR SEMANA. El array de acciones contendrá [create_week_s1, create_week_s2, ...create_week_sN]. Cada create_week tiene sus propias sessions[] con fechas absolutas dentro de esa semana, y sus weekObjectives. Mantén sesiones compactas pero útiles: omite warmup/cooldown (el sistema los genera automáticamente), en fuerza usa la densidad según duración (60 min suele necesitar 7-9 ejercicios entre zona media, fuerza, accesorios y cardio específico opcional), objectives en 1 frase. NO describas las semanas en texto y luego pongas solo 1-2 create_week — genera TODAS las semanas solicitadas como acciones.`
}

function buildCompactCriticalRulesSection(allowedSportsLabel: string): string {
  return `REGLAS CRÍTICAS:
1. Si el usuario pide crear/armar/planificar la semana → DEBES responder con create_week.
2. Si pide agregar una sesión puntual → add_session. Si pide ajustar lo existente → update_session, move_session, replace_session_type o delete_session antes que acumular sesiones.
3. Si falta contexto, asume algo razonable y dilo en 1 frase.
4. Si la semana está vacía, crea una semana base completa sin pedir confirmación.
5. NUNCA respondas solo con texto cuando se pidió una acción; cierra con <actions>.
6. Usa solo deportes permitidos: ${allowedSportsLabel}.
7. Si el usuario pide varias semanas o un plan completo, genera múltiples acciones create_week en el mismo bloque <actions>.
8. Mantén las sesiones compactas: objectives breves y warmup/cooldown opcionales; en fuerza usa densidad según duración (60 min suele requerir 7-9 ejercicios entre zona media, fuerza, accesorios y cardio específico opcional).`
}
