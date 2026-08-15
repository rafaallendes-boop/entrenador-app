export interface CreateWeekCollisionSlot {
  date: string
  timeBlock: string
}

function preservedSessionKind(preserveManualSessions: boolean): string {
  return preserveManualSessions ? 'manuales o con historial' : 'con historial'
}

export function formatCreateWeekCollisionWarning(
  collisions: readonly CreateWeekCollisionSlot[],
  preserveManualSessions: boolean,
): string {
  const slots = collisions.map((item) => `${item.date} ${item.timeBlock}`).join(', ')
  return `Se mantuvieron sesiones ${preservedSessionKind(preserveManualSessions)} en: ${slots}`
}

export function formatCreateWeekPreservedCountWarning(
  count: number,
  preserveManualSessions: boolean,
): string {
  return `Se conservaron ${count} sesiones ${preservedSessionKind(preserveManualSessions)} en la misma semana para no borrar adherencia ya registrada.`
}

export function formatPlanBuilderCollisionBanner(preserveManualSessions: boolean): string {
  return `Hay sesiones ${preservedSessionKind(preserveManualSessions)} en fechas del plan. Se conservarán y no se sobrescribirá adherencia registrada.`
}
