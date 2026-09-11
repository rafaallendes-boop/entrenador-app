import { writeFileSync } from 'node:fs'
import { createServer } from 'vite'

// Auditoría local reproducible: no genera planes ni llama a IA o bases de datos.
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' })
try {
  const { selectStrengthSession, filterByFatigue } = await server.ssrLoadModule('/src/services/training/strengthSelector.ts')
  const { STRENGTH_EXERCISE_LIBRARY: library, getExerciseById } = await server.ssrLoadModule('/src/services/training/exerciseLibrary.ts')
  const { resolveDeclaredEquipment, hasExerciseEquipment } = await server.ssrLoadModule('/src/services/training/equipmentVocabulary.ts')
  const inventory = {
    gym: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'],
    home: ['dumbbell', 'bands', 'bodyweight'],
    machines: ['machine', 'cable'],
    bodyweight: ['bodyweight'],
    // Inventario ausente: significa «todo el equipamiento» y es el caso que la
    // ampliación de mini vallas y cinta cambió. Sin él la auditoría no lo veía.
    undeclared: undefined,
  }
  const violations = []
  const observations = { phaseMismatch: 0, noLowerStrength: 0, noUpperPull: 0, multipleConditioning: 0, overTwoCore: 0 }
  const examples = {}
  let sessions = 0
  for (const phase of ['base', 'build', 'peak', 'taper', 'race', 'transition']) {
    for (const experienceLevel of ['beginner', 'intermediate', 'advanced']) {
      for (const [equipmentName, availableEquipment] of Object.entries(inventory)) {
        for (const fatigueLevel of [3, 8]) {
          for (const weekIndexInBlock of [undefined, 0, 1, 2]) {
            const context = { phase, experienceLevel, availableEquipment, fatigueLevel, weekIndexInBlock,
              primarySport: 'squash', sportProfile: 'sport_support', goal: 'fuerza para squash',
              sessionDurationMin: 60, recentExercises: [], safetyConstraints: [] }
            const selection = selectStrengthSession(context)
            const definitions = selection.exercises.map((exercise) => getExerciseById(exercise.libraryRef.id))
            const label = `${phase}/${experienceLevel}/${equipmentName}/fatigue-${fatigueLevel}/${weekIndexInBlock ?? 'scored'}`
            const allowed = new Set(filterByFatigue(library, context).map((exercise) => exercise.id))
            const equipment = resolveDeclaredEquipment(availableEquipment).equipment
            const check = (condition, rule) => { if (!condition) violations.push({ label, rule }) }
            check(new Set(definitions.map((exercise) => exercise.id)).size === definitions.length, 'unique_ids')
            check(definitions.filter((exercise) => exercise.isolation).length <= 2, 'isolation_budget')
            // `hasExerciseEquipment`, no `.equipment.some(...)`: el predicado de
            // producción también exige `requiredEquipment`, que es justo el
            // contrato que introdujo esta ampliación.
            check(definitions.every((exercise) => hasExerciseEquipment(exercise, equipment)), 'equipment')
            check(definitions.every((exercise) => allowed.has(exercise.id)), 'fatigue')
            if (experienceLevel === 'beginner') check(definitions.every((exercise) => exercise.difficulty === 'beginner'), 'beginner')
            check(selection.exercises.every((exercise, index) => definitions[index].prescriptionUnit !== 'seconds'
              || typeof exercise.reps === 'string' && exercise.reps.endsWith('s')), 'timed_dose')
            if (selection.starLift) {
              const star = selection.exercises.find((exercise) => exercise.name === selection.starLift.name)
              check(star && star.targetRpe === selection.starLift.targetRpe && star.targetPercent1RM === selection.starLift.targetPercent1RM, 'star_dose')
            }
            const observe = (condition, key) => {
              if (!condition) return
              observations[key] += 1
              examples[key] ??= { label, exercises: definitions.map((exercise) => exercise.id) }
            }
            observe(definitions.some((exercise) => !exercise.appropriateForPhases.includes(phase)), 'phaseMismatch')
            if (['base', 'build', 'peak'].includes(phase) && fatigueLevel === 3) {
              observe(!definitions.some((exercise) => exercise.category === 'lower' && !exercise.isolation), 'noLowerStrength')
              observe(!definitions.some((exercise) => exercise.category === 'upper' && exercise.movement === 'pull' && !exercise.isolation), 'noUpperPull')
            }
            observe(selection.exercises.filter((exercise) => exercise.group === 'cardio').length > 1, 'multipleConditioning')
            observe(selection.exercises.filter((exercise) => exercise.group === 'core').length > 2, 'overTwoCore')
            sessions += 1
          }
        }
      }
    }
  }
  const counts = (key) => Object.fromEntries([...new Set(library.map((exercise) => exercise[key]))]
    .map((value) => [value, library.filter((exercise) => exercise[key] === value).length]))
  const report = { catalog: { total: library.length, category: counts('category'), intensity: counts('intensityType'),
    missingRiskAndFatigue: library.filter((exercise) => !exercise.riskLevel || !exercise.fatigueCost).map((exercise) => exercise.id) },
    sessions, violations, observations, examples }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (process.argv[2]) writeFileSync(process.argv[2], json)
  console.log(json)
  if (violations.length) process.exitCode = 1
} finally {
  await server.close()
}
