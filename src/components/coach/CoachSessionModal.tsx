import { useEffect, useRef, useState } from 'react'
import type { Session, SessionType } from '../../types'
import {
  draftToPatch,
  sessionToDraft,
  type CoachSessionDraft,
} from '../../services/athlete/coachSessionSerializer'
import { getAthleteProfileForAthlete } from '../../services/athlete/coachScopedReads'
import {
  createSessionForAthlete,
  updateSessionForAthlete,
} from '../../services/athlete/coachScopedWrites'
import SessionForm from '../session/SessionForm'

interface CoachSessionModalProps {
  ownerAccountId: string
  athleteId: string
  defaultDate: string
  session?: Session
  onClose: () => void
  onSaved: () => void
}

export default function CoachSessionModal({
  ownerAccountId,
  athleteId,
  defaultDate,
  session,
  onClose,
  onSaved,
}: CoachSessionModalProps) {
  const [defaultSport, setDefaultSport] = useState<SessionType | null>(session?.type ?? null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (session) return
    let cancelled = false
    void getAthleteProfileForAthlete(ownerAccountId, athleteId)
      .then((profile) => {
        if (cancelled) return
        const sport = profile?.sportContext?.primarySport ?? profile?.primarySport ?? 'squash'
        setDefaultSport(sport as SessionType)
      })
      .catch(() => {
        if (!cancelled) setDefaultSport('squash')
      })
    return () => { cancelled = true }
  }, [athleteId, ownerAccountId, session])

  const handleSubmit = async (draft: CoachSessionDraft) => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      if (session) {
        await updateSessionForAthlete(
          ownerAccountId,
          athleteId,
          session.id,
          draftToPatch(draft, session),
        )
      } else {
        await createSessionForAthlete(ownerAccountId, athleteId, draft)
      }
      onSaved()
      onClose()
    } finally {
      submittingRef.current = false
    }
  }

  const requestClose = () => {
    if (!submittingRef.current) onClose()
  }

  if (!defaultSport) return <p role="status">Preparando formulario…</p>

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center md:p-6">
      <div
        data-testid="coach-session-backdrop"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={requestClose}
      />
      <div className="relative w-full max-h-[92vh] overflow-y-auto rounded-t-2xl border-t border-surface-border bg-surface-card md:max-w-3xl md:rounded-2xl md:border md:max-h-[88vh]">
        <SessionForm
          initialValues={session ? sessionToDraft(session) : undefined}
          defaultSport={defaultSport}
          defaultDate={defaultDate}
          heading={session ? 'Editar sesion' : 'Nueva sesion'}
          submitLabel={session ? 'Guardar cambios' : 'Agregar sesión'}
          onSubmit={handleSubmit}
          onCancel={requestClose}
        />
      </div>
    </div>
  )
}
