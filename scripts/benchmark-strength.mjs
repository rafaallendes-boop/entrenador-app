import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'

// Local deterministic benchmark: no provider, database or network calls.
const log = console.log
const info = console.info
let telemetryEvents = 0
console.log = console.info = () => { telemetryEvents += 1 }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { selectStrengthSession } = await server.ssrLoadModule('/src/services/training/strengthSelector.ts')
  const { STRENGTH_EXERCISE_LIBRARY } = await server.ssrLoadModule('/src/services/training/exerciseLibrary.ts')
  const { repairGeneratedWeek } = await server.ssrLoadModule('/src/services/planBuilder/repairWeek.ts')
  const equipmentSets = [undefined, ['barbell', 'dumbbell', 'cable'], ['dumbbell', 'bands', 'bodyweight'], ['machine', 'cable']]
  const contexts = equipmentSets.flatMap(availableEquipment => ['base', 'build', 'peak', 'taper'].flatMap(phase =>
    ['strength_primary', 'hybrid', 'sport_support'].flatMap(sportProfile => [false, true].flatMap(block => [4, 7].map(fatigueLevel => ({
      phase, sportProfile, fatigueLevel, availableEquipment, primarySport: 'squash', goal: 'fuerza de apoyo',
      recentExercises: [], safetyConstraints: [], sessionDurationMin: 60, experienceLevel: 'intermediate',
      ...(block ? { weekIndexInBlock: 0, available1RM: ['squat', 'benchPress'] } : {}),
    }))))))
  const wizardConfig = { goalEventId: 'e1', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    doubleSessionDays: [], sessionsPerWeek: 5, sessionDurationMins: 60, allowDoubleSession: false,
    complementarySports: ['strength'], currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '' }
  const plan = { id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'generating',
    title: 'Benchmark', startDate: '2026-06-01', endDate: '2026-07-12', totalWeeks: 6,
    phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 5, blockFocus: 'peak', intentBySport: {} }],
    wizardConfig, macroSnapshot: { goalEventId: 'e1', goalEventDate: '2026-07-12', currentPhase: 'peak', weeksRemaining: 6, blockFocus: 'peak', headline: '', timeline: [], sportDetails: [], secondaryEvents: [], computedAt: 0 }, createdAt: 0, updatedAt: 0 }
  function selectors() { return contexts.map(context => selectStrengthSession(context)) }
  function repairs() {
    return equipmentSets.map(availableEquipment => Array.from({ length: 6 }, (_, weekIndex) => {
      const date = new Date(Date.UTC(2026, 5, 1 + 7 * weekIndex)).toISOString().slice(0, 10)
      const week = { id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: date, phase: 'peak', status: 'draft',
        sessions: [], weekObjectives: [], targetLoadBySport: { strength: 30 }, validationIssues: [],
        generationMeta: { attempts: 1, provider: 'mock', model: 'local' }, createdAt: 0, updatedAt: 0 }
      const result = repairGeneratedWeek([{ date, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
        exercises: ['Sentadilla trasera', 'Peso muerto rumano', 'Press vertical', 'Remo con barra', 'Dead bug — control de tronco', 'Lanzamiento rotacional con balón medicinal']
          .map(name => ({ name, sets: 3, reps: 8 })) }], { plan, week, wizardConfig,
        profile: { id: 'benchmark', updatedAt: 0, availableEquipment },
        planWeekDescriptors: Array.from({ length: 6 }, (_, i) => ({ weekIndex: i, phase: 'peak' })) })
      return result.sessions.map(session => {
        // Superset UUIDs are generated per invocation; retain grouping, normalize identity.
        const groups = new Map()
        return { type: session.sessionType, exercises: session.exercises?.map(exercise => {
          if (!exercise.supersetGroup) return exercise
          if (!groups.has(exercise.supersetGroup)) groups.set(exercise.supersetGroup, `group-${groups.size}`)
          return { ...exercise, supersetGroup: groups.get(exercise.supersetGroup) }
        }) }
      })
    }))
  }
  const rows = []
  for (const [name, run] of [['selectors_192', selectors], ['repair_6weeks_4inventories', repairs]]) {
    run()
    const times = []
    let output
    for (let i = 0; i < 3; i++) { const start = performance.now(); output = run(); times.push(performance.now() - start) }
    const sessions = name === 'selectors_192' ? output : output.flat(2)
    rows.push({ name, returnedSessions: sessions.length, exerciseCount: sessions.reduce((total, session) => total + (session.exercises?.length ?? 0), 0), milliseconds: times.map(n => Math.round(n)), medianMs: Math.round([...times].sort((a,b) => a-b)[1]),
      signature: createHash('sha256').update(JSON.stringify(output)).digest('hex') })
  }
  const profiler = new Session()
  profiler.connect()
  const post = (method) => new Promise((resolve, reject) => profiler.post(method, (error, result) => error ? reject(error) : resolve(result)))
  await post('Profiler.enable'); await post('Profiler.start'); repairs()
  const { profile } = await post('Profiler.stop'); profiler.disconnect()
  const hotspots = profile.nodes.filter(n => n.hitCount).sort((a,b) => b.hitCount-a.hitCount).slice(0, 12)
    .map(n => ({ function: n.callFrame.functionName, file: n.callFrame.url.split('/').slice(-2).join('/'), samples: n.hitCount }))
  const report = { exercises: STRENGTH_EXERCISE_LIBRARY.length, node: process.version, rows, hotspots, telemetryEvents }
  const json = JSON.stringify(report, null, 2) + '\n'
  const outputPath = process.argv[2]
  if (outputPath) writeFileSync(outputPath, json)
  if (process.env.STRENGTH_BENCH_OUTPUT) writeFileSync(process.env.STRENGTH_BENCH_OUTPUT, JSON.stringify(repairs(), null, 2))
  log(json)
} finally { console.log = log; console.info = info; await server.close() }
