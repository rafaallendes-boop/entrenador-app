import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const allowed = new Set([
  'src/types/strengthSafety.ts',
  'src/services/training/exerciseLibrary.ts',
  'src/services/training/strengthSafetyConstraints.ts',
])

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : walk(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

describe('autoridad de clasificación de seguridad', () => {
  it('solo la biblioteca y la política leen perfiles de carga', () => {
    const offenders = walk('src').filter((path) => !allowed.has(path) && /loadsRegions|loadPatterns/.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })
})
