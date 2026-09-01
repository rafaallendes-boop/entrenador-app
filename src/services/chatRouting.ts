import type { ChatContext } from '../types'
import { currentWeekStartISO, fromISO, nextWeek, toISO } from '../utils/date'

export type ChatRouteKind =
  | 'chat_general'
  | 'chat_action'
  | 'week_creator'
  | 'weekly_summary'
  | 'plan_builder_redirect'

export interface ChatRouteResolution {
  kind: ChatRouteKind
  targetWeekStart?: string
}

const WEEKDAY_PATTERN = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)\b/
const WEEK_PLANNING_VERB_PATTERN = /\b(crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|planifica(?:r)?|organiza(?:r)?|programa(?:r)?|propuesta|dame|entrega(?:me)?)\b/
const WEEK_PLANNING_TARGET_PATTERN = /\b(semana|microciclo|propuesta\s+de\s+semana|plan(?:\s+de\s+entrenamiento)?)\b/
const FULL_PLAN_PATTERN = /\b(plan\s+completo|todas\s+las\s+semanas|plan\s+hasta|semanas\s+hasta|hasta\s+el\s+evento|hasta\s+la\s+competencia|hasta\s+el\s+torneo|completo\s+hasta|completo\s+para\s+\d+\s+semanas)\b/
const MULTI_WEEK_PATTERN = /\b(?:[2-9]|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\s+semanas\b/
const SUMMARY_PATTERN = /\b(resumen\s+semanal|coach\s+note|resume\s+mi\s+semana|resumeme\s+la\s+semana|cierre\s+de\s+semana|balance\s+semanal)\b/
const ADJUSTMENT_VERB_PATTERN = /\b(ajusta(?:r|me)?|ajustame|cambia(?:r|me)?|cambiame|cambie|modifica(?:r|me)?|modificame|mueve|mueveme|mover|pasa(?:r|me)?|reprograma(?:r|me)?|reordena(?:r|me)?|actualiza(?:r|me)?|quit(?:a|ar|ame)|borra(?:r|me)?|borrame|elimina(?:r|me)?|eliminame|saca(?:r|me)?|sacame|pon(?:er|me)?|agrega(?:r|me)?|reemplaza(?:r|me)?|reduce|baja|sube|incorpora)\b/
const SESSION_TARGET_PATTERN = /\b(sesion(?:es)?|entreno|entrenamiento|descanso|libre|off|running|squash|fuerza|pesas|gym|gimnasio|strength|cycling|ciclismo|bici|movilidad|recovery|recuperacion|am|pm)\b/
const NEXT_WEEK_PATTERN = /\b(proxima\s+semana|siguiente\s+semana)\b/
const CURRENT_WEEK_PATTERN = /\b(esta\s+semana|semana\s+actual)\b/
// "lunes de la próxima semana" is a temporal qualifier, not a request to
// generate the whole week. Treat a week word as scope only when it follows the
// planning verb directly ("créame una semana", "arma el plan").
const EXPLICIT_WEEK_SCOPE_PATTERN = /\b(?:crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|planifica(?:r)?|organiza(?:r)?|programa(?:r)?|propuesta|dame|entrega(?:me)?)(?:\s+\w+){0,4}\s+\b(?:semana|microciclo|plan(?:\s+de\s+entrenamiento)?)\b/
// Verbos con lectura *inequívoca* de creación. Deliberadamente más angosto que
// WEEK_PLANNING_VERB_PATTERN: "dame", "entrégame" y "propuesta" sirven igual
// para pedir información ("dame feedback de mi sesión"), y sin un día explícito
// no hay forma de distinguir crear de preguntar. Si la frase trae día, la
// resuelve antes `isSpecificDaySessionRequest` y este patrón no participa.
// Sustantivo de sesión en plural. Es la señal que separa "créame una sesión de
// pesas para la próxima semana" (una acción) de "créame las sesiones de la
// próxima semana" (una semana): el verbo y el objeto son los mismos y sólo
// cambia el número.
// Verbos ambiguos: piden tanto crear como saber ("dame una sesión de pesas" vs
// "dame feedback de mi sesión"). Sólo cuentan como creación cuando el objeto es
// INDEFINIDO, que es la lectura que no admite pregunta.
const SOFT_CREATION_VERB_PATTERN = /\b(quiero|necesito|dame|damelo|entregame)\b/
const INDEFINITE_SESSION_OBJECT_PATTERN = /\b(?:una|un|otra|otro)\s+(?:\w+\s+){0,2}(?:sesion|entreno|entrenamiento|running|squash|fuerza|pesas|gym|gimnasio|cycling|ciclismo|bici|movilidad|rutina)\b/
const PLURAL_SESSION_PATTERN = /\b(sesiones|entrenamientos|entrenos|rutinas)\b/
const SESSION_CREATION_VERB_PATTERN = /\b(crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|programa(?:r|me)?|agenda(?:me)?|agrega(?:r|me)?|pon(?:er|me)?|incorpora(?:me)?)\b/
// Include short object-pronoun imperatives ("créala", "hazlo") because users
// commonly confirm the session the coach just described with a one-word reply.
// Without this, those replies fall through to chat_general and can only produce
// prose, even though the preceding turn was asking to create a session.
const ACTION_CONFIRMATION_PATTERN = /\b(si|sí|ok|okay|dale|confirmo|correcto|hazlo|hacelo|crea(?:la|lo)?|aplica(?:lo)?|aplicar|realiza(?:r)?(?:\s+el)?\s+cambio|procede|adelante)\b/
const RECENT_ACTION_DISCUSSION_PATTERN = /\b(confirmas?|quieres?|quiero|cambio|cambiar|reemplaza(?:r)?|reemplazo|elimina(?:r)?|eliminar|borra(?:r)?|borrar|saca(?:r)?|sacar|ajusta(?:r)?|modifica(?:r)?|sesion|entreno|entrenamiento|running|corrida|trote|squash|zona\s*2|z2)\b/
// Una pregunta que pide criterio no debe escalar a `chat_action` sólo porque
// nombra una sesión y un día. Ese camino exige una propuesta estructurada; al
// forzarlo sobre una consulta como "¿Qué debería priorizar hoy?" se descarta
// una respuesta de asesoría perfectamente válida por no traer `<actions>`.
const ADVISORY_QUESTION_PATTERN = /^[¿?\s]*(?:que|como|cual|cuanto|cuando|donde|por que|para que)\b.*\b(?:deberia|recomiendas?|priorizar|conviene|mejor)\b/
// `conviene` y `mejor` también aparecen en peticiones de acción ("¿qué sesión me
// conviene mover al jueves?"), así que la forma interrogativa por sí sola no
// basta para desviar a prosa: sin este guard, "sacar", "mover" y "cambio"
// dejaban de producir propuesta. Se compone desde las mismas fuentes de verbos
// que usan las ramas de acción para que ampliar una amplíe también el guard, y
// agrega las conjugaciones que ninguna de las dos cubre porque allí el usuario
// siempre habla en imperativo: primera persona ("¿cómo cambio mi sesión?") y
// segunda en subjuntivo ("¿qué conviene que agregues?").
const CONJUGATED_MUTATION_PATTERN = /\b(cambio|muevo|saco|quito|agrego|pongo|elimino|borro|reemplazo|ajusto|modifico|programo|armo|genero)\b|\b(cambies|muevas|saques|quites|agregues|pongas|elimines|borres|reemplaces|ajustes|modifiques|programes|armes|generes)\b/
// Los patrones de acción están escritos en imperativo porque ahí el usuario
// manda ("agenda el jueves"). En una pregunta el mismo verbo aparece en
// infinitivo ("¿qué me conviene agendar el jueves?"), forma que ninguno de los
// dos cubre: sin esto, una petición real de cambio se desviaba a prosa y ya no
// podía emitir una propuesta.
// Deliberadamente NO incluye `hacer`: es el verbo más genérico del idioma y
// "¿qué debería hacer hoy?" es exactamente la consulta de asesoría que este
// desvío existe para permitir.
const INFINITIVE_MUTATION_PATTERN = /\b(agendar|armar|incorporar|reducir|bajar|subir|acortar|alargar|adelantar|atrasar|intercambiar|dividir)\b/
const MUTATION_INTENT_PATTERN = new RegExp([
  ADJUSTMENT_VERB_PATTERN.source,
  SESSION_CREATION_VERB_PATTERN.source,
  CONJUGATED_MUTATION_PATTERN.source,
  INFINITIVE_MUTATION_PATTERN.source,
].join('|'))

export function resolveChatRoute(
  message: string,
  context?: ChatContext,
): ChatRouteResolution {
  const normalized = normalizeRoutingText(message)
  const targetWeekStart = resolveRequestedWeekStart(normalized)

  if (SUMMARY_PATTERN.test(normalized) || context?.intent === 'weekly_summary') {
    return { kind: 'weekly_summary' }
  }

  if (FULL_PLAN_PATTERN.test(normalized) || MULTI_WEEK_PATTERN.test(normalized)) {
    return { kind: 'plan_builder_redirect', targetWeekStart }
  }

  if (isActionConfirmation(normalized) && hasRecentActionDiscussion(context)) {
    return { kind: 'chat_action' }
  }

  if (ADVISORY_QUESTION_PATTERN.test(normalized) && !MUTATION_INTENT_PATTERN.test(normalized)) {
    return { kind: 'chat_general' }
  }

  const isSpecificDaySessionRequest =
    WEEKDAY_PATTERN.test(normalized)
    && SESSION_TARGET_PATTERN.test(normalized)
    && !EXPLICIT_WEEK_SCOPE_PATTERN.test(normalized)

  if (
    ADJUSTMENT_VERB_PATTERN.test(normalized)
    && (
      SESSION_TARGET_PATTERN.test(normalized)
      || WEEKDAY_PATTERN.test(normalized)
      || /\b(semana|plan|carga)\b/.test(normalized)
    )
  ) {
    return { kind: 'chat_action' }
  }

  if (WEEK_PLANNING_VERB_PATTERN.test(normalized) && isSpecificDaySessionRequest) {
    return { kind: 'chat_action' }
  }

  // Single-session creation requests: a weekday + a sport, with no week-level target,
  // should always reach the action engine even when the verb is colloquial
  // ("ponme un running el viernes", "haceme squash mañana", "quiero una sesión de fuerza el lunes").
  if (isSpecificDaySessionRequest) {
    return { kind: 'chat_action' }
  }

  // Una petición de crear UNA sesión que nombra la semana sólo como calificador
  // temporal ("créame una sesión de pesas para la próxima semana") no es una
  // planificación semanal. `EXPLICIT_WEEK_SCOPE_PATTERN` ya distingue scope de
  // calificador, pero hasta acá sólo se consultaba dentro de
  // `isSpecificDaySessionRequest`, que exige un día de la semana; sin día, el
  // guard nunca corría y la petición terminaba en el motor de semana completa.
  // Cubre también el caso sin referencia temporal alguna, que caía a
  // chat_general y sólo podía responder en prosa.
  const hasCreationVerb = SESSION_CREATION_VERB_PATTERN.test(normalized)
    || (SOFT_CREATION_VERB_PATTERN.test(normalized) && INDEFINITE_SESSION_OBJECT_PATTERN.test(normalized))

  if (
    hasCreationVerb
    && SESSION_TARGET_PATTERN.test(normalized)
    && !PLURAL_SESSION_PATTERN.test(normalized)
    && !EXPLICIT_WEEK_SCOPE_PATTERN.test(normalized)
  ) {
    return { kind: 'chat_action' }
  }

  const isWeekPlanningRequest =
    WEEK_PLANNING_VERB_PATTERN.test(normalized)
    && (
      WEEK_PLANNING_TARGET_PATTERN.test(normalized)
      || CURRENT_WEEK_PATTERN.test(normalized)
      || NEXT_WEEK_PATTERN.test(normalized)
      || /\b(que\s+hacemos\s+esta\s+semana|qué\s+hacemos\s+esta\s+semana)\b/.test(normalized)
    )

  if (isWeekPlanningRequest) {
    return {
      kind: 'week_creator',
      targetWeekStart,
    }
  }

  if (context?.intent === 'adjust_session') {
    return { kind: 'chat_action' }
  }

  if (context?.intent === 'plan_week') {
    return { kind: 'week_creator', targetWeekStart }
  }

  return { kind: 'chat_general' }
}

function isActionConfirmation(normalized: string): boolean {
  if (!ACTION_CONFIRMATION_PATTERN.test(normalized)) return false
  return normalized.length <= 80 && !/\b(porque|pero|aunque|opino|creo|pregunta|duda)\b/.test(normalized)
}

function hasRecentActionDiscussion(context?: ChatContext): boolean {
  const recent = context?.recentMessages?.slice(-8) ?? []
  if (recent.length === 0) return false
  const text = normalizeRoutingText(recent.map(message => message.content).join('\n'))
  return RECENT_ACTION_DISCUSSION_PATTERN.test(text)
}

export function resolveRequestedWeekStart(message: string): string {
  const normalized = normalizeRoutingText(message)
  const currentWeekStart = currentWeekStartISO()
  if (NEXT_WEEK_PATTERN.test(normalized)) {
    return toISO(nextWeek(fromISO(currentWeekStart)))
  }
  return currentWeekStart
}

function normalizeRoutingText(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\ba\s*hoy\b/g, 'hoy')
    .replace(/\bahoy\b/g, 'hoy')
    .replace(/\bmanan[ao]\b/g, 'manana')
    .replace(/\bsabado\b/g, 'sabado')
}
