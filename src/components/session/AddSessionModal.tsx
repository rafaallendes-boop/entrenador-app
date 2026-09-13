import type { SessionType } from '../../types'
import { useTrainingStore } from '../../store/useTrainingStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import { draftToNewSessionFields } from '../../services/athlete/coachSessionSerializer'
import SessionForm from './SessionForm'

interface Props {
  defaultDate?: string
  onClose: () => void
}

export default function AddSessionModal({ defaultDate, onClose }: Props) {
  const { addSession } = useTrainingStore()
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
          origin="new"
          defaultSport={defaultType}
          defaultDate={defaultDate}
          heading="Nueva sesion"
          submitLabel="Agregar sesion"
          onCancel={onClose}
          onSubmit={async (draft) => {
            await addSession({ ...draftToNewSessionFields(draft), source: 'manual' })
            onClose()
          }}
        />
      </div>
    </div>
  )
}
