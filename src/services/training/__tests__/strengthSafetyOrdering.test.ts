import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const INTERNAL_CALLERS = new Set([
  'src/services/training/strengthSessionStructure.ts',
  'src/services/training/strengthSafetyFinalizer.ts',
  // Plan Builder compone su template/allocator/densidad antes de una única
  // fase terminal. El segundo test de orden congela que no mute después.
  'src/services/planBuilder/repairWeek.ts',
])

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : walk(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

describe('orden de finalización de seguridad', () => {
  it('ningún productor muta ejercicios después del finalizador', () => {
    const offenders = walk('src').filter((path) =>
      !INTERNAL_CALLERS.has(path) && readFileSync(path, 'utf8').includes('enhanceStrengthSessionExercises('),
    )
    expect(offenders, `deben usar prepareStrengthSession: ${offenders.join(', ')}`).toEqual([])

    const repairSource = readFileSync('src/services/planBuilder/repairWeek.ts', 'utf8')
    const materializationCall = repairSource.indexOf(
      'const strengthMaterialization = normalizeStrengthSessions(',
    )
    const finalizerCall = repairSource.indexOf('sessions = finalizeStrengthSafetySessions(')
    const orchestrationReturn = repairSource.indexOf('return { sessions, meta }', finalizerCall)

    expect(materializationCall).toBeGreaterThan(-1)
    expect(finalizerCall).toBeGreaterThan(materializationCall)
    expect(orchestrationReturn).toBeGreaterThan(finalizerCall)

    const terminalTail = repairSource.slice(finalizerCall, orchestrationReturn)
    expect(terminalTail).not.toContain('enhanceStrengthSessionExercises(')
    expect(terminalTail).not.toContain('normalizeStrengthSessions(')
    expect(terminalTail).not.toContain('balanceSessionCount(')
    expect(terminalTail).not.toContain('ensurePrimarySportMinimum(')
  })

  it('los productores y bordes invocan el wrapper de nivel sesión', () => {
    const required = [
      'src/services/ai/actionPostProcessor.ts',
      'src/services/weekCreator/WeekCreatorEngine.ts',
      'src/services/planBuilder/repairWeek.ts',
      'src/store/useCoachActionsStore.ts',
      'src/services/planning/applyCreateWeek.ts',
    ]
    for (const path of required) expect(readFileSync(path, 'utf8'), path).toContain('prepareStrengthSession')
  })
})
