import { describe, expect, it } from 'vitest'
import { resolveApiUrl } from '../apiUrl'

describe('resolveApiUrl', () => {
  const coachPath = '/.netlify/functions/coach'

  it('keeps same-origin function paths on web', () => {
    expect(resolveApiUrl(coachPath, { native: false })).toBe(coachPath)
  })

  it('uses the deployed backend origin inside Capacitor', () => {
    expect(resolveApiUrl(coachPath, {
      native: true,
      apiBaseUrl: 'https://app.example.com/some/path/',
    })).toBe('https://app.example.com/.netlify/functions/coach')
  })

  it('fails clearly when a native build has no backend origin', () => {
    expect(() => resolveApiUrl(coachPath, { native: true, apiBaseUrl: '' }))
      .toThrow('VITE_API_BASE_URL')
  })

  it('rejects non-function paths', () => {
    expect(() => resolveApiUrl('/settings', { native: false })).toThrow('Ruta de API no permitida')
  })
})
