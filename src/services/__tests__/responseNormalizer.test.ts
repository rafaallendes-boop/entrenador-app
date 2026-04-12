import { describe, expect, it } from 'vitest'
import { normalizeResponse } from '../ai/responseNormalizer'

describe('responseNormalizer', () => {
  it('keeps a valid practice_match action payload', () => {
    const response = normalizeResponse({
      text: [
        'Te propongo una semana mas especifica.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Subir exposicion competitiva sin torneo inmediato',
            targetDate: '2026-04-09',
            sessionType: 'squash',
            title: 'Partido de entrenamiento',
            durationMin: 45,
            timeBlock: 'PM',
            subtype: 'match',
            squashDetails: {
              trainingFocus: 'conditioned_games',
              drills: [{ name: 'Best of 3 games' }],
              sessionMode: 'practice_match',
            },
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      sessionType: 'squash',
      subtype: 'match',
    })
    expect(response.actions?.[0].squashDetails?.sessionMode).toBe('practice_match')
  })

  it('drops malformed actions instead of trusting weak casts', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste sugerido.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'payload invalido',
            targetDate: '2026-04-09',
            sessionType: 'swim',
            title: 'No permitido',
            durationMin: 45,
            timeBlock: 'MIDDAY',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toBeUndefined()
    expect(response.meta?.actionParseFailed).toBe(true)
  })

  it('filters invalid create_week session proposals and keeps valid ones', () => {
    const response = normalizeResponse({
      text: [
        'Semana propuesta.',
        '<actions>',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana build',
            sessions: [
              {
                date: '2026-04-08',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Tempo',
                durationMin: 50,
              },
              {
                date: 'invalid-date',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Roto',
                durationMin: 30,
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0].type).toBe('create_week')
    expect(response.actions?.[0].sessions).toHaveLength(1)
    expect(response.actions?.[0].sessions?.[0].title).toBe('Tempo')
  })

  it('rejects squashDetails when drills items do not have a valid shape', () => {
    const response = normalizeResponse({
      text: [
        'Semana propuesta.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'payload invalido squash',
            targetDate: '2026-04-09',
            sessionType: 'squash',
            title: 'Squash tecnico',
            durationMin: 45,
            timeBlock: 'PM',
            squashDetails: {
              trainingFocus: 'technical',
              drills: [null, {}, { durationMin: 5 }],
            },
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0].squashDetails).toBeUndefined()
  })

  it('parses inline JSON actions even when the model omits the actions tag', () => {
    const response = normalizeResponse({
      text: [
        'Aqui va la propuesta compacta.',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana base compacta',
            sessions: [
              {
                date: '2026-04-08',
                timeBlock: 'PM',
                sessionType: 'squash',
                title: 'Squash tecnico',
                durationMin: 60,
              },
            ],
          },
        ]),
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0].type).toBe('create_week')
    expect(response.message).toContain('Aqui va la propuesta compacta.')
  })
})
