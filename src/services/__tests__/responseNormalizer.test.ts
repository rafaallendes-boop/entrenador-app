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

  it('descarta un libraryRef emitido por el modelo', () => {
    const response = normalizeResponse({
      text: [
        'Te propongo esto.',
        '<actions>',
        JSON.stringify([{
          type: 'add_session',
          reason: 'fuerza',
          sessionType: 'strength',
          targetDate: '2026-05-08',
          title: 'Fuerza',
          durationMin: 50,
          timeBlock: 'PM',
          objective: 'Fuerza general',
          exercises: [{
            name: 'Press banca',
            sets: 3,
            reps: 5,
            libraryRef: { source: 'strength_exercise', id: 'back_squat' },
          }],
        }]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    const exercise = response.actions?.[0]?.exercises?.find((item) => item.name === 'Press banca') as
      | Record<string, unknown>
      | undefined
    expect(exercise?.name).toBe('Press banca')
    expect(exercise?.libraryRef).toBeUndefined()
  })

  it('descarta sellos y precondiciones emitidos por el provider', () => {
    const providerSeal = {
      policyVersion: 1,
      exerciseFingerprint: 'forged',
      constraintFingerprint: 'forged',
      userMessageConstraints: [],
    }
    const response = normalizeResponse({
      text: `<actions>${JSON.stringify([{
        type: 'create_week', reason: 'fuerza', strengthSafetyFinalization: providerSeal, baseUpdatedAt: 999,
        sessions: [{
          date: '2026-09-10', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 50,
          metadata: { strengthSafetyFinalization: providerSeal },
          exercises: [{ name: 'Press banca', sets: 3, reps: 5 }],
        }],
      }])}</actions>`,
      provider: 'mock',
      requestClass: 'chat_action',
    })

    const action = response.actions?.[0]
    expect(action?.strengthSafetyFinalization).toBeUndefined()
    expect(action?.baseUpdatedAt).toBeUndefined()
    expect(action?.sessions?.[0]?.metadata?.strengthSafetyFinalization).toBeUndefined()
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

  it('removes internal short session ids from the visible coach message', () => {
    const response = normalizeResponse({
      text: [
        'Movería la fuerza del jueves 2 de julio [08673c59] para cuidar frescura.',
        '<actions>',
        JSON.stringify([
          {
            type: 'move_session',
            sessionId: '08673c59-full-id',
            targetDate: '2026-07-03',
            timeBlock: 'PM',
            reason: 'Cuidar frescura antes del squash',
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.message).toBe('Movería la fuerza del jueves 2 de julio para cuidar frescura.')
    expect(response.actions?.[0]).toMatchObject({
      type: 'move_session',
      sessionId: '08673c59-full-id',
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

  it('preserves squashKind and leaves compact squash add_session hydration to the local materializer', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste squash.',
        '<actions>',
        JSON.stringify([{
          type: 'add_session',
          reason: 'Trabajo cooperativo',
          targetDate: '2026-04-09',
          sessionType: 'squash',
          squashKind: 'technical',
          title: 'Squash técnico',
          durationMin: 60,
          timeBlock: 'PM',
          objective: 'Control de longitud con partner',
        }]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.actions?.[0]).toMatchObject({
      type: 'add_session',
      squashKind: 'technical',
    })
    expect(response.actions?.[0].squashDetails).toBeUndefined()
  })

  it('preserves squashKind on update_session', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify([{
          type: 'update_session',
          sessionId: 'squash-123',
          reason: 'Cambiar modalidad',
          squashKind: 'control',
        }]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.actions?.[0]).toMatchObject({
      type: 'update_session',
      sessionId: 'squash-123',
      squashKind: 'control',
    })
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

  it('normalizes mobility details to Spanish before exposing actions', () => {
    const response = normalizeResponse({
      text: [
        'Ajuste movilidad.',
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'Descargar cadera y columna',
            targetDate: '2026-04-11',
            timeBlock: 'PM',
            sessionType: 'mobility',
            title: 'Movilidad full body',
            durationMin: 30,
            objective: 'Soltar sin fatiga',
            mobilityDetails: {
              context: 'full_body',
              focusAreas: ['full_body', 'hip'],
              targetStructure: 'Worlds greatest stretch 5/l + Hip 90/90 flow 2min/l + Thoracic rotation 10/l + Childs pose 3min.',
            },
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions?.[0]).toMatchObject({
      mobilityDetails: {
        targetStructure: 'Estocada larga con rotacion 5/lado + Flujo 90/90 de cadera 2 min/lado + Rotacion toracica 10/lado + Postura del nino 3 min.',
      },
    })
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
    expect(response.meta?.warnings).toContain('low_density:strength:60min:3/5')
    expect(response.meta?.outcome).toBe('ok')
  })

  it('does NOT emit low_density warning when strength session has 0 exercises (repair will fill them)', () => {
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
                sessionType: 'strength',
                title: 'Fuerza squash',
                durationMin: 60,
                objective: 'Sesion de fuerza completa',
                exercises: [],
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    const warnings = response.meta?.warnings ?? []
    const densityWarnings = warnings.filter((w) => w.startsWith('low_density:strength'))
    expect(densityWarnings).toHaveLength(0)
  })

  it('DOES emit low_density warning when strength session has some (but too few) exercises', () => {
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
                sessionType: 'strength',
                title: 'Fuerza squash',
                durationMin: 60,
                objective: 'Sesion de fuerza',
                exercises: [
                  { name: 'Sentadilla', sets: 4, reps: 5 },
                  { name: 'Press banca', sets: 3, reps: 8 },
                ],
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    expect(response.actions).toHaveLength(1)
    // normalizeStrengthSessionExercises adds a core block for durationMin >= 45,
    // so 2 input exercises become 3 after normalization, still below the min of 5
    expect(response.meta?.warnings).toContain('low_density:strength:60min:3/5')
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

  it('accepts a raw fenced JSON create_week response for plan_builder_week', () => {
    const response = normalizeResponse({
      text: [
        '```json',
        JSON.stringify({
          type: 'create_week',
          reason: 'Semana especifica',
          targetDate: '2026-06-08',
          weekObjectives: ['Afinar control'],
          sessions: [
            {
              date: '2026-06-08',
              timeBlock: 'PM',
              sessionType: 'running',
              title: 'Rodaje Z2',
              durationMin: 45,
              objective: 'Base suave',
            },
          ],
        }),
        '```',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'plan_builder_week',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-06-08',
      sessions: [{ sessionType: 'running', title: 'Rodaje Z2' }],
    })
    expect(response.meta?.outcome).toBe('ok')
  })

  it('repairs non-canonical squash create_week session types from structured JSON', () => {
    const response = normalizeResponse({
      text: JSON.stringify({
        type: 'create_week',
        reason: 'Semana con control tecnico',
        targetDate: '2026-06-08',
        sessions: [
          {
            date: '2026-06-08',
            timeBlock: 'AM',
            sessionType: 'squash/control',
            title: 'Squash - Control de juego',
            durationMin: 60,
            objective: 'Mejorar precision y consistencia',
          },
        ],
      }),
      provider: 'mock',
      requestClass: 'plan_builder_week',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0].sessions?.[0]).toMatchObject({
      sessionType: 'squash',
      subtype: 'control',
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: 'Squash - Control de juego', durationMin: 60 }],
      },
    })
    expect(response.meta?.createWeekDiagnostics?.[0].repairedSessions).toEqual([
      { index: 0, repairs: ['sessionType', 'subtype', 'squashDetails'] },
    ])
  })

  it('recovers complete sessions from a truncated raw create_week JSON response', () => {
    const response = normalizeResponse({
      text: [
        '{',
        '"type":"create_week",',
        '"targetDate":"2026-06-08",',
        '"reason":"Respuesta parcial de Gemini",',
        '"weekObjectives":["Mantener calidad"],',
        '"sessions":[',
        JSON.stringify({
          date: '2026-06-08',
          timeBlock: 'AM',
          sessionType: 'squash/control',
          title: 'Squash - Control',
          durationMin: 60,
          objective: 'Controlar la T y consistencia',
        }),
        ',{"date":"2026-06-09","timeBlock":"PM","sessionType":"strength","title":"Fuerza',
      ].join(''),
      provider: 'mock',
      requestClass: 'plan_builder_week',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-06-08',
      sessions: [
        {
          date: '2026-06-08',
          sessionType: 'squash',
          subtype: 'control',
        },
      ],
    })
    expect(response.meta?.likelyTruncated).toBe(true)
    expect(response.meta?.createWeekDiagnostics?.[0]).toMatchObject({
      rawSessions: 1,
      validSessions: 1,
    })
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

  it('preserves strength load metadata (targetPercent1RM, targetRpe, warmupSets) on exercise proposals', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'fuerza con cargas sugeridas',
            targetDate: '2026-04-10',
            sessionType: 'strength',
            title: 'Lower pesado',
            durationMin: 60,
            timeBlock: 'AM',
            exercises: [
              {
                name: 'Sentadilla',
                sets: 4,
                reps: 6,
                weight: 110,
                targetPercent1RM: 80,
                warmupSets: [
                  { reps: 5, weight: 55, percent1RM: 40 },
                  { reps: 3, weight: 80, percent1RM: 60 },
                ],
              },
              {
                name: 'Curl femoral',
                sets: 3,
                reps: 10,
                targetRpe: 8,
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    const action = response.actions?.[0]
    const sentadilla = action?.exercises?.find((exercise) => exercise.name === 'Sentadilla')
    expect(sentadilla).toMatchObject({
      name: 'Sentadilla',
      weight: 110,
      targetPercent1RM: 80,
      warmupSets: [
        { reps: 5, weight: 55, percent1RM: 40 },
        { reps: 3, weight: 80, percent1RM: 60 },
      ],
    })
    const curl = action?.exercises?.find((exercise) => exercise.name === 'Curl femoral')
    expect(curl).toMatchObject({
      name: 'Curl femoral',
      targetRpe: 8,
    })
  })

  it('drops out-of-range strength load metadata during normalization', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify([
          {
            type: 'add_session',
            reason: 'fuerza con cargas invalidas',
            targetDate: '2026-04-10',
            sessionType: 'strength',
            title: 'Lower pesado',
            durationMin: 60,
            timeBlock: 'AM',
            exercises: [
              {
                name: 'Sentadilla',
                sets: 4,
                reps: 6,
                targetPercent1RM: 180,
                targetRpe: 12,
                warmupSets: [
                  { reps: 5, weight: 55, percent1RM: 140 },
                ],
              },
            ],
          },
        ]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
    })

    const exercise = response.actions?.[0].exercises?.find((item) => item.name === 'Sentadilla')
    expect(exercise?.targetPercent1RM).toBeUndefined()
    expect(exercise?.targetRpe).toBeUndefined()
    expect(exercise?.warmupSets?.[0]).toEqual({ reps: 5, weight: 55 })
  })

  it('repairs squashDetails with minimal defaults when drills items do not have a valid shape', () => {
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

    expect(response.actions?.[0].squashDetails).toEqual({
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      drills: [{ name: 'Squash tecnico', durationMin: 45 }],
    })
  })

  it('repairs squashDetails when drills is empty instead of dropping the session', () => {
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

    expect(response.actions?.[0]).toMatchObject({ type: 'add_session', title: 'Squash tecnico' })
    expect(response.actions?.[0].squashDetails).toEqual({
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      drills: [{ name: 'Squash tecnico', durationMin: 45 }],
    })
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

  it('parses a single inline JSON action object when the model omits the actions tag', () => {
    const response = normalizeResponse({
      text: JSON.stringify({
        type: 'create_week',
        reason: 'Semana base compacta',
        targetDate: '2026-04-06',
        sessions: [
          {
            date: '2026-04-06',
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
      }),
      provider: 'mock',
      requestClass: 'week_creator',
    })

    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-04-06',
    })
    expect(response.message).toBe('')
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
            objective: 'Mejorar control de la T, voleas y movimiento especifico.',
            squashDetails: {
              sessionKind: 'mixed',
              trainingFocus: 'conditioned_games',
              blocks: [
                {
                  kind: 'technical',
                  durationMin: 34,
                  drills: [{ name: 'Control de la T con patron largo-corto', durationMin: 18 }],
                },
                {
                  kind: 'shadows',
                  durationMin: 16,
                  drills: [{ name: 'Split-step y vuelta a la T', durationMin: 16 }],
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
      'Split-step y vuelta a la T',
      'Control de la T con patron largo-corto',
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

  it('normalizes dedicated match-play to one best-of-five match', () => {
    const response = normalizeResponse({
      text: [
        '<actions>',
        JSON.stringify([{
          type: 'add_session',
          reason: 'Día de match play',
          targetDate: '2026-04-11',
          sessionType: 'squash',
          title: 'Squash match play',
          durationMin: 60,
          timeBlock: 'PM',
          subtype: 'match',
          squashDetails: {
            trainingFocus: 'conditioned_games',
            sessionMode: 'practice_match',
            sessionKind: 'match',
            blocks: [{
              kind: 'match',
              drills: [
                { name: 'Partido de entrenamiento al mejor de 3 juegos' },
                { name: 'Game a 11 con marcador real' },
              ],
            }],
            drills: [
              { name: 'Partido de entrenamiento al mejor de 3 juegos' },
              { name: 'Game a 11 con marcador real' },
            ],
          },
        }]),
        '</actions>',
      ].join('\n'),
      provider: 'mock',
      requestClass: 'chat_action',
    })

    expect(response.actions?.[0].squashDetails).toMatchObject({
      sessionMode: 'practice_match',
      sessionKind: 'match',
      drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
      blocks: [{
        kind: 'match',
        drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos' }],
      }],
    })
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

  describe('tolerant squashDetails normalization', () => {
    function createWeekWithSquashDetails(squashDetails: unknown) {
      return normalizeResponse({
        text: [
          '<actions>',
          JSON.stringify([
            {
              type: 'create_week',
              reason: 'Semana de presion',
              targetDate: '2026-06-15',
              sessions: [
                {
                  date: '2026-06-15',
                  timeBlock: 'PM',
                  sessionType: 'squash',
                  title: 'Pressure drills',
                  durationMin: 60,
                  objective: 'Presion bajo fatiga',
                  squashDetails,
                },
              ],
            },
          ]),
          '</actions>',
        ].join('\n'),
        provider: 'mock',
      })
    }

    it('coerces an invalid trainingFocus synonym instead of dropping the session', () => {
      const response = createWeekWithSquashDetails({
        trainingFocus: 'match_play',
        sessionMode: 'drill_session',
        drills: [{ name: 'Puntos condicionados', durationMin: 40 }],
      })

      expect(response.meta?.createWeekDiagnostics?.[0].droppedSessions).toBe(0)
      expect(response.actions?.[0].sessions?.[0].squashDetails).toMatchObject({
        trainingFocus: 'conditioned_games',
        drills: [{ name: 'Puntos condicionados', durationMin: 40 }],
      })
    })

    it('coerces an invented sessionMode keeping the model drills', () => {
      const response = createWeekWithSquashDetails({
        trainingFocus: 'tactical',
        sessionMode: 'match',
        sessionKind: 'match',
        drills: [{ name: 'Match play controlado', durationMin: 45 }],
      })

      expect(response.meta?.createWeekDiagnostics?.[0].droppedSessions).toBe(0)
      expect(response.actions?.[0].sessions?.[0].squashDetails).toMatchObject({
        trainingFocus: 'tactical',
        sessionMode: 'practice_match',
        sessionKind: 'match',
      })
    })

    it('falls back to minimal default details when squashDetails is unusable', () => {
      const response = createWeekWithSquashDetails({ trainingFocus: 'technical', drills: [] })

      expect(response.meta?.createWeekDiagnostics?.[0].droppedSessions).toBe(0)
      expect(response.actions?.[0].sessions?.[0].squashDetails).toMatchObject({
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [{ name: 'Pressure drills', durationMin: 60 }],
      })
    })
  })
})
