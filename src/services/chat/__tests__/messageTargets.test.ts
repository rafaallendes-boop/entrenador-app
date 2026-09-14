import { describe, expect, it } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import type { PendingIntent } from '../pendingIntent'
import {
  MAX_TARGETS_PER_OPERATION,
  buildTargetClarificationIntent,
  describeTargetClarification,
  readOnlyTargetsFromClarification,
  resolveMessageTargets,
  withTargetOverflowNotice,
} from '../messageTargets'

const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026
const scope = { athleteId: 'ath_a', conversationId: 'conv-1' }

function session(id: string, date: string, timeBlock: 'AM' | 'PM', type: Session['type'], title: string, status: Session['status'] = 'planned'): Session {
  return { id, date, weekStartDate: date, timeBlock, type, status, title, durationMin: 60, createdAt: 0, updatedAt: 0 } as Session
}
const S = {
  yesterday: session('s-yest', '2026-09-15', 'PM', 'squash', 'Partido contra Diego', 'completed'),
  lastMonday: session('s-lmon', '2026-09-14', 'AM', 'squash', 'Squash control', 'completed'),
  thuAm: session('s-thu-am', '2026-09-17', 'AM', 'strength', 'Fuerza tren superior'),
  thuPm: session('s-thu-pm', '2026-09-17', 'PM', 'squash', 'Técnica de drop'),
  fri: session('s-fri', '2026-09-18', 'AM', 'running', 'Rodaje Z2'),
  nextMonday: session('s-nmon', '2026-09-21', 'AM', 'squash', 'Squash físico'),
}
function ctx(sessions: Session[] = Object.values(S), extra: Partial<ChatContext> = {}): ChatContext {
  return { recentSessions: sessions, plannedSessions: [], historicalSessions: [], ...extra }
}
function resolve(message: string, extra: { context?: ChatContext; pendingIntent?: PendingIntent | null; recentMessages?: Array<{ role: 'user' | 'coach'; content: string; timestamp?: number }> } = {}) {
  return resolveMessageTargets({ message, context: extra.context ?? ctx(), pendingIntent: extra.pendingIntent ?? null, scope, recentMessages: extra.recentMessages ?? [], now: NOW })
}
const ids = (r: ReturnType<typeof resolve>) => (r.kind === 'resolved' ? r.targets.map((t) => t.sessionId) : r.kind)
const candidateIds = (r: ReturnType<typeof resolve>) => (r.kind === 'clarify' ? r.candidates.map((c) => c.id).sort() : [])

describe('fechas y cardinalidad', () => {
  it('"¿Cómo me fue ayer?" (sin sustantivo) toma todas las sesiones de ayer', () => {
    const r = resolve('¿Cómo me fue ayer?')
    expect(ids(r)).toEqual(['s-yest'])
    expect(r.kind === 'resolved' && r.dates).toEqual(['2026-09-15'])
  })

  it('"la sesión del jueves" con dos sesiones ese día pide aclarar, no toma ambas', () => {
    const r = resolve('Mueve la sesión del jueves al viernes')
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-thu-am', 's-thu-pm'])
    expect(r.kind === 'clarify' && r.dates).toEqual(['2026-09-17'])
  })

  it('"las sesiones del jueves" (plural sin cantidad) toma ambas', () => {
    expect(ids(resolve('Mueve las sesiones del jueves al viernes'))).toEqual(['s-thu-am', 's-thu-pm'])
  })

  it('franja: "por la tarde" acota; "por la mañana" no se lee como mañana', () => {
    expect(ids(resolve('Mueve la del jueves por la tarde al viernes'))).toEqual(['s-thu-pm'])
    const morning = resolve('la del jueves por la mañana')
    expect(ids(morning)).toEqual(['s-thu-am'])
    expect(morning.kind === 'resolved' && morning.dates).toEqual(['2026-09-17'])
  })

  it('pregunta en pasado: lunes anterior, acotado por deporte', () => {
    expect(ids(resolve('¿Cómo estuvo el squash del lunes?'))).toEqual(['s-lmon'])
  })

  it('una fecha sin sesiones se resuelve con la fecha', () => {
    expect(resolve('¿Cómo me fue anteayer?', { context: ctx([]) })).toEqual({ kind: 'resolved', targets: [], overflow: [], dates: ['2026-09-14'] })
  })
})

