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

  it('redirects explicit multi-week planning requests to Plan Builder', () => {
    expect(resolveChatRoute('Hazme el plan hasta el evento').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Quiero todas las semanas hasta el torneo').kind).toBe('plan_builder_redirect')
  })
})
