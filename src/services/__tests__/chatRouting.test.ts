import { describe, expect, it } from 'vitest'

import { resolveChatRoute } from '../chatRouting'

describe('chatRouting', () => {
  it('routes single-week planning requests to the specialized engine', () => {
    expect(resolveChatRoute('Créame la semana para esta semana').kind).toBe('week_creator')
    expect(resolveChatRoute('Créame la semana para la próxima semana').kind).toBe('week_creator')
  })

  it('routes day-scoped or session-scoped requests to chat_action', () => {
    expect(resolveChatRoute('Armame el lunes con running suave').kind).toBe('chat_action')
    expect(resolveChatRoute('Agrega squash el jueves PM').kind).toBe('chat_action')
  })

  it('routes plural and imperative session changes to chat_action', () => {
    expect(resolveChatRoute('cámbiame una de las sesiones de fuerza').kind).toBe('chat_action')
    expect(resolveChatRoute('cambie 1 de las sesiones').kind).toBe('chat_action')
    expect(resolveChatRoute('modifícame la sesión PM').kind).toBe('chat_action')
  })

  it('routes colloquial single-session creation requests to chat_action', () => {
    // These were falling through to chat_general before the routing widening,
    // which prevented the chat from emitting an actionable proposal.
    expect(resolveChatRoute('quiero squash mañana').kind).toBe('chat_action')
    expect(resolveChatRoute('haceme un running el viernes').kind).toBe('chat_action')
    expect(resolveChatRoute('ponme una sesión de fuerza el lunes').kind).toBe('chat_action')
    expect(resolveChatRoute('necesito cycling el sábado AM').kind).toBe('chat_action')
    expect(resolveChatRoute('agéndame movilidad hoy PM').kind).toBe('chat_action')
    expect(resolveChatRoute('Dame la sesión de pesas para mañana lunes').kind).toBe('chat_action')
  })

  it('routes typo-tolerant strength session requests to chat_action', () => {
    expect(resolveChatRoute('crea una sesión de pesas par ahoy').kind).toBe('chat_action')
    expect(resolveChatRoute('crea una sesion de gym a hoy').kind).toBe('chat_action')
    expect(resolveChatRoute('hazme pesas manana').kind).toBe('chat_action')
  })

  it('still routes generic conversation to chat_general', () => {
    expect(resolveChatRoute('cómo va mi semana').kind).toBe('chat_general')
    expect(resolveChatRoute('qué opinas de mi progreso').kind).toBe('chat_general')
  })

  it('redirects explicit multi-week planning requests to Plan Builder', () => {
    expect(resolveChatRoute('Hazme el plan hasta el evento').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Quiero todas las semanas hasta el torneo').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Créame 2 semanas').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Armame dos semanas de entrenamiento').kind).toBe('plan_builder_redirect')
  })
})
