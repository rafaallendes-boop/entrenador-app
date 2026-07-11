const CLAIM_TOKEN_STORAGE_KEY = 'entrenador_pending_claim_token_v1'
let memoryFallback: string | null = null

export function capturePendingClaimTokenFromUrl(
  href: string = (globalThis as { location?: { href?: string } }).location?.href ?? '',
): void {
  try {
    const token = new URL(href).searchParams.get('claim')
    if (token?.trim()) {
      memoryFallback = token.trim()
      if (typeof localStorage !== 'undefined') localStorage.setItem(CLAIM_TOKEN_STORAGE_KEY, token.trim())
    }
  } catch {
    // Invalid URL or unavailable storage leaves the gate inactive.
  }
}

export function getPendingClaimToken(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(CLAIM_TOKEN_STORAGE_KEY) ?? memoryFallback
      : memoryFallback
  } catch {
    return null
  }
}

export function clearPendingClaimToken(): void {
  try {
    memoryFallback = null
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CLAIM_TOKEN_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in private/SSR contexts.
  }
}

export function isClaimPending(): boolean {
  return getPendingClaimToken() !== null
}
