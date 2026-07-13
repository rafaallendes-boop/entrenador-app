export function getWhoopCallbackPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'rallyiq:' || url.hostname !== 'settings') return null
    const result = url.searchParams.get('whoop')
    if (result !== 'connected' && result !== 'error') return null

    const reason = url.searchParams.get('reason')
    const allowedReasons = new Set([
      'authorization_denied',
      'invalid_callback',
      'expired_state',
      'state_error',
      'token_exchange',
      'connection_save',
    ])
    return reason && allowedReasons.has(reason)
      ? `/settings?whoop=${result}&reason=${reason}`
      : `/settings?whoop=${result}`
  } catch {
    return null
  }
}
