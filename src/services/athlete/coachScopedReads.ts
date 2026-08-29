/**
 * Lecturas multi-atleta por athleteId explicito para el Coach Workspace.
 *
 * Esta es una excepcion deliberada a activeScopeFilter: el modulo nunca lee ni
 * modifica el atleta activo. Las filas legacy sin athleteId pertenecen solo al
 * atleta self del owner.
 */
import { addDays, format, parseISO } from 'date-fns'
import { db } from '../../db/db'
import type { Athlete, AthleteProfile, DayLog, Session, WeekSummary } from '../../types'
import { ATHLETE_PROFILE_LOCAL_ID } from './activeAthlete'
import { isAthleteScopeBackfillComplete } from './athleteScopeMigration'
import { resolveSelfAthleteIdForOwner } from './athleteWeekScope'
import { isScopedAthleteId } from './effectiveAthleteKey'

export async function assertRosterAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<Athlete> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete || athlete.ownerAccountId !== ownerAccountId) {
    throw new Error('El atleta no pertenece a tu roster.')
  }
  return athlete
}

export async function assertActiveRosterAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<Athlete> {
  const athlete = await assertRosterAthlete(ownerAccountId, athleteId)
  if (athlete.status !== 'active') {
    throw new Error('Este atleta está archivado; restauralo para editar su semana.')
  }
  return athlete
}

export async function getAthleteProfileForAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<AthleteProfile | undefined> {
  const selfId = await resolveSelfAthleteIdForOwner(ownerAccountId)
  if (athleteId === selfId) {
    const defaultRow = await db.athleteProfiles.get(ATHLETE_PROFILE_LOCAL_ID)
    if (defaultRow) return defaultRow
    return db.athleteProfiles.where('athleteId').equals(athleteId).first()
  }
  return (await db.athleteProfiles.where('athleteId').equals(athleteId).first())
    ?? db.athleteProfiles.get(athleteId)
}

export function weekEndISO(weekStartDate: string): string {
  return format(addDays(parseISO(weekStartDate), 6), 'yyyy-MM-dd')
}

function isRowInAthleteScope(
  row: { athleteId?: string },
  athleteId: string,
  isSelf: boolean,
): boolean {
  return row.athleteId === athleteId || (!isScopedAthleteId(row.athleteId) && isSelf)
}

/**
 * El self puede conservar una fila scoped y otra legacy para la misma clave
 * natural. La fila scoped es la autoridad; la legacy sólo cubre claves para
 * las que todavía no existe una fila scoped.
 */
function dedupeByNaturalKey<T extends { id: string; athleteId?: string; updatedAt?: number }>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const key = keyOf(row)
    const current = byKey.get(key)
    const currentIsScoped = current ? isScopedAthleteId(current.athleteId) : false
    const rowIsScoped = isScopedAthleteId(row.athleteId)
    const shouldReplace = !current
      || (!currentIsScoped && rowIsScoped)
      || (currentIsScoped === rowIsScoped && (
        (row.updatedAt ?? Number.NEGATIVE_INFINITY)
          > (current.updatedAt ?? Number.NEGATIVE_INFINITY)
        || (
          row.updatedAt === current.updatedAt
          && row.id.localeCompare(current.id) > 0
        )
      ))
    if (shouldReplace) {
      byKey.set(key, row)
    }
  }
  return [...byKey.values()]
}

export interface RosterTriageReadWindows {
  dayLogsFromISO: string
  dayLogsToISO: string
  sessionsFromISO: string
  sessionsToISO: string
  summariesFromISO: string
  summariesToISO: string
}

export interface RosterTriageAthleteRows {
  dayLogsInPainWindow: DayLog[]
  latestDayLog?: DayLog
  sessionsInWindow: Session[]
  summariesInWindow: WeekSummary[]
}

export interface RosterTriageReadResult {
  rowsByAthlete: Map<string, RosterTriageAthleteRows>
  skippedAthleteIds: Set<string>
}

/**
 * El techo de fecha no es cosm\u00e9tico: un check-in guardado desde `DayDetail` en
 * un d\u00eda futuro de la semana en curso dejar\u00eda `daysSinceCheckIn` negativo y
 * suprimir\u00eda la se\u00f1al `no-check-in` hasta que esa fecha llegue. Misma cota que
 * usa `getLatestLegacyDayLog`.
 */
async function getLatestScopedDayLogs(
  athleteIds: Set<string>,
  toISO: string,
): Promise<Map<string, DayLog>> {
  const entries = await Promise.all(
    [...athleteIds].map(async (athleteId) => {
      const row = await db.dayLogs
        .where('[athleteId+date]')
        .between([athleteId, ''], [athleteId, toISO], true, true)
        .reverse()
        .first()
      return [athleteId, row] as const
    }),
  )
  return new Map(
    entries.filter((entry): entry is readonly [string, DayLog] => entry[1] !== undefined),
  )
}

