import { db } from '../../db/db'
import { useAuthStore } from '../../store/useAuthStore'
import { useChatStore } from '../../store/useChatStore'
import { useCoachActionsStore } from '../../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import { usePlanBuilderStore } from '../../store/usePlanBuilderStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import { bumpSwitchEpoch, getSelfAthleteId, setActiveAthleteId } from './activeAthlete'
import { persistAthleteSelection } from './athleteSelection'

/**
 * Switches the active athlete after validating ownership and active status.
 * Returning to self clears the persisted selection, keeping the single-athlete
 * path pristine.
 */
export async function switchActiveAthlete(ownerAccountId: string, athleteId: string): Promise<boolean> {
  const row = await db.athletes.get(athleteId)
  const isValid = !!row && row.ownerAccountId === ownerAccountId && row.status === 'active'
  if (!isValid) return false

  bumpSwitchEpoch()
  useChatStore.getState().resetForAthleteSwitch()
  useTrainingStore.getState().resetForAthleteSwitch()
  usePlanBuilderStore.getState().resetForAthleteSwitch()
  useCoachActionsStore.getState().resetForAthleteSwitch()
  useCoachMemoryStore.getState().resetForAthleteSwitch()

  const isSelf = athleteId === getSelfAthleteId()
  persistAthleteSelection(ownerAccountId, isSelf ? null : athleteId)
  setActiveAthleteId(athleteId)
  useAuthStore.getState().setActiveAthleteId(athleteId)
  await useCoachMemoryStore.getState().loadMemory()
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
