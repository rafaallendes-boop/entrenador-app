import { describe, expect, it } from 'vitest'
import type { TriageSignal } from '../../athlete/coachRosterTriage'
import {
  ASSISTANT_MESSAGE_MAX_CHARS,
  ASSISTANT_MESSAGE_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantMessageInput,
  parseAssistantMessageResult,
} from '../assistantMessage'

describe('assistantMessage', () => {
  it('construye el payload campo por campo con sólo las claves permitidas', () => {
    const signals: TriageSignal[] = [
      { kind: 'pain', days: 2 },
      { kind: 'overdue-sessions', count: 3, oldestDaysAgo: 8 },
      { kind: 'no-check-in', days: 5 },
      { kind: 'low-adherence', adherencePct: 45 },
    ]

    const input = buildAssistantMessageInput(signals)

    expect(Object.keys(input)).toEqual(['signals'])
    expect(input.signals.map((signal) => Object.keys(signal))).toEqual([
      ['kind', 'days'],
      ['kind', 'count', 'oldestDaysAgo'],
      ['kind', 'days'],
      ['kind', 'adherencePct'],
    ])
    expect(input).toEqual({ signals })

    const serialized = JSON.stringify(input)
    for (const forbidden of ['name', 'athleteId', 'painNotes', 'date', 'id', '2026-']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('declara un schema cerrado para el cuerpo', () => {
    expect(ASSISTANT_MESSAGE_SCHEMA).toEqual({
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
      additionalProperties: false,
    })
  })

  it('descarta JSON inválido sin lanzar', () => {
    expect(parseAssistantMessageResult('no es json')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('descarta una respuesta sin body', () => {
    expect(parseAssistantMessageResult('{"text":"hola"}')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('descarta una respuesta con propiedades extra', () => {
    expect(parseAssistantMessageResult('{"body":"hola","advice":"baja la carga"}'))
      .toEqual({ ok: false, reason: 'invalid' })
  })

  it('descarta un body no textual, vacío y sobre el tope', () => {
    expect(parseAssistantMessageResult('{"body":42}')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAssistantMessageResult('{"body":"   "}')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAssistantMessageResult(JSON.stringify({
      body: 'x'.repeat(ASSISTANT_MESSAGE_MAX_CHARS + 1),
    }))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('distingue una respuesta demasiado larga para mostrar un motivo honesto', () => {
    expect(parseAssistantMessageResult(JSON.stringify({
      body: 'x'.repeat(ASSISTANT_MESSAGE_MAX_CHARS + 1),
    }))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('acepta y recorta una respuesta válida', () => {
    expect(parseAssistantMessageResult('{"body":"  ¿Cómo vas?  "}'))
      .toEqual({ ok: true, body: '¿Cómo vas?' })
  })

  it('elimina un saludo inicial para no duplicar el que agrega la UI', () => {
    expect(parseAssistantMessageResult(JSON.stringify({
      body: '¡Hola! Llevas varios días sin hacer check-in. ¿Cómo vas?',
    }))).toEqual({
      ok: true,
      body: 'Llevas varios días sin hacer check-in. ¿Cómo vas?',
    })
    expect(parseAssistantMessageResult(JSON.stringify({
      body: 'Hola,\n¿cómo te has sentido?',
    }))).toEqual({ ok: true, body: '¿cómo te has sentido?' })
  })

  it('no acepta una respuesta que queda vacía al quitar el saludo', () => {
    expect(parseAssistantMessageResult('{"body":"¡Hola!"}'))
      .toEqual({ ok: false, reason: 'invalid' })
  })

  it('prohíbe diagnóstico, tratamiento y cambios de carga, y limita dolor a preguntar', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no dar diagnósticos/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no sugerir tratamiento/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no proponer cambios de carga/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/dolor.*únicamente una pregunta/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/pain\.days.*fechas de check-in distintas/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no implica duración ni días consecutivos/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/cliente antepone.*saludo/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no-check-in.*feedback diario/i)
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no significa.*entrenamientos/i)
    expect(ASSISTANT_SYSTEM_PROMPT.length).toBeLessThanOrEqual(8_000)
  })
})
