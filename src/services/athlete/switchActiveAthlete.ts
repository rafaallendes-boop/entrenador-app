import { useAuthStore } from '../../store/useAuthStore'
import { useChatStore } from '../../store/useChatStore'
import { useCoachActionsStore } from '../../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import { usePlanBuilderStore } from '../../store/usePlanBuilderStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import { bumpSwitchEpoch, getSelfAthleteId, setActiveAthleteId } from './activeAthlete'
import { persistAthleteSelection } from './athleteSelection'
import { resolveRosterEntry } from './coachRosterEligibility'

function resetStoresForSwitch(): void {
  bumpSwitchEpoch()
  useChatStore.getState().resetForAthleteSwitch()
  useTrainingStore.getState().resetForAthleteSwitch()
  usePlanBuilderStore.getState().resetForAthleteSwitch()
  useCoachActionsStore.getState().resetForAthleteSwitch()
  useCoachMemoryStore.getState().resetForAthleteSwitch()
}

/**
 * Cambia el atleta activo tras validar elegibilidad (membresía, o clasificación
 * legacy sin membresías en caché) y estado activo. Volver al self limpia la
 * selección persistida, conservando prístino el camino de un solo atleta.
 */
export async function switchActiveAthlete(accountId: string, athleteId: string): Promise<boolean> {
  const entry = await resolveRosterEntry(accountId, athleteId)
  if (!entry || entry.athlete.status !== 'active') return false

  resetStoresForSwitch()

  const isSelf = entry.access === 'self' || athleteId === getSelfAthleteId()
  persistAthleteSelection(accountId, isSelf ? null : athleteId)
  setActiveAthleteId(athleteId)
  useAuthStore.getState().setActiveAthleteId(athleteId)
  // Post-commit: el scope ya cambió. Un fallo de memoria no puede convertir un
  // switch aplicado en excepción — la memoria se recarga en el próximo intento.
  try {
    await useCoachMemoryStore.getState().loadMemory()
  } catch (error) {
    console.error('[switch-athlete] no se pudo cargar la memoria del coach', error)
  }
  if (isSelf) {
    void (async () => {
      const { pullWorkouts } = await import('../readiness/pullWorkouts')
      const { autoCompleteFromWorkouts } = await import('../readiness/autoCompleteFromWorkouts')
      await pullWorkouts()
      await autoCompleteFromWorkouts()
    })().catch(() => undefined)
  }
  return true
}

/**
 * Deja la cuenta sin atleta activo (scope `none`). Es el destino de una cuenta
 * coach cuando archiva o borra al atleta que tenía seleccionado: no hay self al
 * que volver. En una cuenta atleta el llamador debe volver al self, no usar esto.
 */
export async function clearActiveAthleteSelection(accountId: string): Promise<void> {
  resetStoresForSwitch()
  persistAthleteSelection(accountId, null)
  setActiveAthleteId(null)
  useAuthStore.getState().setActiveAthleteId(null)
}
