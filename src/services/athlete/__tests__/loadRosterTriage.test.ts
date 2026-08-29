import { describe, expect, it, vi } from 'vitest'
import type { RosterTriageDeps } from '../loadRosterTriage'
import { createRosterTriageLoader } from '../loadRosterTriage'
import { getActiveAthleteId, setActiveAthleteId } from '../activeAthlete'

const OWNER = 'acc_1'
const TODAY = '2026-08-29'
const SELF_ID = 'ath_self'

function emptyRows() {
  return {
    dayLogsInPainWindow: [],
    latestDayLog: undefined,
    sessionsInWindow: [],
    summariesInWindow: [],
  }
}

function rosterRead(athleteIds: string[], skippedAthleteIds: string[] = []) {
  return {
    rowsByAthlete: new Map(
      athleteIds
        .filter((athleteId) => !skippedAthleteIds.includes(athleteId))
        .map((athleteId) => [athleteId, emptyRows()]),
    ),
    skippedAthleteIds: new Set(skippedAthleteIds),
  }
}

function makeDeps(overrides: Partial<RosterTriageDeps> = {}): RosterTriageDeps {
  return {
    listRoster: vi.fn(async () => [
      { id: 'ath_self', createdAt: new Date(2026, 0, 1).getTime(), status: 'active' },
      { id: 'ath_a', createdAt: new Date(2026, 0, 1).getTime(), status: 'active' },
    ]),
    resolveSelfAthleteId: vi.fn(async () => SELF_ID),
    getRosterTriageData: vi.fn(async (_owner, athleteIds) => rosterRead(athleteIds)),
    currentOwnerAccountId: () => OWNER,
    now: () => 1_000,
    ...overrides,
  }
}

describe('createRosterTriageLoader', () => {
  it('devuelve una entrada por atleta activo del roster', async () => {
    const result = await createRosterTriageLoader(makeDeps()).load(OWNER, TODAY)

    expect(result?.athletes.map((athlete) => athlete.athleteId)).toEqual(['ath_self', 'ath_a'])
    expect(result?.athleteCount).toBe(2)
  })

  it('excluye atletas archivados antes de leer sus datos', async () => {
    const deps = makeDeps({
      listRoster: vi.fn(async () => [
        { id: 'ath_self', createdAt: 0, status: 'active' },
        { id: 'ath_archived', createdAt: 0, status: 'archived' },
      ]),
    })

    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result?.athletes.map((athlete) => athlete.athleteId)).toEqual(['ath_self'])
    expect(deps.getRosterTriageData).toHaveBeenCalledWith(
      OWNER,
      ['ath_self'],
      SELF_ID,
      expect.any(Object),
    )
  })

  it('consulta cada ventana con sus límites exactos', async () => {
    const deps = makeDeps({
      listRoster: vi.fn(async () => [
        { id: 'ath_a', createdAt: 0, status: 'active' },
      ]),
    })

    await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(deps.getRosterTriageData).toHaveBeenCalledWith(
      OWNER,
      ['ath_a'],
      SELF_ID,
      {
        dayLogsFromISO: '2026-08-23',
        dayLogsToISO: '2026-08-29',
        sessionsFromISO: '2026-08-15',
        sessionsToISO: '2026-08-28',
        summariesFromISO: '2026-08-17',
        summariesToISO: '2026-08-17',
      },
    )
    expect(deps.getRosterTriageData).toHaveBeenCalledOnce()
  })

  it('incluye computedAt, durationMs y athleteCount sin persistirlos', async () => {
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_042)
    const result = await createRosterTriageLoader(makeDeps({ now })).load(OWNER, TODAY)

    expect(result).toMatchObject({
      computedAt: 1_042,
      selfAthleteId: SELF_ID,
      durationMs: 42,
      athleteCount: 2,
      failedAthleteCount: 0,
    })
    expect(result?.athleteCount).toBe(result?.athletes.length)
  })

  it('descarta el resultado si cambió la cuenta durante el cálculo', async () => {
    let currentOwner: string | null = OWNER
    const deps = makeDeps({
      currentOwnerAccountId: () => currentOwner,
      getRosterTriageData: vi.fn(async (_owner, athleteIds) => {
        currentOwner = 'acc_2'
        return rosterRead(athleteIds)
      }),
    })

    await expect(
      createRosterTriageLoader(deps).load(OWNER, TODAY),
    ).resolves.toBeNull()
  })

  it('sólo el cálculo más reciente publica su resultado', async () => {
    let releaseSlow: (() => void) | undefined
    let markSlowStarted: (() => void) | undefined
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve })
    let first = true
    const deps = makeDeps({
      listRoster: vi.fn(async () => [
        { id: 'ath_a', createdAt: 0, status: 'active' },
      ]),
      getRosterTriageData: vi.fn(async (_owner, athleteIds) => {
        if (first) {
          first = false
          markSlowStarted?.()
          await slow
        }
        return rosterRead(athleteIds)
      }),
    })
    const loader = createRosterTriageLoader(deps)

    const slowLoad = loader.load(OWNER, TODAY)
    await slowStarted
    const fastLoad = await loader.load(OWNER, TODAY)
    releaseSlow?.()

    expect(await slowLoad).toBeNull()
    expect(fastLoad).not.toBeNull()
  })

  it('no cambia el atleta activo', async () => {
    setActiveAthleteId('ath_preexisting')
    try {
      await createRosterTriageLoader(makeDeps()).load(OWNER, TODAY)
      expect(getActiveAthleteId()).toBe('ath_preexisting')
    } finally {
      setActiveAthleteId(null)
    }
  })

  it('omite sin error al atleta archivado entre ambos snapshots', async () => {
    const deps = makeDeps({
      getRosterTriageData: vi.fn(async () => rosterRead(
        ['ath_self', 'ath_a'],
        ['ath_a'],
      )),
    })

    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result?.athletes.map((athlete) => athlete.athleteId)).toEqual(['ath_self'])
    expect(result?.failedAthleteCount).toBe(0)
    expect(result?.athleteCount).toBe(1)
  })

  it('marca como parcial una inconsistencia real que no fue un archivado', async () => {
    const deps = makeDeps({
      getRosterTriageData: vi.fn(async () => ({
        rowsByAthlete: new Map([['ath_self', emptyRows()]]),
        skippedAthleteIds: new Set<string>(),
      })),
    })

    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result?.failedAthleteCount).toBe(1)
    expect(result?.athletes.map((athlete) => athlete.athleteId)).toEqual(['ath_self'])
  })

  it('usa el self vinculado del roster si la membresía resuelve fuera de la cuenta', async () => {
    const deps = makeDeps({
      listRoster: vi.fn(async () => [
        {
          id: 'ath_linked',
          linkedAccountId: OWNER,
          createdAt: 0,
          status: 'active',
        },
        { id: 'ath_a', linkedAccountId: null, createdAt: 0, status: 'active' },
      ]),
      resolveSelfAthleteId: vi.fn(async () => 'ath_external_membership'),
    })

    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result?.selfAthleteId).toBe('ath_linked')
    expect(deps.getRosterTriageData).toHaveBeenCalledWith(
      OWNER,
      ['ath_linked', 'ath_a'],
      'ath_linked',
      expect.any(Object),
    )
  })
})
