import { useEffect, useRef, useState } from 'react'
import type { AthleteProfile, Session, SessionType } from '../../types'
import type { SupportedSessionTemplate } from '../../types/sessionTemplate'
import {
  draftToPatch,
  sessionToDraft,
  type CoachSessionDraft,
} from '../../services/athlete/coachSessionSerializer'
import { getAthleteProfileForAthlete } from '../../services/athlete/coachScopedReads'
import {
  createSessionForAthlete,
  createSessionFromTemplateForAthlete,
  updateSessionForAthlete,
} from '../../services/athlete/coachScopedWrites'
import { templateToDraft } from '../../services/athlete/sessionTemplateSerializer'
import SessionForm from '../session/SessionForm'

interface CoachSessionModalProps {
  ownerAccountId: string
  athleteId: string
  defaultDate: string
  session?: Session
  template?: { source: SupportedSessionTemplate }
  onClose: () => void
  onSaved: () => void
}

export default function CoachSessionModal({
  ownerAccountId,
  athleteId,
  defaultDate,
  session,
  template,
  onClose,
  onSaved,
}: CoachSessionModalProps) {
  const [templateDraftState] = useState(() => (
    template ? templateToDraft(template.source.payload, defaultDate) : null
  ))
  const [defaultSport, setDefaultSport] = useState<SessionType | null>(
    template?.source.payload.type ?? session?.type ?? null,
  )
  const [athleteProfile, setAthleteProfile] = useState<AthleteProfile | undefined>()
  const submittingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void getAthleteProfileForAthlete(ownerAccountId, athleteId)
      .then((profile) => {
        if (cancelled) return
        setAthleteProfile(profile)
        const sport = profile?.sportContext?.primarySport ?? profile?.primarySport ?? 'squash'
        if (!session && !template) setDefaultSport(sport as SessionType)
      })
      .catch(() => {
        if (!cancelled && !session && !template) setDefaultSport('squash')
      })
    return () => { cancelled = true }
  }, [athleteId, ownerAccountId, session, template])

  const handleSubmit = async (draft: CoachSessionDraft) => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      if (template && templateDraftState) {
        await createSessionFromTemplateForAthlete(
          ownerAccountId,
          athleteId,
          template.source.payload,
          {
            date: draft.date,
            overlayDraft: draft,
            originalsById: templateDraftState.originalsById,
          },
        )
      } else if (session) {
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
          athleteProfile={athleteProfile}
          initialValues={templateDraftState?.draft ?? (session ? sessionToDraft(session) : undefined)}
          defaultSport={defaultSport}
          defaultDate={defaultDate}
          heading={session ? 'Editar sesion' : 'Nueva sesion'}
          submitLabel={session ? 'Guardar cambios' : 'Agregar sesión'}
          allowMatchResult={false}
          onSubmit={handleSubmit}
          onCancel={requestClose}
        />
      </div>
    </div>
  )
}
