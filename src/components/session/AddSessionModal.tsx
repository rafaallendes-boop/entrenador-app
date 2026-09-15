import type { Session, SessionType } from '../../types'
import { useTrainingStore } from '../../store/useTrainingStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import {
  applyCoachSessionPatch,
  draftToNewSessionFields,
  draftToPatch,
  sessionToDraft,
} from '../../services/athlete/coachSessionSerializer'
import SessionForm from './SessionForm'

interface Props {
  defaultDate?: string
  session?: Session
  onClose: () => void
}

export default function AddSessionModal({ defaultDate, session, onClose }: Props) {
  const { addSession, updateSession } = useTrainingStore()
  const { athleteProfile } = useCoachMemoryStore()
  const defaultType = (
    athleteProfile?.sportContext?.primarySport as SessionType | undefined
  ) ?? 'squash'

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center md:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-h-[92vh] overflow-y-auto rounded-t-2xl border-t border-surface-border bg-surface-card md:max-w-3xl md:rounded-2xl md:border md:max-h-[88vh]">
        <SessionForm
          athleteProfile={athleteProfile}
          origin={session ? 'existing' : 'new'}
          sessionStatus={session?.status}
          initialValues={session ? sessionToDraft(session) : undefined}
          defaultSport={session?.type ?? defaultType}
          defaultDate={session?.date ?? defaultDate}
          heading={session ? 'Editar sesion' : 'Nueva sesion'}
          submitLabel={session ? 'Guardar cambios' : 'Agregar sesion'}
          onCancel={onClose}
          onSubmit={async (draft) => {
            if (session) {
              await updateSession(session.id, applyCoachSessionPatch(session, draftToPatch(draft, session)))
            } else {
              await addSession({ ...draftToNewSessionFields(draft), source: 'manual' })
            }
            onClose()
          }}
        />
      </div>
    </div>
  )
}
