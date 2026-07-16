/** Habilita el borrado solo cuando se escribe el nombre completo del atleta. */
export function isDeleteConfirmed(
  input: string,
  displayName: string | null | undefined,
): boolean {
  const expected = (displayName ?? '').trim().toLowerCase()
  if (!expected) return false
  return input.trim().toLowerCase() === expected
}
