import { isSquashDrillAvailable, findSquashDrillByName } from './drillLibrary'
import { selectRunningSession, type RunningContext } from './runningSelector'
import { materializeRunningTemplate, runningEffortPace } from './runningTemplateMaterializer'
import { findRunningSessionById } from './runningSessionLibrary'
import { runningProfileWithRestrictions, resolveRunningSupportPolicy } from './runningPolicy'
import type { AthleteProfile, CoachSessionProposal } from '../../types'
import { materializeRunningSession, runningTargets } from './runningSessionMaterializer'
import { doseSquashSession } from './squashSessionDose'
import { resolveSquashAvailability } from '../../types/squashTrainingContext'
import { SESSION_COMPOSITION_MINUTES, sumTimedBlocks } from './sessionTimeBudget'

export type SessionDoseResult = { ok: true; session: CoachSessionProposal } | { ok: false; message: string }

/** Prospective proposals only. Never run over completed/manual history. */
export function finalizeSessionDose(session: CoachSessionProposal, profile?: AthleteProfile | null, context?: Partial<RunningContext>): SessionDoseResult {
  // Empty legacy squash rows retain the existing content-validation contract;
  // E1 must not break lifecycle reconciliation merely because an old row has no drills.
  if (session.sessionType === 'squash') {
    const kind = session.squashDetails?.sessionKind
    const minimum = SESSION_COMPOSITION_MINUTES[kind && kind !== 'mixed' ? kind : 'technical']
    if (!Number.isFinite(session.durationMin) || session.durationMin < minimum) {
      return { ok: false, message: `No cabe "${session.title}" en ${session.durationMin} min: mínimo de composición ${minimum} min.` }
    }
  }
  if (session.sessionType === 'squash' && session.squashDetails?.drills.length) {
    const availability = resolveSquashAvailability(session.squashDetails.availability, profile?.planWizardConfig?.partnerAvailability)
    if (session.squashDetails.drills.some(d => {
      const definition = findSquashDrillByName(d.name)
      return definition && !isSquashDrillAvailable(definition, availability)
    })) return { ok: false, message: 'El contenido de squash requiere recursos no disponibles para esta sesión.' }
    const result = doseSquashSession(session.squashDetails, session.durationMin)
    return result.ok ? { ok: true, session: { ...session, squashDetails: result.details } } : result
  }
  if (session.sessionType !== 'running') return { ok: true, session }
  const runningType = session.runningType ?? 'z2'
  const runningProfile = runningProfileWithRestrictions(profile)
  if (runningProfile.impactRestriction === 'no_running'
    || runningProfile.impactRestriction === 'no_fast_running' && ['tempo', 'intervals'].includes(runningType)) {
    return { ok: false, message: 'La solicitud de running es incompatible con las restricciones activas del atleta.' }
  }
  const referenced = session.runningTemplateRef && findRunningSessionById(session.runningTemplateRef.id)
  if (runningProfile.impactRestriction === 'no_fast_running' && referenced && referenced.prescription.effort !== 'easy') return { ok: false, message: 'La plantilla incluye aceleraciones incompatibles con la restricción de carrera rápida.' }
  const policy = resolveRunningSupportPolicy({ primarySport: profile?.sportContext?.primarySport ?? profile?.primarySport,
    phase: context?.phase ?? 'base', ...context, loadRisk: context?.runningAcwr?.status === 'risk' })
  const quality = referenced ? referenced.intensity !== 'low' : ['tempo', 'intervals'].includes(runningType)
  if (context && (policy.lowOnly && quality || session.durationMin > policy.durationCap)) {
    if (policy.durationCap < 15) return { ok: false, message: 'No queda presupuesto semanal de running de apoyo para una sesión ejecutable.' }
    if (!referenced && session.intervalStructure?.blocks.length) return { ok: false, message: 'La dosis propuesta excede la intensidad o el presupuesto permitido por las sesiones vecinas.' }
    return finalizeSessionDose({ ...session, runningType: 'z2', title: 'Running Z2 de apoyo',
      durationMin: Math.min(session.durationMin, policy.durationCap), intervalStructure: undefined,
      runningTemplateRef: undefined, runningSelectionReason: policy.reason }, profile, context)
  }
  let templateRef = session.runningTemplateRef
  let selectionReason = session.runningSelectionReason
  let selectedStructure = session.intervalStructure
  if (!selectedStructure?.blocks.length) {
    if (templateRef) {
      const definition = findRunningSessionById(templateRef.id)
      if (!definition || definition.version !== templateRef.version || definition.runningType !== runningType) return { ok: false, message: 'La referencia de plantilla no corresponde a esta sesión de running.' }
      const dose = materializeRunningTemplate({ template: definition, durationMin: session.durationMin, profile: runningProfile })
      if (!dose.ok) return dose
      selectedStructure = dose.structure
    } else {
      const selected = selectRunningSession({ fatigueLevel: 4, phase: 'base', recentSessions: [],
        goal: session.objective ?? '', sportProfile: profile?.sportContext?.primarySport === 'running' ? 'running_primary' : 'sport_support',
        primarySport: profile?.sportContext?.primarySport ?? profile?.primarySport, ...context, referenceDate: session.date, sessionDurationMin: session.durationMin,
        requestedRunningType: runningType, runningProfile, experienceLevel: runningProfile.experienceLevel })
      if (!selected.session) return { ok: false, message: selected.rejectionReason! }
      session = { ...session, durationMin: selected.session.durationMin }
      selectedStructure = selected.session.intervalStructure
      templateRef = selected.session.templateRef
      selectionReason = selected.session.notes
    }
  } else if (templateRef) {
    const definition = findRunningSessionById(templateRef.id)
    const signature = (blocks: NonNullable<typeof selectedStructure>['blocks']) => JSON.stringify(blocks.map(b => [b.label, b.durationMin, b.distanceKm, b.repetitions, b.role]))
    const matches = definition?.version === templateRef.version && definition.runningType === runningType
      && (['hold', 'progress', 'deload'] as const).some(intent => {
        const dose = materializeRunningTemplate({ template: definition, durationMin: session.durationMin, profile: runningProfile, intent })
        return dose.ok && signature(dose.structure.blocks) === signature(selectedStructure!.blocks)
      })
    if (!matches) { templateRef = undefined; selectionReason = undefined }
  }
  const targets = runningTargets(runningType, profile?.runningProfile)
  const generated = materializeRunningSession({ runningType, durationMin: session.durationMin,
    profile: profile?.runningProfile, targets: {
      ...targets,
      ...(session.targetPaceMin ? { targetPaceMin: session.targetPaceMin } : {}),
      ...(session.targetPaceMax ? { targetPaceMax: session.targetPaceMax } : {}),
      ...(session.targetHrMin != null ? { targetHrMin: session.targetHrMin } : {}),
      ...(session.targetHrMax != null ? { targetHrMax: session.targetHrMax } : {}),
    } })
  if (!generated.ok) return generated
  let structure = selectedStructure
  if (structure?.blocks.length) {
    if (runningType === 'intervals'
      && structure.blocks.some(b => (b.repetitions ?? 1) > 1 && /recuper|descans/i.test(b.notes ?? ''))
      && !structure.blocks.some(b => /recuper|descans/i.test(b.label) || (b.recoverySeconds ?? 0) > 0)) {
      return { ok: false, message: `Las recuperaciones de "${session.title}" están sólo en las notas: decláralas como bloques con duración antes de aplicar.` }
    }
    const total = sumTimedBlocks(structure.blocks)
    if (total == null) return { ok: false, message: `No se puede comprobar el tiempo de "${session.title}": declara duración de trabajo y recuperaciones en los bloques por distancia.` }
    // Unknown/over-budget supplied work must not be silently replaced by a
    // different workout merely to make arithmetic pass.
    if (Math.abs(total - Math.floor(session.durationMin * 60)) > 60 || total > session.durationMin * 60) {
      return { ok: false, message: `Los bloques de "${session.title}" suman ${total / 60} min y la sesión declara ${session.durationMin} min. Ajusta la dosis antes de aplicar.` }
    }
    const easyBlock = (b: typeof structure.blocks[number]) => ['warmup', 'cooldown', 'recovery'].includes(b.role ?? '') || /calentamiento|enfriamiento|recuperaci|vuelta a la calma/i.test(b.label)
    const workPaces = structure.blocks.filter(b => !easyBlock(b)).map(b => b.targetPace)
    structure = { blocks: structure.blocks.map(block => {
      if (!easyBlock(block)) return block
      if ((runningType === 'tempo' || runningType === 'intervals') && block.targetPace && workPaces.includes(block.targetPace)) {
        return { ...block, targetPace: generated.structure.blocks[0].targetPace, targetHrMax: undefined,
          notes: 'Caminar o trotar suave, con esfuerzo conversacional. Incluido en el tiempo total.' }
      }
      return block
    }) }
  } else structure = generated.structure
  const definition = templateRef && findRunningSessionById(templateRef.id)
  const pace = definition && definition.prescription.terrain !== 'hill' ? runningEffortPace(definition.prescription.effort, profile?.runningProfile) : undefined
  const paceText = pace ? `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, '0')}` : undefined
  const finalTargets = !definition ? generated.targets : definition.prescription.effort === 'easy' ? runningTargets('z2', profile?.runningProfile) : { targetPaceMin: paceText, targetPaceMax: paceText }
  return { ok: true, session: { ...session, runningType, ...finalTargets, intervalStructure: structure, runningTemplateRef: templateRef, runningSelectionReason: selectionReason } }
}
