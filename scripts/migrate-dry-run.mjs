#!/usr/bin/env node
/**
 * Athlete Scope Foundation — migration dry-run (pre-check).
 *
 * Reports how many rows per table still need an `athleteId` BEFORE the automatic
 * Dexie v13 upgrade runs, so the migration can be validated against real data.
 *
 * Usage:
 *   node scripts/migrate-dry-run.mjs <path-to-backup.json>
 *
 * The backup is the app's export/backup file (Settings → export), which has the
 * shape { tables: { sessions: [...], dayLogs: [...], ... } }.
 *
 * The canonical, unit-tested logic lives in
 * src/services/athlete/athleteScopeMigration.ts (planAthleteScopeMigration). This
 * script mirrors the tiny "pending" predicate so it can run in plain Node without
 * a TS runtime. Keep the predicate in sync with ATHLETE_PROFILE_LOCAL_ID = 'default'.
 */
import { readFileSync } from 'node:fs'

const LEGACY_LOCAL_ID = 'default'
const isPending = (athleteId) => athleteId == null || athleteId === LEGACY_LOCAL_ID

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/migrate-dry-run.mjs <path-to-backup.json>')
  process.exit(1)
}

const backup = JSON.parse(readFileSync(path, 'utf8'))
const tables = backup.tables ?? backup
let totalToMap = 0
const perTable = {}

for (const [name, rows] of Object.entries(tables)) {
  if (!Array.isArray(rows)) continue
  const toMap = rows.filter((r) => r && typeof r === 'object' && isPending(r.athleteId)).length
  perTable[name] = { total: rows.length, toMap, alreadyMapped: rows.length - toMap }
  totalToMap += toMap
}

console.log(JSON.stringify({ totalToMap, perTable }, null, 2))
if (totalToMap === 0) {
  console.log('\n✓ Nothing pending — all rows already carry an athleteId.')
} else {
  console.log(`\n→ ${totalToMap} row(s) will be stamped with athleteId on upgrade.`)
}
