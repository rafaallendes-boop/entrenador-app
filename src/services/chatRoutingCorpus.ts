import type { ChatRouteKind } from './chatRouting'

export interface ChatRoutingCorpusCase {
  id: string
  message: string
  expected: ChatRouteKind
  /** Por qué ésta es la interpretación correcta. Cambiarla exige cambiar el motivo. */
  why: string
  recentMessages?: Array<{ role: 'user' | 'coach'; content: string }>
}

/**
 * Interpretación esperada de frases canónicas. UI, store y engine se prueban
 * contra ESTE archivo, no entre sí: dos capas alineadas pueden equivocarse
 * igual. Acordado con el owner el 2026-09-12 (spec §4, A4).
 */
export const CHAT_ROUTING_CORPUS: ChatRoutingCorpusCase[] = [
  { id: 'hist-1', message: '¿Cómo estuvo mi sesión del lunes?', expected: 'chat_general', why: 'Consulta sobre historial; la recuperación de hechos llega en B4.' },
  { id: 'hist-2', message: 'Dame feedback de mi sesión del lunes', expected: 'chat_general', why: '`dame` no es verbo de creación con objeto definido (`mi sesión`).' },
  { id: 'create-1', message: 'Créame una sesión de pesas', expected: 'chat_action', why: 'Creación con objeto indefinido.' },
  { id: 'advice-1', message: '¿Cómo me prepararías para tres semanas de vacaciones?', expected: 'chat_general', why: 'Asesoría en condicional; un horizonte temporal no es una petición de plan.' },
  { id: 'plan-1', message: 'Genera un plan completo hasta el torneo', expected: 'plan_builder_redirect', why: 'Verbo de creación más plan completo.' },
  // Frases que ya fijaban los tests de chatRouting, revisadas una a una.
  { id: 'week-1', message: 'Créame la semana para esta semana', expected: 'week_creator', why: 'Verbo de creación con objeto semana.' },
  { id: 'week-2', message: 'Créame la semana para la próxima semana', expected: 'week_creator', why: 'Idem, próxima semana.' },
  { id: 'day-1', message: 'Armame el lunes con running suave', expected: 'chat_action', why: 'Día más deporte sin scope de semana.' },
  { id: 'day-2', message: 'Agrega squash el jueves PM', expected: 'chat_action', why: 'Verbo de ajuste con día.' },
  { id: 'bypass-1', message: 'pon descanso el lunes', expected: 'chat_action', why: 'Mutación con día.' },
  { id: 'bypass-2', message: 'borra el entreno del jueves', expected: 'chat_action', why: 'Borrado con día.' },
  { id: 'plural-1', message: 'cámbiame una de las sesiones de fuerza', expected: 'chat_action', why: 'Cambio sobre una sesión.' },
  { id: 'colloq-1', message: 'quiero squash mañana', expected: 'chat_action', why: 'Creación coloquial con día.' },
  { id: 'colloq-2', message: 'Dame la sesión de pesas para mañana lunes', expected: 'chat_action', why: '`dame` con día y objeto de sesión: pedido de contenido para agendar.' },
  { id: 'qualifier-1', message: 'Créame una sesión de fuerza con superseries para el lunes de la próxima semana', expected: 'chat_action', why: 'La semana es calificador temporal.' },
  { id: 'general-1', message: 'cómo va mi semana', expected: 'chat_general', why: 'Conversación.' },
  { id: 'general-2', message: '¿Qué debería priorizar hoy antes de mis sesiones?', expected: 'chat_general', why: 'Asesoría; nombra sesión y día pero pide criterio.' },
  { id: 'general-3', message: '¿Cuánto debería bajar la carga esta semana?', expected: 'chat_general', why: 'Asesoría.' },
  { id: 'summary-1', message: 'Resumeme la semana y dejame un balance corto', expected: 'weekly_summary', why: 'Resumen semanal explícito.' },
  { id: 'fullplan-1', message: 'Hazme el plan hasta el evento', expected: 'plan_builder_redirect', why: 'Plan completo hasta el evento.' },
  { id: 'multiweek-1', message: 'Arma las próximas tres semanas de entrenamiento', expected: 'plan_builder_redirect', why: 'Verbo de creación más varias semanas.' },
  // Anáforas y confirmaciones: en A, sin intención pendiente estructurada, son conversación.
  { id: 'anaphora-1', message: 'Muévela al viernes', expected: 'chat_general', why: 'Anáfora sin referente ni intención pendiente: se pide aclaración (A). B4 la resuelve.' },
  { id: 'confirm-1', message: 'sí', expected: 'chat_general', why: 'Confirmación corta sin oferta estructurada vigente es conversación (A4.4).',
    recentMessages: [{ role: 'user', content: 'Quiero una sesión de fuerza el lunes.' }, { role: 'coach', content: 'Te propongo una sesión de fuerza para el lunes.' }] },
]
