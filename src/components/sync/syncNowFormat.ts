/** Última sincronización en lenguaje humano (recién / hace N min / hace N h / fecha). */
export function formatLastSync(lastSyncAt: number | null): string {
  if (!lastSyncAt) return 'Nunca sincronizado'
  const diffMs = Date.now() - lastSyncAt
  if (diffMs < 30_000) return 'recién'
  const min = Math.floor(diffMs / 60_000)
  if (min < 60) return `hace ${min} min`
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 7) return `hace ${days} d`
  return new Date(lastSyncAt).toLocaleDateString('es')
}
