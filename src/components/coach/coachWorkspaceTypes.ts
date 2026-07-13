export type CoachWorkspaceTab = 'resumen' | 'alumnos' | 'planificacion' | 'biblioteca' | 'asistente'

export type RosterStatus = 'loading' | 'ready' | 'error'

/**
 * Toda accion de atleta comparte un unico lock: crear tambien activa, asi que
 * es un switch mas y no puede correr en paralelo con otro.
 */
export type PendingAthleteAction =
  | { kind: 'week' | 'plan' | 'trainAs'; athleteId: string }
  | { kind: 'create'; athleteId: null }

export function coachTabId(tab: CoachWorkspaceTab): string {
  return `coach-tab-${tab}`
}

export function coachTabPanelId(tab: CoachWorkspaceTab): string {
  return `coach-tabpanel-${tab}`
}
