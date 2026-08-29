import { addDays } from 'date-fns'
import type { Athlete } from '../../types'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import {
  computeAthleteTriage,
  TRIAGE_THRESHOLDS,
  type AthleteTriage,
} from './coachRosterTriage'
import type {
  RosterTriageReadWindows,
  RosterTriageReadResult,
} from './coachScopedReads'

type RosterAthlete = Pick<Athlete, 'id' | 'createdAt' | 'status' | 'linkedAccountId'>

export interface RosterTriage {
  computedAt: number
  selfAthleteId: string
  athletes: AthleteTriage[]
  durationMs: number
  athleteCount: number
  failedAthleteCount: number
}

export interface RosterTriageDeps {
  listRoster: (ownerAccountId: string) => Promise<RosterAthlete[]>
  resolveSelfAthleteId: (ownerAccountId: string) => Promise<string>
  getRosterTriageData: (
    ownerAccountId: string,
    athleteIds: string[],
    selfAthleteId: string,
    windows: RosterTriageReadWindows,
  ) => Promise<RosterTriageReadResult>
  currentOwnerAccountId: () => string | null
  now: () => number
}

export function createRosterTriageLoader(deps: RosterTriageDeps): {
  load: (ownerAccountId: string, today: string) => Promise<RosterTriage | null>
} {
  let latestGeneration = 0

  return {
    async load(ownerAccountId: string, today: string): Promise<RosterTriage | null> {
      const generation = ++latestGeneration
      const startedAt = deps.now()
      const todayDate = fromISO(today)

      const painFrom = toISO(addDays(todayDate, -(TRIAGE_THRESHOLDS.painWindowDays - 1)))
      const sessionsFrom = toISO(addDays(todayDate, -TRIAGE_THRESHOLDS.overdueWindowDays))
      const sessionsTo = toISO(addDays(todayDate, -1))
      const previousWeekStart = toISO(addDays(getWeekStart(todayDate), -7))

      const roster = (await deps.listRoster(ownerAccountId))
        .filter((athlete) => athlete.status === 'active')
      const resolvedSelfAthleteId = await deps.resolveSelfAthleteId(ownerAccountId)
      // En cuentas con doble rol, una membresía externa no forma parte del
      // roster poseído. El fallback usa el vínculo explícito del mismo snapshot
      // y se pasa tanto a las lecturas como a la UI, evitando dos scopes.
      const selfAthleteId = roster.some((athlete) => athlete.id === resolvedSelfAthleteId)
        ? resolvedSelfAthleteId
        : roster.find((athlete) => athlete.linkedAccountId === ownerAccountId)?.id
          ?? resolvedSelfAthleteId
      const { rowsByAthlete, skippedAthleteIds } = await deps.getRosterTriageData(
        ownerAccountId,
        roster.map((athlete) => athlete.id),
        selfAthleteId,
        {
          dayLogsFromISO: painFrom,
          dayLogsToISO: today,
          sessionsFromISO: sessionsFrom,
          sessionsToISO: sessionsTo,
          summariesFromISO: previousWeekStart,
          summariesToISO: previousWeekStart,
        },
      )

      const athletes: AthleteTriage[] = []
      let failedAthleteCount = 0
      for (const athlete of roster) {
        if (skippedAthleteIds.has(athlete.id)) continue
        try {
          const rows = rowsByAthlete.get(athlete.id)
          if (!rows) throw new Error('Atleta no disponible durante el cálculo.')

          athletes.push(computeAthleteTriage({
            athlete,
            today,
            dayLogsInPainWindow: rows.dayLogsInPainWindow,
            latestDayLog: rows.latestDayLog,
            sessionsInWindow: rows.sessionsInWindow,
            previousWeekSummary: rows.summariesInWindow[0],
          }))
        } catch {
          // Una inconsistencia aislada no invalida las señales del resto. El
          // resultado marca que fue parcial para que la UI lo diga.
          failedAthleteCount += 1
        }
      }

      // Un cambio de cuenta o una generación posterior invalida este resultado,
      // pero no altera el estado que la pantalla ya estaba mostrando.
      if (deps.currentOwnerAccountId() !== ownerAccountId) return null
      if (generation !== latestGeneration) return null

      const computedAt = deps.now()
      return {
        computedAt,
        selfAthleteId,
        athletes,
        durationMs: computedAt - startedAt,
        athleteCount: athletes.length,
        failedAthleteCount,
      }
    },
  }
}
