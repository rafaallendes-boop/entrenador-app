import { useEffect } from 'react'
import { useEntitlementStore } from '../../store/useEntitlementStore'
import { useAuthStore } from '../../store/useAuthStore'
import { enforceCoachScopeGuard } from '../../services/athlete/coachScopeGuard'

/**
 * Guard global de scope coach (solo efecto, sin UI). Montado dentro de
 * AuthGate y FUERA de AppShell para cubrir también /onboarding: un hard
 * refresh ahí con gestionado activo y cuenta ya no-coach debe volver al self.
 */
export default function CoachScopeGuard() {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)

  const accountRole = useEntitlementStore((state) => state.accountRole)

  useEffect(() => {
    if (!user?.id) return
    void enforceCoachScopeGuard(user)
  }, [user, activeAthleteId, accountRole])

  return null
}