async function getLatestLegacyDayLog(toISO: string): Promise<DayLog | undefined> {
  const firstAtLatestDate = await db.dayLogs
    .where('date')
    .belowOrEqual(toISO)
    .reverse()
    .filter((row) => !isScopedAthleteId(row.athleteId))
    .first()
  if (!firstAtLatestDate) return undefined

  return dedupeByNaturalKey(
    await db.dayLogs
      .where('date')
      .equals(firstAtLatestDate.date)
      .filter((row) => !isScopedAthleteId(row.athleteId))
      .toArray(),
    (row) => row.date,
  )[0]
}

/**
 * Lee el roster completo en tres escaneos de rango y agrupa una sola vez en
 * memoria. Las filas legacy se asignan exclusivamente al self resuelto por la
 * misma autoridad que usa el resto de las lecturas scoped.
 */
export async function getRosterTriageData(
  ownerAccountId: string,
  athleteIds: string[],
  selfAthleteId: string,
  windows: RosterTriageReadWindows,
): Promise<RosterTriageReadResult> {
  const uniqueAthleteIds = [...new Set(athleteIds)]
  const currentAthletes = await db.athletes.bulkGet(uniqueAthleteIds)
  const activeIds = new Set(
    currentAthletes
      .filter((athlete): athlete is Athlete => Boolean(
        athlete
        && athlete.ownerAccountId === ownerAccountId
        && athlete.status === 'active',
      ))
      .map((athlete) => athlete.id),
  )
  const skippedAthleteIds = new Set(
    uniqueAthleteIds.filter((athleteId) => !activeIds.has(athleteId)),
  )
  const shouldReadLegacyHistory = activeIds.has(selfAthleteId)
    && !isAthleteScopeBackfillComplete(ownerAccountId, selfAthleteId)
  const [dayLogs, sessions, summaries, latestScoped, latestLegacy] = await Promise.all([
    db.dayLogs
      .where('date')
      .between(windows.dayLogsFromISO, windows.dayLogsToISO, true, true)
      .toArray(),
    db.sessions
      .where('date')
      .between(windows.sessionsFromISO, windows.sessionsToISO, true, true)
      .toArray(),
    db.weekSummaries
      .where('weekStartDate')
      .between(windows.summariesFromISO, windows.summariesToISO, true, true)
      .toArray(),
    getLatestScopedDayLogs(activeIds, windows.dayLogsToISO),
    shouldReadLegacyHistory
      ? getLatestLegacyDayLog(windows.dayLogsToISO)
      : Promise.resolve(undefined),
  ])

  const rowsByAthlete = new Map<string, RosterTriageAthleteRows>()
  for (const athleteId of activeIds) {
    rowsByAthlete.set(athleteId, {
      dayLogsInPainWindow: [],
      latestDayLog: latestScoped.get(athleteId),
      sessionsInWindow: [],
      summariesInWindow: [],
    })
  }

  function targetAthleteId(row: { athleteId?: string }): string | null {
    if (isScopedAthleteId(row.athleteId)) {
      return activeIds.has(row.athleteId) ? row.athleteId : null
    }
    return activeIds.has(selfAthleteId) ? selfAthleteId : null
  }

  for (const row of dayLogs) {
    const athleteId = targetAthleteId(row)
    if (athleteId) rowsByAthlete.get(athleteId)?.dayLogsInPainWindow.push(row)
  }
  for (const row of sessions) {
    const athleteId = targetAthleteId(row)
    if (athleteId) rowsByAthlete.get(athleteId)?.sessionsInWindow.push(row)
  }
  for (const row of summaries) {
    const athleteId = targetAthleteId(row)
    if (athleteId) rowsByAthlete.get(athleteId)?.summariesInWindow.push(row)
  }

  for (const rows of rowsByAthlete.values()) {
    rows.dayLogsInPainWindow = dedupeByNaturalKey(
      rows.dayLogsInPainWindow,
      (row) => row.date,
    ).sort((a, b) => a.date.localeCompare(b.date))
    rows.sessionsInWindow.sort(
      (a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock),
    )
    rows.summariesInWindow = dedupeByNaturalKey(
      rows.summariesInWindow,
      (row) => row.weekStartDate,
    ).sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate))
  }

  const selfRows = rowsByAthlete.get(selfAthleteId)
  if (selfRows) {
    const latestCandidates = [
      selfRows.latestDayLog,
      selfRows.dayLogsInPainWindow.at(-1),
      latestLegacy,
    ].filter((row): row is DayLog => row !== undefined)
    selfRows.latestDayLog = dedupeByNaturalKey(
      latestCandidates,
      (row) => row.date,
    ).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  }

  return { rowsByAthlete, skippedAthleteIds }
}

/** Lectura pura Dexie de las sesiones semanales de un atleta del roster. */
export async function getWeekSessionsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<Session[]> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
  const rows = await db.sessions
    .where('date')
    .between(weekStartDate, weekEndISO(weekStartDate), true, true)
    .toArray()

  return rows
    .filter((row) => isRowInAthleteScope(row, athleteId, isSelf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}
