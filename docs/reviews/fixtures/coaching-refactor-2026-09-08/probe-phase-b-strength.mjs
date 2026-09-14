// docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-strength.mjs
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Caracterización para revisión del owner; no afirma que un resultado sea correcto.
// node probe-phase-b-strength.mjs --mode before <copia_en_la_base>
// node probe-phase-b-strength.mjs --mode after
const args = process.argv.slice(2)
const mode = args[args.indexOf('--mode') + 1]
if (mode !== 'before' && mode !== 'after') throw new Error('Uso: --mode before|after [raiz]')
const rootArg = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--mode')
const root = resolve(rootArg ?? fileURLToPath(new URL('../../../../', import.meta.url)))
globalThis.fetch = () => { throw new Error('La revisión no permite llamadas de red.') }
// Dexie se instancia al importar el engine; en Node no hay IndexedDB.
await import('fake-indexeddb/auto')

const EQUIPMENT = ['barbell', 'dumbbell', 'bench', 'kettlebell']
const ATHLETE_KEYS = ['fatigueLevel', 'experienceLevel', 'requireExtraRecovery', 'returningFromBreak', 'rpeAdjustment', 'available1RM', 'availableEquipment']
const ARCHETYPES = [
  { id: 'sin-datos-normal', now: [2026, 8, 13, 10], slot: { date: '2026-09-14', timeBlock: 'AM' }, age: 28, level: 'recreational',
    wizard: { currentFatigue: 'normal', currentFitnessLevel: 'normal', updatedAt: '2026-09-12T12:00:00.000Z' }, strengthProfile: {}, logs: [] },
  { id: 'fresco-declarado', now: [2026, 8, 13, 10], slot: { date: '2026-09-14', timeBlock: 'AM' }, age: 28, level: 'recreational',
    wizard: { currentFatigue: 'fresh', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, strengthProfile: { squat1RM: 90 }, logs: [] },
  { id: 'masters-squash', now: [2026, 8, 13, 10], slot: { date: '2026-09-14', timeBlock: 'AM' }, age: 41, level: 'masters',
    wizard: { currentFatigue: 'normal', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, strengthProfile: { squat1RM: 110, deadlift1RM: 140 }, logs: [] },
  { id: 'sobrecargado-con-dolor-miercoles', now: [2026, 8, 16, 10], slot: { date: '2026-09-16', timeBlock: 'PM' }, age: 33, level: 'competitive',
    wizard: { currentFatigue: 'overloaded', currentFitnessLevel: 'fit', updatedAt: '2026-09-15T12:00:00.000Z' },
    strengthProfile: { squat1RM: 120, deadlift1RM: 150, benchPress1RM: 90, overheadPress1RM: 60 }, logs: [{ id: 'l', date: '2026-09-15', painLevel: 7, updatedAt: 0 }] },
  { id: 'retorno-45-loaded-vencido', now: [2026, 8, 16, 10], slot: { date: '2026-09-16', timeBlock: 'AM' }, age: 45, level: 'competitive',
    wizard: { currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-07T12:00:00.000Z' }, strengthProfile: {}, logs: [] },
]

const server = await createServer({ root, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } })
try {
  const selector = await server.ssrLoadModule('/src/services/training/strengthSelector.ts')
  const equipment = await server.ssrLoadModule('/src/services/training/equipmentVocabulary.ts')
  const output = []
  for (const archetype of ARCHETYPES) {
    const { contexts, resolution } = mode === 'before'
      ? { contexts: legacyContexts(archetype, equipment), resolution: null }
      : await currentContexts(archetype)
    for (const [route, context] of Object.entries(contexts)) {
      const selection = selector.selectStrengthSession(context)
      output.push({
        archetype: archetype.id,
        slot: archetype.slot,
        route,
        // I1/I3: sólo en "after" — distingue no_signal (sin datos) de progress (evidencia) y la procedencia de la experiencia.
        resolution,
        athlete: Object.fromEntries(ATHLETE_KEYS.map((key) => [key, context[key] ?? null])),
        exercises: selection.exercises.map((exercise) => exercise.libraryRef?.id ?? exercise.name),
      })
    }
  }
  console.log(JSON.stringify({ mode, output }, null, 2))
} finally {
  await server.close()
}

function base() {
  return { phase: 'base', goal: 'fuerza', sportProfile: 'sport_support', primarySport: 'squash', sessionDurationMin: 60, safetyConstraints: [], recentExercises: [] }
}

/** Reconstrucción literal de los tres constructores anteriores a la Fase B (spec §2, F11). */
function legacyContexts(a, equipment) {
  const eq = equipment.resolveSelectorEquipment(EQUIPMENT)
  const lifts = [['squat1RM', 'squat'], ['deadlift1RM', 'deadlift'], ['benchPress1RM', 'benchPress'], ['overheadPress1RM', 'overheadPress']]
    .filter(([key]) => a.strengthProfile[key] != null).map(([, lift]) => lift)
  const fitness = a.wizard.currentFitnessLevel
  const fatigue = a.wizard.currentFatigue
  const pbExperience = fitness === 'low' || fitness === 'returning' ? 'beginner'
    : a.level === 'elite' || a.level === 'masters' ? 'advanced' : 'intermediate'
  return {
    chat: { ...base(), fatigueLevel: 5, experienceLevel: 'intermediate', availableEquipment: eq },
    week_creator: { ...base(), fatigueLevel: { fresh: 2, normal: 4, loaded: 6, overloaded: 8 }[fatigue], requireExtraRecovery: fatigue === 'overloaded' },
    plan_builder: { ...base(), weekIndexInBlock: 0, fatigueLevel: { fresh: 2, normal: 5, loaded: 7, overloaded: 9 }[fatigue], experienceLevel: pbExperience,
      availableEquipment: eq, available1RM: lifts, rpeAdjustment: fatigue === 'overloaded' ? -1 : 0, requireExtraRecovery: a.age >= 35 },
  }
}

async function currentContexts(a) {
  const post = await server.ssrLoadModule('/src/services/ai/actionPostProcessor.ts')
  const chatCapture = await server.ssrLoadModule('/src/services/ai/chatSourceCapture.ts')
  const wc = await server.ssrLoadModule('/src/services/weekCreator/WeekCreatorEngine.ts')
  const wcConfig = await server.ssrLoadModule('/src/services/weekCreator/WeekCreatorConfig.ts')
  const wcSources = await server.ssrLoadModule('/src/services/weekCreator/weekCreatorExecutionSignals.ts')
  const hydrator = await server.ssrLoadModule('/src/services/weekCreator/WeekCreatorLocalHydrator.ts')
  const repair = await server.ssrLoadModule('/src/services/planBuilder/repairWeek.ts')

  const now = new Date(...a.now).getTime()
  const profile = { id: 'athlete-1', updatedAt: 0, age: a.age, sportContext: { primarySport: 'squash' }, strengthProfile: a.strengthProfile,
    availableEquipment: EQUIPMENT, planWizardConfig: a.wizard }
  const chat = { recentSessions: [], plannedSessions: [], historicalSessions: [], weekDayLogs: a.logs, athleteProfile: profile }
  const sources = wcSources.resolveWeekCreatorStrengthSources(chat, a.slot.date, now)
  const config = wcConfig.applyDeclarationValidityToConfig({ trainingDays: ['monday', 'wednesday'], sessionsPerWeek: 3, maxSessionsPerWeek: 5, sessionDurationMins: 60,
    allowDoubleSession: false, allowedSports: ['squash', 'strength'], primarySport: 'squash', currentFitnessLevel: a.wizard.currentFitnessLevel,
    currentFatigue: a.wizard.currentFatigue, fromWizard: true, configSource: 'wizard' }, profile, a.slot.date)
  const session = { date: a.slot.date, timeBlock: a.slot.timeBlock, sessionType: 'strength', title: 'Fuerza', durationMin: 60 }
  const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile, strengthSources: sources }
  const athlete = chatCapture.resolveCapturedStrengthAthleteContext(sources.capture, a.slot)

  return {
    resolution: {
      loadVerdict: athlete.loadDecision.verdict,
      loadReason: athlete.loadDecision.reason,
      declaredFatigue: athlete.declaredFatigue ?? null,
      experienceSource: athlete.experienceSource,
      extraRecoveryReasons: athlete.extraRecoveryReasons,
    },
    contexts: {
      chat: post.buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], a.slot),
      week_creator: wc.buildWeekCreatorStrengthSelectionContext(session, config, safety),
      plan_builder_repair: repair.buildPlanBuilderStrengthSelectionContext(session,
        hydrator.buildWeekCreatorHydrationRepairContext({ context: chat, config, targetWeekStart: '2026-09-14', planningStartDate: a.slot.date, strengthSources: sources }), []),
    },
  }
}