describe('fechas numéricas y destinos', () => {
  it.each(['2026-09-17', '17/09', '17/09/2026'])('combina título y fecha %s', (date) => {
    const repeated = session('next-title', '2026-09-24', 'AM', 'strength', S.thuAm.title)
    expect(ids(resolve(`Borra Fuerza tren superior del ${date}`, { context: ctx([S.thuAm, repeated]) }))).toEqual(['s-thu-am'])
  })

  it.each(['a mañana', 'al 18/09', 'para el 2026-09-18'])('separa el destino %s del origen', (destination) => {
    expect(ids(resolve(`Mueve Fuerza tren superior ${destination}`))).toEqual(['s-thu-am'])
  })

  it('fecha imposible pide aclaración sin elegir la sesión del título', () => {
    expect(resolve('Borra Fuerza tren superior del 31/02/2026')).toMatchObject({ kind: 'clarify', reason: 'invalid_date' })
  })
})

describe('título combinado con fecha, deporte y franja', () => {
  const thuLower = session('s-thu-lower', '2026-09-17', 'PM', 'strength', 'Fuerza tren inferior')
  const strengthThursday = ctx([S.thuAm, thuLower, S.fri])

  it('título + fecha: el título acota entre dos sesiones de fuerza del jueves', () => {
    const r = resolve('Borra Fuerza tren superior del jueves', { context: strengthThursday })
    expect(ids(r)).toEqual(['s-thu-am'])
    expect(r.kind === 'resolved' && r.targets[0].reason).toBe('named_session')
  })

  it('deporte + fecha sin título, en singular: aclara entre las dos de fuerza', () => {
    const r = resolve('Borra la sesión de fuerza del jueves', { context: strengthThursday })
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-thu-am', 's-thu-lower'])
  })

  it('título y fecha contradictorios: aclara con la sesión del título', () => {
    const r = resolve('Borra Fuerza tren superior del viernes', { context: strengthThursday })
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-thu-am'])
  })

  it('título repetido en varias semanas, en singular: aclara', () => {
    const weekly = ctx([session('c1', '2026-09-17', 'AM', 'squash', 'Squash control'), session('c2', '2026-09-24', 'AM', 'squash', 'Squash control')])
    expect(resolve('Cambia Squash control a 45 minutos', { context: weekly }).kind).toBe('clarify')
  })

  it('prefijo de id de 8 caracteres', () => {
    const withUuid = session('abcd1234-0000-4000-8000-000000000001', '2026-09-19', 'AM', 'mobility', 'Movilidad')
    expect(ids(resolve('ajusta abcd1234', { context: ctx([withUuid, S.fri]) }))).toEqual([withUuid.id])
  })
})

