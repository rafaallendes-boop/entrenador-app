import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { materializeRunningTemplate, RUNNING_MATERIALIZER_VERSION } from '../runningTemplateMaterializer'
import { sessionToTemplatePayload, templateToDraft } from '../../athlete/sessionTemplateSerializer'
import { applyCoachSessionPatch, draftToPatch, sessionToDraft } from '../../athlete/coachSessionSerializer'
import { parseAppDataExport } from '../../dataExport'

function materialize(intent?: 'progress' | 'hold' | 'deload' | 'rotate') {
  const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: { fiveKTime: '25:00' }, intent, profileRevision: 42 })
  if (!dose.ok) throw new Error(dose.message)
  return dose
}

describe('A3.1 — procedencia de la materialización', () => {
  it('estampa intención, versiones y revisión de perfil', () => {
    const dose = materialize('progress')
    expect(dose.materialization).toMatchObject({
      intent: 'progress', recipeVersion: dose.templateRef.version,
      materializerVersion: RUNNING_MATERIALIZER_VERSION, profileRevision: 42,
    })
    expect(typeof dose.materialization.at).toBe('number')
  })

  it('sin intención declarada la procedencia dice hold y la dosis es la de hold', () => {
    const implicit = materialize()
    const explicitHold = materialize('hold')
    expect(implicit.materialization.intent).toBe('hold')
    expect(implicit.structure).toEqual(explicitHold.structure)
  })

  it('sobrevive a plantilla, patch de edición y backup', () => {
    const dose = materialize('progress')
    const session: Session = {
      id: 'run-1', date: '2026-08-10', weekStartDate: '2026-08-10', timeBlock: 'AM', type: 'running',
      status: 'planned', source: 'coach', title: '400s', durationMin: 60, createdAt: 0, updatedAt: 0,
      runningDetails: { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization },
    }
    const payload = sessionToTemplatePayload(session)
    expect(payload.runningDetails?.materialization).toEqual(dose.materialization)
    expect(templateToDraft(payload, '2026-08-17').draft.runningTargets?.materialization).toEqual(dose.materialization)

    const edited = applyCoachSessionPatch(session, draftToPatch({ ...sessionToDraft(session), title: 'Otro título' }, session))
    expect(edited.runningDetails?.materialization).toEqual(dose.materialization)
    expect(edited.runningDetails?.intervalStructure).toEqual(dose.structure)

    // Sobre del backup v4 tal como lo produce `exportAppData`; `parseAppDataExport`
    // recibe el objeto ya parseado, no el string. Las tablas ausentes se tratan
    // como vacías.
    const envelope = {
      app: 'RallyIQ', version: 4, exportedAt: '2026-09-12T12:00:00.000Z', exportedFromAppVersion: 'test',
      tables: { sessions: [session], dayLogs: [], weekSummaries: [], chatMessages: [], coachProposals: [], athleteProfiles: [] },
    }
    const parsed = parseAppDataExport(JSON.parse(JSON.stringify(envelope)))
    expect(parsed.tables.sessions[0]?.runningDetails?.materialization).toEqual(dose.materialization)
  })
})
