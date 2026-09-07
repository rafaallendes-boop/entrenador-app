import { describe, expect, it } from 'vitest'
import { isClientErrorIngestionEnabled } from './clientErrorIngestionFlag'

describe('isClientErrorIngestionEnabled', () => {
  // Fail-closed, igual que el resto de las flags del proyecto: la ingesta se
  // enciende a propósito, nunca por omisión.
  it.each([
    ['ausente', {}],
    ['vacía', { CLIENT_ERROR_INGESTION_ENABLED: '' }],
    ['false', { CLIENT_ERROR_INGESTION_ENABLED: 'false' }],
    ['0', { CLIENT_ERROR_INGESTION_ENABLED: '0' }],
    ['basura', { CLIENT_ERROR_INGESTION_ENABLED: 'quizás' }],
  ])('está apagada con la variable %s', (_caso, env) => {
    expect(isClientErrorIngestionEnabled(env)).toBe(false)
  })

  it.each(['true', 'TRUE', ' true '])('se enciende con %s', (value) => {
    expect(isClientErrorIngestionEnabled({ CLIENT_ERROR_INGESTION_ENABLED: value })).toBe(true)
  })
})
