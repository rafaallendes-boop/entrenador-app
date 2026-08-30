import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../auth', () => ({ supabase: { auth: { getSession: mocks.getSession } } }))
vi.mock('../../apiUrl', () => ({ resolveApiUrl: (path: string) => path }))

import { persistSafetyBlockedOutcome } from '../safetyOutcomeTelemetry'

describe('persistSafetyBlockedOutcome', () => {
  beforeEach(() => mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } }))
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('sends only the trace and the fixed safe outcome with the session bearer', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchSpy)

    await persistSafetyBlockedOutcome('trace-1')

    expect(fetchSpy).toHaveBeenCalledWith('/.netlify/functions/coach-request-outcome', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceId: 'trace-1', outcome: 'safety_blocked' }),
    }))
  })

  it('does not call the endpoint without a session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await persistSafetyBlockedOutcome('trace-1')

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