describe('anáforas y cantidades', () => {
  const intent = (known: Record<string, string>, athleteId = 'ath_a'): PendingIntent => ({
    id: 'i', kind: 'clarification', athleteId, conversationId: 'conv-1', createdAt: NOW, expiresAt: NOW + 60_000,
    status: 'open', route: 'chat_action', operation: { type: 'move_session', known, missing: [] }, summary: 'Mover',
  })
  const proposalWith = (sessionIds: string[], createdAt = NOW - 60_000): ChatContext['recentProposals'] =>
    [{ id: 'p', status: 'pending', createdAt, message: 'x', actions: sessionIds.map((sessionId) => ({ type: 'move_session' as const, sessionId, reason: 'r' })) }]

  it('usa la sesión conocida de la intención pendiente del mismo scope', () => {
    expect(ids(resolve('Muévela al viernes', { pendingIntent: intent({ sessionId: 's-thu-am' }) }))).toEqual(['s-thu-am'])
    expect(resolve('Muévela al viernes', { pendingIntent: intent({ sessionId: 's-thu-am' }, 'ath_b') }).kind).toBe('clarify')
  })

  it('usa la propuesta reciente; una vieja no es referente', () => {
    expect(ids(resolve('Bórrala', { context: ctx(undefined, { recentProposals: proposalWith(['s-thu-pm']) }) }))).toEqual(['s-thu-pm'])
    expect(resolve('Bórrala', { context: ctx(undefined, { recentProposals: proposalWith(['s-thu-pm'], NOW - 3_600_000) }) }))
      .toEqual({ kind: 'clarify', reason: 'missing_referent', cardinality: { kind: 'singular' }, candidates: [], dates: [] })
  })

  it('dos sesiones nombradas por el coach → aclaración con candidatos', () => {
    const r = resolve('Cámbiala', { recentMessages: [{ role: 'coach', content: 'Tienes Fuerza tren superior y Rodaje Z2.', timestamp: NOW - 30_000 }] })
    expect(candidateIds(r)).toEqual(['s-fri', 's-thu-am'])
  })

  const many = Array.from({ length: 14 }, (_, i) => session(`m-${String(i).padStart(2, '0')}`, `2026-10-${String(i + 1).padStart(2, '0')}`, 'AM', 'squash', `Bloque ${i}`))

  it('"estas ocho sesiones" con 14 referentes: aclara, nunca toma 12', () => {
    const r = resolve('Mueve estas ocho sesiones a la otra semana', { context: ctx(many, { recentProposals: proposalWith(many.map((s) => s.id)) }) })
    expect(r).toMatchObject({ kind: 'clarify', reason: 'count_mismatch', requestedCount: 8 })
  })

  it('"estas ocho sesiones" con 8 referentes: resuelve exactamente 8', () => {
    const eight = many.slice(0, 8)
    const r = resolve('Mueve estas ocho sesiones a la otra semana', { context: ctx(eight, { recentProposals: proposalWith(eight.map((s) => s.id)) }) })
    expect(r.kind === 'resolved' && r.targets).toHaveLength(8)
    expect(r.kind === 'resolved' && r.requestedCount).toBe(8)
  })

  it('cantidad explícita de 14 pide acotar aunque existan exactamente 14', () => {
    const r = resolve('Mueve estas catorce sesiones al lunes', { context: ctx(many, { recentProposals: proposalWith(many.map((s) => s.id)) }) })
    expect(r).toMatchObject({ kind: 'clarify', reason: 'too_many_requested', cardinality: { kind: 'plural', count: 14 } })
    expect(r.kind === 'clarify' && buildTargetClarificationIntent('mueve estas catorce sesiones', r, scope, NOW)).toBeNull()
  })

  it('plural sin referente pregunta sin abrir intención singular', () => {
    const r = resolve('Muévelas al viernes', { context: ctx([]) })
    expect(r).toMatchObject({ kind: 'clarify', reason: 'missing_referent', cardinality: { kind: 'plural' } })
    expect(r.kind === 'clarify' && buildTargetClarificationIntent('Muévelas al viernes', r, scope, NOW)).toBeNull()
  })

  it('plural sin cantidad con 14 referentes: tope de 12 y exceso declarado', () => {
    const r = resolve('Mueve estas sesiones a la otra semana', { context: ctx(many, { recentProposals: proposalWith(many.map((s) => s.id)) }) })
    expect(r.kind === 'resolved' && r.targets).toHaveLength(MAX_TARGETS_PER_OPERATION)
    expect(r.kind === 'resolved' && r.overflow.map((t) => t.sessionId)).toEqual(['m-12', 'm-13'])
  })

  it('sin criterio ni anáfora → none', () => {
    expect(resolve('¿Qué opinas del volumen de esta semana?').kind).toBe('none')
  })
})

