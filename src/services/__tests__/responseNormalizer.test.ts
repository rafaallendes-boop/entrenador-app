import { describe, expect, it, vi } from 'vitest'
import { normalizeResponse } from '../ai/responseNormalizer'

describe('responseNormalizer', () => {
  it('adds a readable fallback when chat_action returns only actions', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Sumar base aerobica',
            targetDate: '2026-04-10',
            sessionType: 'running',
            title: 'Rodaje Z2',
            durationMin: 45,
            timeBlock: 'PM',
            objective: 'Base suave',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.message).toBe('Te propongo este cambio:')
    expect(response.actions).toHaveLength(1)
  })

  it('marks max-token provider finishes as likely truncated', () => {
    const response = normalizeResponse({
      text: 'Respuesta larga cortada',
      provider: 'mock',
      requestClass: 'chat_general',
      finishReason: 'MAX_TOKENS',
    })

    expect(response.meta?.likelyTruncated).toBe(true)
  })

  it('accepts snake_case session_id for update_session actions', () => {
    const response = normalizeResponse({
      text: [
        'Ajusto esa sesion.',
        '<actions>',
        JSON.stringify([
          {
            type: 'update_session',
            session_id: 'session-1234',
            reason: 'Bajar carga',
            newDurationMin: 35,
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'session-1234',
      newDurationMin: 35,
    })
  })

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

  it('marks low-density strength proposals as a non-blocking warning', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste fuerza.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Preparacion fisica completa',
            targetDate: '2026-04-10',
            sessionType: 'strength',
            title: 'Fuerza squash',
            durationMin: 60,
            timeBlock: 'PM',
            objective: 'Sesion de fuerza de una hora',
            exercises: [
              { name: 'Trap Bar Deadlift', sets: 4, reps: 5 },
              { name: 'Pallof Press', sets: 3, reps: 10 },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.meta?.warnings).toContain('low_density:strength:60min:2/5')
    expect(response.meta?.outcome).toBe('ok')
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

  it('accepts a create_week action wrapped by action name', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify({
          create_week: {
            type: 'training',
            reason: 'Semana de entrenamiento general enfocada en squash.',
            targetDate: '2026-04-27',
            weekObjectives: ['Mejorar la tecnica de squash.'],
            sessions: [
              {
                date: '2026-04-27',
                timeBlock: 'AM',
                sessionType: 'squash',
                title: 'Squash: Drills Tecnicos',
                durationMin: 60,
                objective: 'Consolidar la tecnica de golpeo.',
                squashDetails: {
                  trainingFocus: 'technical',
                  sessionMode: 'drill_session',
                  sessionKind: 'technical',
                  drills: [{ name: 'Boast-Drive', durationMin: 15 }],
                },
              },
            ],
          },
        }),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'week_creator',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      reason: 'Semana de entrenamiento general enfocada en squash.',
      targetDate: '2026-04-27',
      weekObjectives: ['Mejorar la tecnica de squash.'],
    })
    expect(response.actions?.[0].sessions?.[0].title).toBe('Squash: Drills Tecnicos')
  })

  it('repairs squashDetails when the model sends blocks without flat drills', () => {
    const response = normalizeResponse({
      text: [
        'Entendido.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            targetDate: '2026-04-30',
            timeBlock: 'PM',
            sessionType: 'squash',
            title: 'Squash: Tecnica y Movimiento',
            durationMin: 64,
            objective: 'Mejorar control del T, voleas y movimiento especifico.',
            squashDetails: {
              sessionKind: 'mixed',
              trainingFocus: 'conditioned_games',
              blocks: [
                {
                  kind: 'technical',
                  durationMin: 34,
                  drills: [{ name: 'Control del T con patron largo-corto', durationMin: 18 }],
                },
                {
                  kind: 'shadows',
                  durationMin: 16,
                  drills: [{ name: 'Split step y recuperacion al T', durationMin: 16 }],
                },
                {
                  kind: 'control',
                  durationMin: 14,
                  drills: [{ name: '100 al box de saque', durationMin: 14 }],
                },
              ],
            },
            reason: 'El usuario solicito añadir la sesion de squash propuesta para hoy.',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0].squashDetails?.drills.map((drill) => drill.name)).toEqual([
      'Split step y recuperacion al T',
      'Control del T con patron largo-corto',
      '100 al box de saque',
    ])
    expect(response.actions?.[0].squashDetails?.blocks).toHaveLength(3)
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

  it('normalizes create_week when model uses "action" as discriminator instead of "type"', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify({
          action: 'create_week',
          type: 'training_week',
          targetDate: '2026-04-27',
          reason: 'Semana Peak con squash y fuerza',
          weekObjectives: ['Priorizar sesiones clave'],
          sessions: [
            {
              date: '2026-04-27',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash: Físico en pista',
              durationMin: 60,
              objective: 'Mejorar desplazamiento',
              rpe: 7,
              squashDetails: {
                trainingFocus: 'physical',
                sessionMode: 'drill_session',
                sessionKind: 'technical',
                drills: [{ name: 'Ghosting: 4 esquinas', durationMin: 20 }],
              },
            },
          ],
        }),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'plan_builder_week',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0].type).toBe('create_week')
    expect(response.actions?.[0].targetDate).toBe('2026-04-27')
    expect(response.actions?.[0].sessions).toHaveLength(1)
    expect(response.meta?.actionParseFailed).toBeFalsy()
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

  describe('outcome classification', () => {
    it('classifies a clean response as ok', () => {
      const response = normalizeResponse({
        text: 'Va bien la semana, sigue así.',
        provider: 'mock',
      })
      expect(response.meta?.outcome).toBe('ok')
    })

    it('classifies truncated_mid when some actions parsed but others dropped as invalid', () => {
      const response = normalizeResponse({
        text: [
          'Aquí va.',
          '<actions>',
          JSON.stringify([
            { type: 'skip_session', sessionId: 's1', reason: 'descanso' },
            { type: 'skip_session' /* missing sessionId/reason → invalid */ },
          ]),
          '</actions>',
        ].join('\n'),
        provider: 'mock',
      })
      expect(response.actions).toHaveLength(1)
      expect(response.meta?.likelyTruncated).toBe(true)
      expect(response.meta?.outcome).toBe('truncated_mid')
    })

    it('classifies truncated_early when actions tag opens but no action parsed', () => {
      const response = normalizeResponse({
        text: ['Empezando...', '<actions>', '['].join('\n'),
        provider: 'mock',
      })
      expect(response.meta?.outcome).toBe('truncated_early')
    })

    it('propagates errorClass from raw to meta', () => {
      const response = normalizeResponse({
        text: 'parcial',
        provider: 'mock',
        truncated: true,
        errorClass: 'timeout',
      })
      expect(response.meta?.errorClass).toBe('timeout')
    })
  })
})
