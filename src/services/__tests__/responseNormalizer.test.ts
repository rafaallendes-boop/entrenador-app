import { describe, expect, it, vi } from 'vitest'
import { normalizeResponse } from '../ai/responseNormalizer'

describe('responseNormalizer', () => {
  it('repairs squash add_session without squashDetails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = normalizeResponse({
      text: [
        'Ajuste squash.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Necesita tecnica sin desgaste',
            targetDate: '2026-04-09',
            sessionType: 'squash',
            title: 'Squash tecnico',
            durationMin: 60,
            timeBlock: 'PM',
            objective: 'Control y precision',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0].squashDetails).toEqual({
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      drills: [{ name: 'Squash tecnico', durationMin: 60 }],
    })
    expect(warn).toHaveBeenCalledWith(
      '[responseNormalizer] add_session repaired',
      expect.objectContaining({ repairs: ['squashDetails'] }),
    )

    warn.mockRestore()
  })

  it('repairs add_session without durationMin using sport defaults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = normalizeResponse({
      text: [
        'Ajuste running.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Sostener base aerobica',
            targetDate: '2026-04-10',
            sessionType: 'running',
            title: 'Rodaje Z2',
            timeBlock: 'AM',
            objective: 'Base suave',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      sessionType: 'running',
      durationMin: 45,
    })
    expect(warn).toHaveBeenCalledWith(
      '[responseNormalizer] add_session repaired',
      expect.objectContaining({ repairs: ['durationMin'] }),
    )

    warn.mockRestore()
  })

  it('repairs add_session without timeBlock using PM', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = normalizeResponse({
      text: [
        'Ajuste movilidad.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Descargar cadera y columna',
            targetDate: '2026-04-11',
            sessionType: 'mobility',
            title: 'Movilidad full body',
            durationMin: 30,
            objective: 'Soltar sin fatiga',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      sessionType: 'mobility',
      timeBlock: 'PM',
    })
    expect(warn).toHaveBeenCalledWith(
      '[responseNormalizer] add_session repaired',
      expect.objectContaining({ repairs: ['timeBlock'] }),
    )

    warn.mockRestore()
  })

  it('drops add_session when core fields are too incomplete to repair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = normalizeResponse({
      text: [
        'Ajuste incompleto.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Falta informacion central',
            sessionType: 'running',
            durationMin: 45,
            timeBlock: 'PM',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toBeUndefined()
    expect(response.meta?.actionParseFailed).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      '[responseNormalizer] add_session dropped',
      expect.objectContaining({ reason: 'missing-core-fields' }),
    )

    warn.mockRestore()
  })

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
    expect(response.meta?.createWeekDiagnostics).toEqual([
      {
        targetDate: undefined,
        rawSessions: 2,
        validSessions: 1,
        droppedSessions: 1,
        repairedSessions: [{ index: 0, repairs: ['objective'] }],
        droppedSessionReasons: [{ index: 1, reason: 'invalid-date' }],
      },
    ])
    expect(response.meta?.likelyTruncated).toBe(true)
  })

  it('repairs squash create_week session proposals without squashDetails', () => {
    const response = normalizeResponse({
      text: [
        'Semana propuesta.',
        '<actions>',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana tecnica',
            targetDate: '2026-04-06',
            sessions: [
              {
                date: '2026-04-06',
                timeBlock: 'PM',
                sessionType: 'squash',
                title: 'Squash tecnico',
                durationMin: 60,
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0].type).toBe('create_week')
    expect(response.actions?.[0].sessions?.[0]).toMatchObject({
      sessionType: 'squash',
      objective: 'Semana tecnica',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: 'Squash tecnico', durationMin: 60 }],
      },
    })
    expect(response.meta?.createWeekDiagnostics?.[0].repairedSessions).toEqual([
      { index: 0, repairs: ['objective', 'squashDetails'] },
    ])
  })

  it('repairs create_week session proposals without durationMin or timeBlock', () => {
    const response = normalizeResponse({
      text: [
        'Semana propuesta.',
        '<actions>',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana base',
            targetDate: '2026-04-06',
            sessions: [
              {
                date: '2026-04-07',
                sessionType: 'running',
                title: 'Rodaje Z2',
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0].sessions?.[0]).toMatchObject({
      date: '2026-04-07',
      sessionType: 'running',
      title: 'Rodaje Z2',
      durationMin: 45,
      timeBlock: 'PM',
      objective: 'Semana base',
    })
    expect(response.meta?.createWeekDiagnostics?.[0].repairedSessions).toEqual([
      { index: 0, repairs: ['durationMin', 'timeBlock', 'objective'] },
    ])
  })

  it('drops too-incomplete create_week session proposals with a clear reason', () => {
    const response = normalizeResponse({
      text: [
        'Semana propuesta.',
        '<actions>',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana parcial',
            targetDate: '2026-04-06',
            sessions: [
              {
                date: '2026-04-07',
                timeBlock: 'PM',
                sessionType: 'running',
                title: 'Rodaje Z2',
                durationMin: 45,
              },
              {
                date: '2026-04-08',
                timeBlock: 'PM',
                durationMin: 45,
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0].sessions).toHaveLength(1)
    expect(response.meta?.createWeekDiagnostics?.[0]).toMatchObject({
      rawSessions: 2,
      validSessions: 1,
      droppedSessions: 1,
      droppedSessionReasons: [{ index: 1, reason: 'missing-sessionType' }],
    })
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

  it('rejects squashDetails when drills is empty and flags likelyTruncated', () => {
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
              drills: [],
            },
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0].squashDetails).toBeUndefined()
    expect(response.meta?.likelyTruncated).toBe(true)
  })

  it('marks likelyTruncated when JSON is valid but actions are semantically incomplete', () => {
    const response = normalizeResponse({
      text: [
        'Semana propuesta.',
        '<actions>',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana build',
            sessions: [],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toBeUndefined()
    expect(response.meta?.actionParseFailed).toBe(true)
    expect(response.meta?.likelyTruncated).toBe(true)
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
                subtype: 'training',
                squashDetails: {
                  trainingFocus: 'technical',
                  drills: [{ name: 'Drives paralelos', durationMin: 20 }],
                  sessionMode: 'drill_session',
                },
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

  it('accepts actions wrapped in an object payload', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste completo.',
        '<actions>',
        JSON.stringify({
          actions: [
            {
              type: 'update_session',
              reason: 'Bajar carga por adherencia',
              sessionId: 'abc123',
              newDurationMin: 40,
            },
          ],
        }),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'abc123',
      newDurationMin: 40,
    })
  })

  it('drops create_week actions when requestClass is chat_action', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste completo.',
        '<actions>',
        JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana nueva',
            targetDate: '2026-04-14',
            sessions: [
              {
                date: '2026-04-14',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Rodaje',
                durationMin: 45,
              },
            ],
          },
          {
            type: 'update_session',
            reason: 'Bajar volumen',
            sessionId: 'abc123',
            newDurationMin: 35,
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.actions).toEqual([
      expect.objectContaining({
        type: 'update_session',
        sessionId: 'abc123',
      }),
    ])
    expect(response.meta?.invalidActionCount).toBe(1)
  })

  it('moves practice match drills to the end of a squash drill block', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste squash.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Cerrar con match-play',
            targetDate: '2026-04-09',
            sessionType: 'squash',
            title: 'Squash con partido final',
            durationMin: 60,
            timeBlock: 'PM',
            subtype: 'match',
            squashDetails: {
              trainingFocus: 'tactical',
              sessionMode: 'practice_match',
              drills: [
                { name: 'Partido de entrenamiento al mejor de 3 games', durationMin: 18 },
                { name: 'Drives paralelos a profundidad', durationMin: 15 },
                { name: 'Juego condicionado solo paralelo', durationMin: 15 },
              ],
            },
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0].squashDetails?.drills.map((drill) => drill.name)).toEqual([
      'Drives paralelos a profundidad',
      'Juego condicionado solo paralelo',
      'Partido de entrenamiento al mejor de 3 games',
    ])
  })
})
