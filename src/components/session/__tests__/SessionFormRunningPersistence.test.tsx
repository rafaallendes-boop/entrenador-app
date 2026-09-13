// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '../../../types'
import type { CoachSessionDraft } from '../../../services/athlete/coachSessionSerializer'
import { applyCoachSessionPatch, draftToPatch, sessionToDraft } from '../../../services/athlete/coachSessionSerializer'
import { materializeRunningTemplate } from '../../../services/training/runningTemplateMaterializer'
import { db } from '../../../db/db'
import SessionForm from '../SessionForm'

afterEach(cleanup)

it('A3: la fila de Dexie conserva estructura y procedencia tras editar el título', async () => {
  const profile = { id: 'ath', updatedAt: 100, runningProfile: { fiveKTime: '25:00', z2PaceMax: '6:30' } }
  const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: profile.runningProfile, intent: 'progress', profileRevision: 100 })
  if (!dose.ok) throw new Error(dose.message)
  const session: Session = {
    id: 'run-1', athleteId: 'ath', date: '2026-08-10', weekStartDate: '2026-08-10', timeBlock: 'AM', type: 'running',
    status: 'planned', source: 'coach', title: 'Series 400', durationMin: 60, createdAt: 0, updatedAt: 0,
    runningDetails: { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization },
  }
  await db.sessions.put(session)

  let submitted: CoachSessionDraft | undefined
  render(<SessionForm origin="existing" initialValues={sessionToDraft(session)} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={async draft => { submitted = draft }} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Titulo'), { target: { value: 'Series 400 (martes)' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

  // Mismo camino que CoachSessionModal → updateSessionForAthlete → applyCoachSessionPatch → Dexie.
  const next = applyCoachSessionPatch(session, draftToPatch(submitted!, session))
  await db.sessions.put(next)
  const reread = await db.sessions.get('run-1')
  expect(reread?.title).toBe('Series 400 (martes)')
  expect(reread?.runningDetails?.intervalStructure).toEqual(session.runningDetails?.intervalStructure)
  expect(reread?.runningDetails?.materialization).toEqual(session.runningDetails?.materialization)
})
