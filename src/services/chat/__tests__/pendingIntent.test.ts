import { describe, expect, it } from 'vitest'
import { PENDING_INTENT_TTL_MS, pendingIntentFromEvents, resolvePendingIntentDecision } from '../pendingIntent'

const scope = { athleteId: 'ath_a', conversationId: 'conv-1' }
const now = 1_000_000
// Lunes real (2026-09-14 es lunes): cualquier caso que resuelva un token de
// día de la semana contra sesiones fechadas en 2026 necesita crear Y evaluar
// la intención en el mismo dominio de reloj — `now` (1_000_000, época 1970)
// sólo sirve para los casos que no dependen de fecha real.
const monday = new Date('2026-09-13T12:00:00').getTime()

const offer = () => pendingIntentFromEvents(
  [{ kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Armar la semana' }], scope, now,
)!
const clarification = () => pendingIntentFromEvents(
  [{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }], scope, now,
)!
/** Misma aclaración, pero anclada al reloj real que también usará la decisión. */
const clarificationAtMonday = () => pendingIntentFromEvents(
  [{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }], scope, monday,
)!

describe('pendingIntent', () => {
  it('crea una oferta abierta con vencimiento y pertenencia', () => {
    expect(offer()).toMatchObject({ kind: 'generation_offer', status: 'open', route: 'week_creator', athleteId: 'ath_a', conversationId: 'conv-1', expiresAt: now + PENDING_INTENT_TTL_MS })
  })

  it('"dale" consume la oferta y conserva su semana objetivo', () => {
    expect(resolvePendingIntentDecision('dale', offer(), scope, now + 1)).toEqual({ kind: 'consume', route: 'week_creator', targetWeekStart: '2026-09-14' })
  })

  it('una confirmación de otro atleta o conversación no consume', () => {
    expect(resolvePendingIntentDecision('si', offer(), { athleteId: 'ath_b', conversationId: 'conv-1' }, now + 1)).toEqual({ kind: 'none' })
    expect(resolvePendingIntentDecision('si', offer(), { athleteId: 'ath_a', conversationId: 'conv-2' }, now + 1)).toEqual({ kind: 'none' })
  })

  it('vencida no consume', () => {
    expect(resolvePendingIntentDecision('si', offer(), scope, now + PENDING_INTENT_TTL_MS + 1)).toEqual({ kind: 'none' })
  })

  it('"no, solo explicame" cancela', () => {
    expect(resolvePendingIntentDecision('no, solo explicame', offer(), scope, now + 1)).toEqual({ kind: 'cancel' })
  })

  it.each(['cuanto deberia dormir esta semana', 'que deberia comer el lunes', 'no dormi bien, que recomiendas'])('una pregunta nueva no completa ni cancela: %s', (message) => {
    expect(resolvePendingIntentDecision(message, clarification(), scope, now + 1)).toEqual({ kind: 'none' })
    expect(resolvePendingIntentDecision(message, offer(), scope, now + 1)).toEqual({ kind: 'none' })
  })

  it('una oferta consumida no se vuelve a consumir', () => {
    const consumed = { ...offer(), status: 'consumed' as const }
    expect(resolvePendingIntentDecision('si', consumed, scope, now + 1)).toEqual({ kind: 'already_consumed' })
  })

  it('"sí" cuando falta la sesión vuelve a pedirla', () => {
    expect(resolvePendingIntentDecision('si', clarification(), scope, now + 1, [])).toMatchObject({ kind: 'fill', missing: ['sessionId'], candidates: [] })
  })

  it('conversación en dos turnos: "la del lunes" deja candidatos y "PM" basta para resolver', () => {
    const planned = [session('s-am', '2026-09-14', 'AM', 'Squash'), session('s-pm', '2026-09-14', 'PM', 'Fuerza')]
    const intent = clarificationAtMonday()
    const first = resolvePendingIntentDecision('la del lunes', intent, scope, monday, planned)
    expect(first).toMatchObject({ kind: 'fill', missing: ['sessionId'] })
    if (first.kind !== 'fill') throw new Error('esperaba fill')
    expect(first.operation).toMatchObject({ candidates: [{ id: 's-am' }, { id: 's-pm' }] })
    // El store guarda `first.operation`; el turno siguiente parte de ahí.
    const second = resolvePendingIntentDecision('pm', { ...intent, operation: first.operation }, scope, monday + 1, planned)
    expect(second).toMatchObject({ kind: 'consume', route: 'chat_action', operation: { known: { sessionId: 's-pm', targetDate: '2026-09-18' }, missing: [] } })
  })

  it('un dato parcialmente resuelto no se pierde entre turnos', () => {
    const askBoth = {
      ...clarificationAtMonday(),
      operation: { type: 'move_session' as const, known: {}, missing: ['sessionId', 'targetDate'] },
    }
    const first = resolvePendingIntentDecision('al viernes', askBoth, scope, monday, [])
    if (first.kind !== 'fill') throw new Error('esperaba fill')
    expect(first.operation).toMatchObject({ known: { targetDate: '2026-09-18' }, missing: ['sessionId'] })
  })

  it('"la del lunes" resuelve el referente si hay exactamente una sesión ese día y consume la operación completa', () => {
    // Dos "lunes" distintos en el horizonte de planificación (típico: 2-3
    // semanas de microciclo): sólo el de la semana resuelta por `resolveDateToken`
    // (2026-09-14, a partir de `monday`) puede ganar. Si el match fuera por
    // día-de-semana nomás, s-mon-next-week entraría también y esto sería `fill`.
    const planned = [
      session('s-mon', '2026-09-14', 'AM', 'Squash técnico'),
      session('s-mon-next-week', '2026-09-21', 'AM', 'Squash técnico'),
      session('s-tue', '2026-09-15', 'AM', 'Fuerza'),
    ]
    const decision = resolvePendingIntentDecision('la del lunes', clarificationAtMonday(), scope, monday, planned)
    expect(decision).toEqual({ kind: 'consume', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18', sessionId: 's-mon' }, missing: [] } })
  })

  it('"la del lunes" con dos sesiones ese día pide la franja y devuelve candidatos', () => {
    const planned = [session('s-am', '2026-09-14', 'AM', 'Squash'), session('s-pm', '2026-09-14', 'PM', 'Fuerza')]
    const decision = resolvePendingIntentDecision('la del lunes', clarificationAtMonday(), scope, monday, planned)
    expect(decision).toMatchObject({ kind: 'fill', missing: ['sessionId'] })
    if (decision.kind === 'fill') expect(decision.candidates.map(c => c.id)).toEqual(['s-am', 's-pm'])
  })

  it('"la del lunes PM" desambigua por franja', () => {
    const planned = [session('s-am', '2026-09-14', 'AM', 'Squash'), session('s-pm', '2026-09-14', 'PM', 'Fuerza')]
    const decision = resolvePendingIntentDecision('la del lunes pm', clarificationAtMonday(), scope, monday, planned)
    expect(decision).toMatchObject({ kind: 'consume', operation: { known: { sessionId: 's-pm' } } })
  })

  it('"la del lunes PM" no cruza semanas: dos "lunes PM" en el horizonte no colapsan a uno solo', () => {
    // Guard contra la regresión que el review encontró: un match por
    // día-de-semana (en vez de por fecha absoluta) podía tomar el PM de la
    // semana equivocada cuando había un AM en la semana resuelta y un PM en
    // otra semana. Acá hay un PM en la semana correcta (2026-09-14) y otro en
    // la semana siguiente (2026-09-21): sólo el primero debe calificar.
    const planned = [
      session('s-mon-am', '2026-09-14', 'AM', 'Squash'),
      session('s-mon-pm', '2026-09-14', 'PM', 'Fuerza'),
      session('s-mon-pm-next-week', '2026-09-21', 'PM', 'Fuerza'),
    ]
    const decision = resolvePendingIntentDecision('la del lunes pm', clarificationAtMonday(), scope, monday, planned)
    expect(decision).toEqual({ kind: 'consume', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18', sessionId: 's-mon-pm' }, missing: [] } })
  })

  it('una aclaración ya completa sólo se consume ante una respuesta compatible', () => {
    const complete = { ...clarification(), operation: { type: 'move_session' as const, known: { targetDate: '2026-09-18', sessionId: 's1' }, missing: [] } }
    expect(resolvePendingIntentDecision('si', complete, scope, now + 1, [])).toMatchObject({ kind: 'consume', route: 'chat_action' })
    expect(resolvePendingIntentDecision('muevela al viernes', complete, scope, now + 1, [])).toMatchObject({ kind: 'consume', route: 'chat_action' })
    // Una pregunta nueva no consume: sigue su ruta normal y la intención queda abierta.
    expect(resolvePendingIntentDecision('cuanto deberia dormir esta semana', complete, scope, now + 1, [])).toEqual({ kind: 'none' })
  })
})

function session(id: string, date: string, timeBlock: 'AM' | 'PM', title: string) {
  return { id, date, weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const, title, durationMin: 60, createdAt: 0, updatedAt: 0 }
}
