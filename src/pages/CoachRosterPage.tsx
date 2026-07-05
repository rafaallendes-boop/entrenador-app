import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { isCoachAccount } from '../services/athlete/coachAccess'
import { getSelfAthleteId } from '../services/athlete/activeAthlete'
import { createManagedAthlete, listOwnedAthletes } from '../services/athlete/managedAthletes'
import { switchActiveAthlete } from '../services/athlete/switchActiveAthlete'
import { ROUTES } from '../constants/routes'
import type { Athlete } from '../types'

interface CoachRosterPageProps {
  /** Solo tests: inyecta la allowlist sin depender de import.meta.env. */
  allowlistOverride?: string
  /** Solo tests: roster inicial (renderToStaticMarkup no ejecuta efectos). */
  initialAthletes?: Athlete[]
}

export default function CoachRosterPage({ allowlistOverride, initialAthletes }: CoachRosterPageProps) {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes ?? [])
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const isCoach = allowlistOverride !== undefined
    ? isCoachAccount(user, allowlistOverride)
    : isCoachAccount(user)

  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    void listOwnedAthletes(user.id).then((rows) => {
      if (!cancelled) setAthletes(rows)
    })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId])

  if (!isCoach || !user?.id) return <Navigate to={ROUTES.HOME} replace />

  const selfId = getSelfAthleteId()

  async function handleCreate() {
    if (!user?.id) return
    setError(null)
    try {
      const athlete = await createManagedAthlete(user.id, newName)
      const ok = await switchActiveAthlete(user.id, athlete.id)
      if (!ok) {
        setError('No se pudo activar el atleta creado. Intenta abrirlo desde la lista.')
        return
      }
      setNewName('')
      setIsCreating(false)
      // Completar el perfil del gestionado con el flujo guiado (spec 2b §6).
      navigate(ROUTES.ONBOARDING)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el atleta.')
    }
  }

  async function handleTrainAs(athleteId: string) {
    if (!user?.id || athleteId === activeAthleteId) return
    const ok = await switchActiveAthlete(user.id, athleteId)
    if (ok) navigate(ROUTES.HOME)
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-8 pt-12">
      <div className="mb-6 flex items-center gap-2">
        <Users size={20} className="text-brand" />
        <h1 className="font-display text-2xl font-bold text-ink">Mis atletas</h1>
      </div>

      <div className="space-y-3">
        {athletes.map((athlete) => {
          const isSelf = athlete.id === selfId
          const isActive = athlete.id === activeAthleteId
          return (
            <div
              key={athlete.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {isSelf ? 'Tú' : (athlete.displayName ?? 'Atleta')}
                </p>
                {isActive && <p className="text-xs text-brand">Entrenando ahora</p>}
              </div>
              {!isActive && (
                <button
                  type="button"
                  onClick={() => void handleTrainAs(athlete.id)}
                  className="flex-shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
                >
                  Entrenar como este atleta
                </button>
              )}
            </div>
          )
        })}
      </div>

      {isCreating ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-muted">Nombre del atleta</span>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ej. Juan Pérez"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setIsCreating(false); setError(null) }}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-ink-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() => void handleCreate()}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Crear y completar perfil
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <Plus size={16} />
          Crear atleta
        </button>
      )}
    </div>
  )
}
