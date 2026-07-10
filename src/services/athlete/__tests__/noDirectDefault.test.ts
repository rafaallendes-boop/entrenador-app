import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('no direct default athlete-profile id', () => {
  it('only activeAthlete.ts may contain the literal default profile id in services/store', () => {
    // activeAthlete.ts owns the athlete-profile-id literal. notificationService.ts
    // uses 'default' for the unrelated Web Notification permission / iOS sound name.
    const out = execSync(
      'grep -rn "\'default\'" src/services src/store --include=*.ts | grep -v "__tests__" | grep -v "athlete/activeAthlete.ts" | grep -v "services/notificationService.ts" || true',
      { encoding: 'utf8' },
    ).trim()

    const offending = out ? out.split('\n') : []
    expect(offending, `Unexpected profile id literals:\n${offending.join('\n')}`).toEqual([])
  })
})
