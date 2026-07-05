/**
 * Gate de UI del modo coach (spec 2b §2). NO es una barrera de seguridad:
 * la barrera real es la RLS por user_id. Default vacío → nadie ve la UI coach.
 */
export function parseCoachAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isCoachAccount(
  user: { email?: string | null } | null | undefined,
  rawAllowlist: string | undefined = import.meta.env.VITE_COACH_ACCOUNTS as string | undefined,
): boolean {
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false
  return parseCoachAllowlist(rawAllowlist).includes(email)
}
