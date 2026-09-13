import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Users, Zap } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { isCoachAccount } from '../../services/athlete/coachAccess'
import { useEntitlementStore } from '../../store/useEntitlementStore'
import { getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { listRosterAthletes } from '../../services/athlete/managedAthletes'
import { switchActiveAthlete } from '../../services/athlete/switchActiveAthlete'
import { ROUTES } from '../../constants/routes'
import type { Athlete } from '../../types'

interface CoachContextBarProps {
  /** Solo tests: inyecta la allowlist sin depender de import.meta.env. */
  allowlistOverride?: string
  /** Solo tests: roster inicial (renderToStaticMarkup no ejecuta efectos). */
  initialAthletes?: Athlete[]
}

export default function CoachContextBar({ allowlistOverride, initialAthletes }: CoachContextBarProps) {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes ?? [])
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()

  // Reactivo a propósito: el holder de rol no lo es, y la barra debe aparecer
  // en cuanto la hidratación confirme que la cuenta es coach.
  const accountRole = useEntitlementStore((state) => state.accountRole)
  const isCoach = allowlistOverride !== undefined
    ? isCoachAccount(user, allowlistOverride, accountRole)
    : isCoachAccount(user, undefined, accountRole)

  // Nota: el guard de scope (enforceCoachScopeGuard) NO vive aquí — este
  // componente solo monta dentro de AppShell y /onboarding queda fuera.
  // Vive en CoachScopeGuard (global). Aquí solo UI.
  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    listRosterAthletes(user.id)
      .then((rows) => {
        if (!cancelled) setAthletes(rows)
      })
      .catch((error) => {
        console.error('[coach-context-bar] failed to load roster', error)
      })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId])

  if (!isCoach || !user?.id) return null

  const selfId = getSelfAthleteId()
  const isManagedActive = activeAthleteId != null && activeAthleteId !== selfId
  const activeAthlete = athletes.find((athlete) => athlete.id === activeAthleteId)
  const idleLabel = selfId ? 'Tú' : 'Sin atleta'
  const activeLabel = isManagedActive ? (activeAthlete?.displayName ?? 'Atleta') : idleLabel

  async function handleSwitch(athleteId: string) {
    setIsOpen(false)
    if (!user?.id || athleteId === activeAthleteId) return
    await switchActiveAthlete(user.id, athleteId)
  }

  if (isManagedActive) {
    return (
      <div className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-[#ff5a1f]/30 bg-[linear-gradient(135deg,rgba(255,90,31,0.22),rgba(14,14,14,0.97))] px-4 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#ffd2bf]">
          <Zap size={14} className="flex-shrink-0 text-[#ff7a33]" />
          <span className="truncate">Entrenando a {activeLabel}</span>
        </span>
        {selfId ? (
          <button
            type="button"
            onClick={() => void handleSwitch(selfId)}
            className="flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            Volver a ti
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(ROUTES.COACH)}
            className="flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            Workspace
          </button>
        )}
      </div>
    )
  }


  return (
    <div className="relative z-40 flex justify-end px-4 pt-2">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <Users size={13} />
        <span>{activeLabel}</span>
        <ChevronDown size={13} />
      </button>
      {isOpen && (
        <div className="absolute right-4 top-9 w-52 rounded-xl border border-white/10 bg-[#161616] p-1.5 shadow-xl">
          {athletes.map((athlete) => (
            <button
              key={athlete.id}
              type="button"
              onClick={() => void handleSwitch(athlete.id)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-white/5"
            >
              <span className="truncate">{athlete.id === selfId ? 'Tú' : (athlete.displayName ?? 'Atleta')}</span>
              {athlete.id === activeAthleteId && <span className="text-xs text-brand">activo</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setIsOpen(false); navigate(ROUTES.COACH) }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/5 px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:text-ink"
          >
            Gestionar atletas
          </button>
        </div>
      )}
    </div>
  )
}
