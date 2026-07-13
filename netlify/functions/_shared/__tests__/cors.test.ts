import { describe, expect, it } from 'vitest'
import { CORS_HEADERS, corsPreflight } from '../cors'

describe('Capacitor CORS', () => {
  it('allows bearer-authenticated native requests and their preflight', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*')
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(corsPreflight()).toMatchObject({
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    })
  })
})
