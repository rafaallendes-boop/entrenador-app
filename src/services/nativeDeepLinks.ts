export function getWhoopCallbackPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'rallyiq:' || url.hostname !== 'settings') return null
    const result = url.searchParams.get('whoop')
    return result === 'connected' || result === 'error'
      ? `/settings?whoop=${result}`
      : null
  } catch {
    return null
  }
}
