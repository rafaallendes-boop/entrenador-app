import { supabase } from '../auth'
import { resolveApiUrl } from '../apiUrl'

const OUTCOME_PATH = '/.netlify/functions/coach-request-outcome'

/** Best-effort only: no profile text or constraint data crosses this boundary. */
export async function persistSafetyBlockedOutcome(traceId: string): Promise<void> {
  if (!traceId.trim() || !supabase) return
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch(resolveApiUrl(OUTCOME_PATH), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ traceId, outcome: 'safety_blocked' }),
    })
  } catch {
    // Telemetry must never change the terminal safety response.
  }
}
