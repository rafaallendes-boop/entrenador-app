import { describe, expect, it } from 'vitest'
import { buildWeekUserPrompt, buildWeekBatchUserPrompt } from '../weekPrompt'
import { makeWeekPromptInput, makeWeekBatchPromptInput } from './fixtures'

const CLOSING_MARKER = 'Definición de listo'

describe('regla de cierre del prompt de semana', () => {
  it('incluye la definición de listo justo antes del formato de salida', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput())
    const lines = prompt.split('\n')
    const closingIndex = lines.findIndex((line) => line.includes(CLOSING_MARKER))
    const outputIndex = lines.findIndex((line) => line.startsWith('Devuelve sólo'))

    expect(closingIndex).toBeGreaterThan(-1)
    expect(outputIndex).toBeGreaterThan(-1)
    expect(closingIndex).toBeLessThan(outputIndex)
  })

  it('menciona los tres criterios verificables', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput())
    expect(prompt).toContain('coherente con la fase')
    expect(prompt).toContain('sin ajustes manuales')
    expect(prompt).toContain('directiva de carga')
  })

  it('aparece exactamente una vez', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput())
    const occurrences = prompt.split(CLOSING_MARKER).length - 1
    expect(occurrences).toBe(1)
  })

  it('también cierra el prompt batch', () => {
    const prompt = buildWeekBatchUserPrompt(makeWeekBatchPromptInput())
    const lines = prompt.split('\n')
    const closingIndex = lines.findIndex((line) => line.includes(CLOSING_MARKER))
    const outputIndex = lines.findIndex((line) => line.startsWith('Devuelve sólo'))
    expect(closingIndex).toBeGreaterThan(-1)
    expect(closingIndex).toBeLessThan(outputIndex)
  })
})