describe('helpers', () => {
  it('aclaración singular de movimiento conserva el destino y pide la sesión', () => {
    const intent = buildTargetClarificationIntent('muévela al viernes', { kind: 'clarify', reason: 'missing_referent', cardinality: { kind: 'singular' }, candidates: [], dates: [] }, scope, NOW)
    expect(intent).toMatchObject({ kind: 'clarification', status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] } })
  })

  it('count_mismatch pregunta sin abrir intención', () => {
    const resolution = { kind: 'clarify' as const, reason: 'count_mismatch' as const, cardinality: { kind: 'plural' as const, count: 8 }, candidates: [], dates: [], requestedCount: 8 }
    expect(buildTargetClarificationIntent('mueve estas ocho sesiones', resolution, scope, NOW)).toBeNull()
    expect(describeTargetClarification(resolution)).toMatch(/Pediste 8/)
  })

  it('en chat general una aclaración se degrada a referencia de sólo lectura', () => {
    const r = readOnlyTargetsFromClarification({ kind: 'clarify', reason: 'ambiguous_referent', cardinality: { kind: 'singular' }, candidates: [{ id: 's-thu-am', date: '2026-09-17', timeBlock: 'AM', title: 'x' }], dates: ['2026-09-17'] })
    expect(r).toMatchObject({ kind: 'resolved', targets: [{ sessionId: 's-thu-am' }], dates: ['2026-09-17'] })
  })

  it('el aviso de exceso nombra las sesiones que quedaron fuera', () => {
    expect(withTargetOverflowNotice({ message: 'Listo.' }, [{ title: 'Bloque 12', date: '2026-10-13', timeBlock: 'AM' }]).message)
      .toContain('quedaron fuera 1: Bloque 12 (2026-10-13 AM)')
  })
})

// Regresión de la revisión de Task 11: tres hallazgos "Important" —
// deporte/franja como único criterio (Hallazgo 1), un título con forma de
// destino que el stripeo de destino no debe destruir (Hallazgo 2), y una
// anáfora que debe acotarse por deporte/franja igual que id/fecha/título
// (Hallazgo 3). Documentan cobertura que faltaba; no reemplazan ningún test
// existente.
describe('regresión revisión Task 11: deporte/franja como único criterio', () => {
  it('deporte solo resuelve sin ambigüedad ("Borra la sesión de squash")', () => {
    // S.thuPm es squash, S.fri es running: una sola candidata de squash.
    const r = resolve('Borra la sesión de squash', { context: ctx([S.thuPm, S.fri]) })
    expect(ids(r)).toEqual(['s-thu-pm'])
  })

  it('deporte solo aclara cuando hay más de una candidata', () => {
    // S.thuPm y S.nextMonday son ambas squash.
    const r = resolve('Borra la sesión de squash', { context: ctx([S.thuPm, S.nextMonday]) })
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-nmon', 's-thu-pm'])
  })

  it('franja sola resuelve sin ambigüedad ("Borra la sesión de la tarde")', () => {
    // S.thuAm es AM, S.thuPm es PM: sólo la PM matchea "de la tarde".
    const r = resolve('Borra la sesión de la tarde', { context: ctx([S.thuAm, S.thuPm]) })
    expect(ids(r)).toEqual(['s-thu-pm'])
  })
})

describe('regresión revisión Task 11: título con forma de destino', () => {
  it('un título como "Camino al viernes" no se destruye al stripear el destino', () => {
    const destinationTitle = session('s-camino', '2026-09-16', 'AM', 'squash', 'Camino al viernes')
    const r = resolve('Borra Camino al viernes', { context: ctx([destinationTitle, S.fri]) })
    expect(ids(r)).toEqual(['s-camino'])
  })
})

describe('regresión revisión Task 11: anáfora acotada por deporte/franja', () => {
  const proposalWith = (sessionIds: string[], createdAt = NOW - 60_000): ChatContext['recentProposals'] =>
    [{ id: 'p', status: 'pending', createdAt, message: 'x', actions: sessionIds.map((sessionId) => ({ type: 'move_session' as const, sessionId, reason: 'r' })) }]

  it('"Cámbiala por la tarde" con dos candidatas del mismo día se acota a la PM', () => {
    const r = resolve('Cámbiala por la tarde a las 6pm', {
      context: ctx(undefined, { recentProposals: proposalWith([S.thuAm.id, S.thuPm.id]) }),
    })
    expect(ids(r)).toEqual(['s-thu-pm'])
  })
})
