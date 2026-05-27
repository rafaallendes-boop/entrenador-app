import { db } from '../db/db'
import { APP_INFO } from '../constants/appInfo'
import type {
  AthleteProfile,
  ChatMessage,
  CoachAction,
  CoachProposal,
  DayLog,
  GoalEvent,
  MacroPlan,
  MacroPlanEventMarker,
  MacroPlanPhase,
  MacroPlanSportDetail,
  MacroPlanTimelineEntry,
  MacroWeekCoherenceSummary,
  PhaseSportTargetRole,
  Session,
  SupportedSport,
  TrainingPriority,
  WarmupSet,
  WeekSummary,
} from '../types'
import type { TrainingPlan, TrainingPlanWeek } from '../types/planBuilder'
import { useChatStore } from '../store/useChatStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { usePlanBuilderStore } from '../store/usePlanBuilderStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { clearStoredChatSessionId, getOrCreateChatSessionId, setStoredChatSessionId } from '../utils/chatSession'
import { derivePlanGenerationState } from './planBuilder/generationState'

const BACKUP_APP_NAME = 'Entrenador' as const
const CURRENT_BACKUP_VERSION = 3 as const
const MIN_SUPPORTED_BACKUP_VERSION = 1 as const

const TIME_BLOCKS = new Set(['AM', 'PM'])
const SESSION_TYPES = new Set(['squash', 'running', 'cycling', 'strength', 'mobility', 'recovery', 'nutrition'])
const SESSION_SOURCES = new Set(['manual', 'coach'])
const SESSION_STATUSES = new Set(['planned', 'completed', 'adjusted', 'skipped'])
const SQUASH_SUBTYPES = new Set(['control', 'training', 'match', 'competitive', 'light'])
const MATCH_RESULTS = new Set(['win', 'loss'])
const MESSAGE_ROLES = new Set(['user', 'coach'])
const AI_PROVIDERS = new Set(['claude', 'openai', 'mock', 'gemini'])
const RUNNING_TYPES = new Set(['z2', 'tempo', 'intervals', 'long'])
const MOBILITY_SESSION_CONTEXTS = new Set([
  'post_run',
  'post_cycling',
  'post_squash',
  'post_strength',
  'pre_training_activation',
  'recovery',
  'full_body',
  'sport_specific',
])
const SQUASH_TRAINING_FOCUSES = new Set(['technical', 'tactical', 'physical', 'conditioned_games'])
const SQUASH_SESSION_MODES = new Set(['drill_session', 'practice_match', 'competition_match'])
const SQUASH_SESSION_KINDS = new Set(['technical', 'control', 'shadows', 'match', 'mixed'])
const SQUASH_BLOCK_KINDS = new Set(['technical', 'control', 'shadows', 'match'])
const PROPOSAL_STATUSES = new Set(['pending', 'accepted', 'rejected', 'partial'])
const SUPPORTED_SPORTS = new Set(['squash', 'running', 'strength', 'mobility', 'cycling'])
const TRAINING_PRIORITIES = new Set(['performance', 'fitness', 'body_composition', 'return_to_play'])
const GOAL_EVENT_PRIORITIES = new Set(['primary', 'secondary'])
const MACRO_PLAN_LOAD_BIASES = new Set(['build', 'hold', 'reduce', 'minimal'])
const MACRO_PLAN_EVENT_TIMINGS = new Set(['upcoming', 'active', 'past'])
const MACRO_PLAN_SPORT_ROLES = new Set(['primary', 'support'])
const MACRO_PLAN_PHASES = new Set(['base', 'build', 'peak', 'taper', 'race', 'transition'])
const PHASE_SPORT_TARGET_ROLES = new Set(['primary', 'support', 'excluded'])
const PLAN_STATUSES = new Set(['draft', 'active', 'archived', 'superseded'])
const PLAN_GENERATION_STATES = new Set(['shell', 'generating', 'partial', 'failed', 'complete'])
const PLAN_WEEK_STATUSES = new Set(['pending', 'generating', 'draft', 'accepted', 'error'])
const COACH_ACTION_TYPES = new Set([
  'move_session',
  'change_rpe',
  'shorten_session',
  'lengthen_session',
  'insert_recovery',
  'skip_session',
  'replace_session_type',
  'add_session',
  'create_week',
  'delete_session',
  'update_session',
])

export interface AppDataExport {
  app: typeof BACKUP_APP_NAME
  version: typeof CURRENT_BACKUP_VERSION
  exportedAt: string
  exportedFromAppVersion: string
  tables: {
    sessions: Session[]
    dayLogs: DayLog[]
    weekSummaries: WeekSummary[]
    trainingPlans: TrainingPlan[]
    trainingPlanWeeks: TrainingPlanWeek[]
    chatMessages: ChatMessage[]
    coachProposals: CoachProposal[]
    athleteProfiles: AthleteProfile[]
  }
}

export interface AthleteProfileTestExport {
  app: typeof BACKUP_APP_NAME
  type: 'athlete_profile_test_export'
  version: 1
  exportedAt: string
  exportedFromAppVersion: string
  athleteProfile: AthleteProfile | null
  goalEvents: GoalEvent[]
  planWizardConfig: AthleteProfile['planWizardConfig'] | null
  activeTrainingPlan: TrainingPlan | null
}

export interface AppDataImportResult {
  mode: 'replace' | 'merge'
  importedAt: string
  importedFromAppVersion: string
  counts: {
    sessions: number
    dayLogs: number
    weekSummaries: number
    trainingPlans: number
    trainingPlanWeeks: number
    chatMessages: number
    coachProposals: number
    athleteProfiles: number
  }
}

export interface MergeConflictSummary {
  /** Local records newer than backup — backup version will be skipped */
  localNewerCount: number
  /** Backup records newer than local — will overwrite local */
  backupNewerCount: number
  /** Records in backup that don't exist locally — will be added */
  newInBackupCount: number
}

export interface AppDataImportPreview {
  importedAt: string
  importedFromAppVersion: string
  version: number
  counts: AppDataImportResult['counts']
  sessionDateRange: { first: string; last: string } | null
  /** Populated at preview time — shows what merge would do vs. local data */
  mergeConflicts: MergeConflictSummary
}

type EnumCollection<T extends string> = ReadonlySet<T> | readonly T[]
type AthleteNutritionProfile = NonNullable<AthleteProfile['nutritionProfile']>

function buildFilename(exportedAt: Date): string {
  const iso = exportedAt.toISOString().replace(/[:.]/g, '-')
  return `entrenador-backup-${iso}.json`
}

function buildAthleteProfileFilename(exportedAt: Date): string {
  const iso = exportedAt.toISOString().replace(/[:.]/g, '-')
  return `entrenador-athlete-profile-${iso}.json`
}

export async function exportAppData(): Promise<{ filename: string; json: string }> {
  const exportedAt = new Date()
  const [sessions, dayLogs, weekSummaries, trainingPlans, trainingPlanWeeks, chatMessages, coachProposals, athleteProfiles] = await Promise.all([
    db.sessions.toArray(),
    db.dayLogs.toArray(),
    db.weekSummaries.toArray(),
    db.trainingPlans.toArray(),
    db.trainingPlanWeeks.toArray(),
    db.chatMessages.toArray(),
    db.coachProposals.toArray(),
    db.athleteProfiles.toArray(),
  ])

  const payload: AppDataExport = {
    app: BACKUP_APP_NAME,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    exportedFromAppVersion: APP_INFO.version,
    tables: {
      sessions,
      dayLogs,
      weekSummaries,
      trainingPlans,
      trainingPlanWeeks,
      chatMessages,
      coachProposals,
      athleteProfiles,
    },
  }

  return {
    filename: buildFilename(exportedAt),
    json: JSON.stringify(payload, null, 2),
  }
}

export async function exportAthleteProfileTestData(): Promise<{ filename: string; json: string }> {
  const exportedAt = new Date()
  const [profiles, activePlans] = await Promise.all([
    db.athleteProfiles.toArray(),
    db.trainingPlans.where('status').equals('active').toArray(),
  ])
  const athleteProfile = profiles.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null
  const activeTrainingPlan = activePlans.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null

  const payload: AthleteProfileTestExport = {
    app: BACKUP_APP_NAME,
    type: 'athlete_profile_test_export',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    exportedFromAppVersion: APP_INFO.version,
    athleteProfile,
    goalEvents: athleteProfile?.goalEvents ?? [],
    planWizardConfig: athleteProfile?.planWizardConfig ?? null,
    activeTrainingPlan,
  }

  return {
    filename: buildAthleteProfileFilename(exportedAt),
    json: JSON.stringify(payload, null, 2),
  }
}

export async function downloadAthleteProfileTestExport(): Promise<string> {
  const { filename, json } = await exportAthleteProfileTestData()
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }

  return filename
}

export async function downloadAppDataExport(): Promise<string> {
  const { filename, json } = await exportAppData()
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }

  return filename
}

export async function previewAppDataImportFile(file: File): Promise<AppDataImportPreview> {
  const backup = await readBackupFromFile(file)

  const sessionDates = backup.tables.sessions.map(s => s.date).filter(Boolean).sort()
  const sessionDateRange = sessionDates.length > 0
    ? { first: sessionDates[0], last: sessionDates[sessionDates.length - 1] }
    : null

  const mergeConflicts = await computeMergeConflicts(backup)

  return {
    importedAt: backup.exportedAt,
    importedFromAppVersion: backup.exportedFromAppVersion,
    version: backup.version,
    counts: {
      sessions: backup.tables.sessions.length,
      dayLogs: backup.tables.dayLogs.length,
      weekSummaries: backup.tables.weekSummaries.length,
      trainingPlans: backup.tables.trainingPlans.length,
      trainingPlanWeeks: backup.tables.trainingPlanWeeks.length,
      chatMessages: backup.tables.chatMessages.length,
      coachProposals: backup.tables.coachProposals.length,
      athleteProfiles: backup.tables.athleteProfiles.length,
    },
    sessionDateRange,
    mergeConflicts,
  }
}

async function computeMergeConflicts(backup: AppDataExport): Promise<MergeConflictSummary> {
  const [localSessions, localDayLogs, localWeekSummaries, localChatMessages, localProposals, localProfiles] =
    await Promise.all([
      db.sessions.toArray(),
      db.dayLogs.toArray(),
      db.weekSummaries.toArray(),
      db.chatMessages.toArray(),
      db.coachProposals.toArray(),
      db.athleteProfiles.toArray(),
    ])

  let localNewerCount = 0
  let backupNewerCount = 0
  let newInBackupCount = 0

  // Sessions — have updatedAt
  const localSessionsById = new Map(localSessions.map(s => [s.id, s]))
  for (const bs of backup.tables.sessions) {
    const local = localSessionsById.get(bs.id)
    if (!local) newInBackupCount++
    else if (local.updatedAt > bs.updatedAt) localNewerCount++
    else if (bs.updatedAt > local.updatedAt) backupNewerCount++
  }

  // DayLogs — have updatedAt
  const localDayLogsById = new Map(localDayLogs.map(d => [d.id, d]))
  for (const bd of backup.tables.dayLogs) {
    const local = localDayLogsById.get(bd.id)
    if (!local) newInBackupCount++
    else if (local.updatedAt > bd.updatedAt) localNewerCount++
    else if (bd.updatedAt > local.updatedAt) backupNewerCount++
  }

  // WeekSummaries — no updatedAt, only track new
  const localSummariesById = new Map(localWeekSummaries.map(s => [s.id, s]))
  for (const bs of backup.tables.weekSummaries) {
    const local = localSummariesById.get(bs.id)
    if (!local) newInBackupCount++
    else if ((local.updatedAt ?? 0) > (bs.updatedAt ?? 0)) localNewerCount++
    else if ((bs.updatedAt ?? 0) > (local.updatedAt ?? 0)) backupNewerCount++
  }

  // ChatMessages — immutable, only track new
  const localMessagesById = new Set(localChatMessages.map(m => m.id))
  for (const bm of backup.tables.chatMessages) {
    if (!localMessagesById.has(bm.id)) newInBackupCount++
  }

  // CoachProposals — immutable, only track new
  const localProposalsById = new Set(localProposals.map(p => p.id))
  for (const bp of backup.tables.coachProposals) {
    if (!localProposalsById.has(bp.id)) newInBackupCount++
  }

  // AthleteProfiles — have updatedAt
  const localProfilesById = new Map(localProfiles.map(p => [p.id, p]))
  for (const bp of backup.tables.athleteProfiles) {
    const local = localProfilesById.get(bp.id)
    if (!local) newInBackupCount++
    else if (local.updatedAt > bp.updatedAt) localNewerCount++
    else if (bp.updatedAt > local.updatedAt) backupNewerCount++
  }

  return { localNewerCount, backupNewerCount, newInBackupCount }
}

export async function importAppDataFromFile(
  file: File,
  mode: 'replace' | 'merge' = 'replace',
): Promise<AppDataImportResult> {
  const backup = await readBackupFromFile(file)
  const preferredChatSessionId = pickPreferredChatSessionId(backup.tables.chatMessages)

  if (mode === 'replace') {
    await db.transaction(
      'rw',
      [db.sessions, db.dayLogs, db.weekSummaries, db.trainingPlans, db.trainingPlanWeeks, db.chatMessages, db.coachProposals, db.athleteProfiles],
      async () => {
        await db.sessions.clear()
        await db.dayLogs.clear()
        await db.weekSummaries.clear()
        await db.trainingPlanWeeks.clear()
        await db.trainingPlans.clear()
        await db.chatMessages.clear()
        await db.coachProposals.clear()
        await db.athleteProfiles.clear()

        if (backup.tables.sessions.length > 0) await db.sessions.bulkPut(backup.tables.sessions)
        if (backup.tables.dayLogs.length > 0) await db.dayLogs.bulkPut(backup.tables.dayLogs)
        if (backup.tables.weekSummaries.length > 0) await db.weekSummaries.bulkPut(backup.tables.weekSummaries)
        if (backup.tables.trainingPlans.length > 0) await db.trainingPlans.bulkPut(backup.tables.trainingPlans)
        if (backup.tables.trainingPlanWeeks.length > 0) await db.trainingPlanWeeks.bulkPut(backup.tables.trainingPlanWeeks)
        if (backup.tables.chatMessages.length > 0) await db.chatMessages.bulkPut(backup.tables.chatMessages)
        if (backup.tables.coachProposals.length > 0) await db.coachProposals.bulkPut(backup.tables.coachProposals)
        if (backup.tables.athleteProfiles.length > 0) await db.athleteProfiles.bulkPut(backup.tables.athleteProfiles)
      },
    )
  } else {
    // Timestamp-aware merge: only overwrite local records if backup version is newer or doesn't exist locally.
    // ChatMessages and CoachProposals are immutable — only add records missing locally.
    // WeekSummaries have no updatedAt — only add records missing locally.
    await db.transaction(
      'rw',
      [db.sessions, db.dayLogs, db.weekSummaries, db.trainingPlans, db.trainingPlanWeeks, db.chatMessages, db.coachProposals, db.athleteProfiles],
      async () => {
        // Sessions
        const localSessions = await db.sessions.toArray()
        const localSessionsById = new Map(localSessions.map(s => [s.id, s]))
        const sessionsToWrite = backup.tables.sessions.filter(bs => {
          const local = localSessionsById.get(bs.id)
          return !local || bs.updatedAt > local.updatedAt
        })
        if (sessionsToWrite.length > 0) await db.sessions.bulkPut(sessionsToWrite)

        // DayLogs
        const localDayLogs = await db.dayLogs.toArray()
        const localDayLogsById = new Map(localDayLogs.map(d => [d.id, d]))
        const dayLogsToWrite = backup.tables.dayLogs.filter(bd => {
          const local = localDayLogsById.get(bd.id)
          return !local || bd.updatedAt > local.updatedAt
        })
        if (dayLogsToWrite.length > 0) await db.dayLogs.bulkPut(dayLogsToWrite)

        // WeekSummaries — no updatedAt, only add new
        const localSummaries = await db.weekSummaries.toArray()
        const localSummariesById = new Map(localSummaries.map(s => [s.id, s]))
        const summariesToWrite = backup.tables.weekSummaries.filter(bs => {
          const local = localSummariesById.get(bs.id)
          return !local || (bs.updatedAt ?? 0) > (local.updatedAt ?? 0)
        })
        if (summariesToWrite.length > 0) await db.weekSummaries.bulkPut(summariesToWrite)

        const localPlans = await db.trainingPlans.toArray()
        const localPlansById = new Map(localPlans.map((plan) => [plan.id, plan]))
        const plansToWrite = backup.tables.trainingPlans.filter((backupPlan) => {
          const local = localPlansById.get(backupPlan.id)
          return !local || backupPlan.updatedAt > local.updatedAt
        })
        if (plansToWrite.length > 0) await db.trainingPlans.bulkPut(plansToWrite)

        const localPlanWeeks = await db.trainingPlanWeeks.toArray()
        const localPlanWeeksById = new Map(localPlanWeeks.map((week) => [week.id, week]))
        const planWeeksToWrite = backup.tables.trainingPlanWeeks.filter((backupWeek) => {
          const local = localPlanWeeksById.get(backupWeek.id)
          return !local || backupWeek.updatedAt > local.updatedAt
        })
        if (planWeeksToWrite.length > 0) await db.trainingPlanWeeks.bulkPut(planWeeksToWrite)

        // ChatMessages — immutable, only add new
        const localMessages = await db.chatMessages.toArray()
        const localMessagesById = new Set(localMessages.map(m => m.id))
        const messagesToWrite = backup.tables.chatMessages.filter(bm => !localMessagesById.has(bm.id))
        if (messagesToWrite.length > 0) await db.chatMessages.bulkPut(messagesToWrite)

        // CoachProposals — immutable, only add new
        const localProposals = await db.coachProposals.toArray()
        const localProposalsById = new Set(localProposals.map(p => p.id))
        const proposalsToWrite = backup.tables.coachProposals.filter(bp => !localProposalsById.has(bp.id))
        if (proposalsToWrite.length > 0) await db.coachProposals.bulkPut(proposalsToWrite)

        // AthleteProfiles
        const localProfilesArr = await db.athleteProfiles.toArray()
        const localProfilesById = new Map(localProfilesArr.map(p => [p.id, p]))
        const profilesToWrite = backup.tables.athleteProfiles.filter(bp => {
          const local = localProfilesById.get(bp.id)
          return !local || bp.updatedAt > local.updatedAt
        })
        if (profilesToWrite.length > 0) await db.athleteProfiles.bulkPut(profilesToWrite)
      },
    )
  }

  syncStoresAfterImport(preferredChatSessionId)

  return {
    mode,
    importedAt: backup.exportedAt,
    importedFromAppVersion: backup.exportedFromAppVersion,
    counts: {
      sessions: backup.tables.sessions.length,
      dayLogs: backup.tables.dayLogs.length,
      weekSummaries: backup.tables.weekSummaries.length,
      trainingPlans: backup.tables.trainingPlans.length,
      trainingPlanWeeks: backup.tables.trainingPlanWeeks.length,
      chatMessages: backup.tables.chatMessages.length,
      coachProposals: backup.tables.coachProposals.length,
      athleteProfiles: backup.tables.athleteProfiles.length,
    },
  }
}

async function readBackupFromFile(file: File): Promise<AppDataExport> {
  if (!file.name.toLowerCase().endsWith('.json')) {
    throw new Error('El archivo debe ser un JSON exportado por Entrenador.')
  }

  const raw = await file.text()
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('El archivo no contiene un JSON valido.')
  }

  return parseAppDataExport(parsed)
}

export function parseAppDataExport(value: unknown): AppDataExport {
  const normalized = normalizeBackupEnvelope(value)

  const sessions = parseSessionsTable(normalized.tables.sessions)
  const dayLogs = parseDayLogsTable(normalized.tables.dayLogs)
  const weekSummaries = parseWeekSummariesTable(normalized.tables.weekSummaries)
  const trainingPlans = parseTrainingPlansTable(normalized.tables.trainingPlans ?? [])
  const trainingPlanWeeks = parseTrainingPlanWeeksTable(normalized.tables.trainingPlanWeeks ?? [])
  const trainingPlansWithGenerationState = trainingPlans.map((plan) => {
    if (plan.status === 'active' || plan.status === 'archived') return plan
    const planWeeks = trainingPlanWeeks.filter((week) => week.planId === plan.id)
    return { ...plan, generationState: derivePlanGenerationState(planWeeks) }
  })
  const chatMessages = parseChatMessagesTable(normalized.tables.chatMessages)
  const coachProposals = parseCoachProposalsTable(normalized.tables.coachProposals)
  const athleteProfiles = parseAthleteProfilesTable(normalized.tables.athleteProfiles)

  ensureChatProposalLinks(chatMessages, coachProposals)

  return {
    app: BACKUP_APP_NAME,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: normalized.exportedAt,
    exportedFromAppVersion: normalized.exportedFromAppVersion,
    tables: {
      sessions,
      dayLogs,
      weekSummaries,
      trainingPlans: trainingPlansWithGenerationState,
      trainingPlanWeeks,
      chatMessages,
      coachProposals,
      athleteProfiles,
    },
  }
}

function parseSessionsTable(value: unknown): Session[] {
  const rows = ensureArray(value, 'sessions')
  const sessions = rows.map((row, index) => parseSession(row, index))
  ensureUniqueIds(sessions, 'sessions')
  return sessions
}

function parseDayLogsTable(value: unknown): DayLog[] {
  const rows = ensureArray(value, 'dayLogs')
  const dayLogs = rows.map((row, index) => parseDayLog(row, index))
  ensureUniqueIds(dayLogs, 'dayLogs')
  return dayLogs
}

function parseWeekSummariesTable(value: unknown): WeekSummary[] {
  const rows = ensureArray(value, 'weekSummaries')
  const summaries = rows.map((row, index) => parseWeekSummary(row, index))
  ensureUniqueIds(summaries, 'weekSummaries')
  return summaries
}

function parseChatMessagesTable(value: unknown): ChatMessage[] {
  const rows = ensureArray(value, 'chatMessages')
  const messages = rows.map((row, index) => parseChatMessage(row, index))
  ensureUniqueIds(messages, 'chatMessages')
  return messages
}

function parseTrainingPlansTable(value: unknown): TrainingPlan[] {
  const rows = ensureArray(value, 'trainingPlans')
  const plans = rows.map((row, index) => parseTrainingPlan(row, index))
  ensureUniqueIds(plans, 'trainingPlans')
  return plans
}

function parseTrainingPlanWeeksTable(value: unknown): TrainingPlanWeek[] {
  const rows = ensureArray(value, 'trainingPlanWeeks')
  const weeks = rows.map((row, index) => parseTrainingPlanWeek(row, index))
  ensureUniqueIds(weeks, 'trainingPlanWeeks')
  return weeks
}

function parseCoachProposalsTable(value: unknown): CoachProposal[] {
  const rows = ensureArray(value, 'coachProposals')
  const proposals = rows.map((row, index) => parseCoachProposal(row, index))
  ensureUniqueIds(proposals, 'coachProposals')
  return proposals
}

function parseAthleteProfilesTable(value: unknown): AthleteProfile[] {
  const rows = ensureArray(value, 'athleteProfiles')
  const profiles = rows.map((row, index) => parseAthleteProfile(row, index))
  ensureUniqueIds(profiles, 'athleteProfiles')
  return profiles
}

function parseSession(value: unknown, index: number): Session {
  const row = ensureRecord(value, `sessions[${index}]`)

  return {
    id: requireString(row.id, `sessions[${index}].id`),
    date: requireISODate(row.date, `sessions[${index}].date`),
    timeBlock: requireEnum(row.timeBlock, TIME_BLOCKS, `sessions[${index}].timeBlock`) as Session['timeBlock'],
    source: optionalEnum(row.source, SESSION_SOURCES, `sessions[${index}].source`) as Session['source'],
    type: requireEnum(row.type, SESSION_TYPES, `sessions[${index}].type`) as Session['type'],
    status: requireEnum(row.status, SESSION_STATUSES, `sessions[${index}].status`) as Session['status'],
    title: requireString(row.title, `sessions[${index}].title`),
    durationMin: requireFiniteNumber(row.durationMin, `sessions[${index}].durationMin`),
    createdAt: requireFiniteNumber(row.createdAt, `sessions[${index}].createdAt`),
    updatedAt: requireFiniteNumber(row.updatedAt, `sessions[${index}].updatedAt`),
    subtype: optionalEnum(row.subtype, SQUASH_SUBTYPES, `sessions[${index}].subtype`) as Session['subtype'],
    opponent: optionalString(row.opponent, `sessions[${index}].opponent`),
    matchResult: optionalEnum(row.matchResult, MATCH_RESULTS, `sessions[${index}].matchResult`) as Session['matchResult'],
    gamesWon: optionalFiniteNumber(row.gamesWon, `sessions[${index}].gamesWon`),
    gamesLost: optionalFiniteNumber(row.gamesLost, `sessions[${index}].gamesLost`),
    objective: optionalString(row.objective, `sessions[${index}].objective`),
    actualDurationMin: optionalFiniteNumber(row.actualDurationMin, `sessions[${index}].actualDurationMin`),
    location: optionalString(row.location, `sessions[${index}].location`),
    rpe: optionalFiniteNumber(row.rpe, `sessions[${index}].rpe`),
    actualRpe: optionalFiniteNumber(row.actualRpe, `sessions[${index}].actualRpe`),
    notes: optionalString(row.notes, `sessions[${index}].notes`),
    completionNotes: optionalString(row.completionNotes, `sessions[${index}].completionNotes`),
    exercises: optionalExercises(row.exercises, `sessions[${index}].exercises`),
    runningDetails: optionalRunningDetails(row.runningDetails, `sessions[${index}].runningDetails`),
    cyclingDetails: optionalCyclingDetails(row.cyclingDetails, `sessions[${index}].cyclingDetails`),
    mobilityDetails: optionalMobilityDetails(row.mobilityDetails, `sessions[${index}].mobilityDetails`),
    squashDetails: optionalSquashDetails(row.squashDetails, `sessions[${index}].squashDetails`),
    warmup: optionalGeneratedProtocol(row.warmup, `sessions[${index}].warmup`, 'warmup'),
    cooldown: optionalGeneratedProtocol(row.cooldown, `sessions[${index}].cooldown`, 'cooldown'),
    completedAt: optionalFiniteNumber(row.completedAt, `sessions[${index}].completedAt`),
  }
}

function parseDayLog(value: unknown, index: number): DayLog {
  const row = ensureRecord(value, `dayLogs[${index}]`)

  return {
    id: requireString(row.id, `dayLogs[${index}].id`),
    date: requireISODate(row.date, `dayLogs[${index}].date`),
    updatedAt: requireFiniteNumber(row.updatedAt, `dayLogs[${index}].updatedAt`),
    sleepHours: optionalFiniteNumber(row.sleepHours, `dayLogs[${index}].sleepHours`),
    sleepQuality: optionalFiniteNumber(row.sleepQuality, `dayLogs[${index}].sleepQuality`),
    energyLevel: optionalFiniteNumber(row.energyLevel, `dayLogs[${index}].energyLevel`),
    painLevel: optionalFiniteNumber(row.painLevel, `dayLogs[${index}].painLevel`),
    painNotes: optionalString(row.painNotes, `dayLogs[${index}].painNotes`),
    rpeActual: optionalFiniteNumber(row.rpeActual, `dayLogs[${index}].rpeActual`),
    postSessionComment: optionalString(row.postSessionComment, `dayLogs[${index}].postSessionComment`),
    generalNotes: optionalString(row.generalNotes, `dayLogs[${index}].generalNotes`),
    bodyWeight: optionalFiniteNumber(row.bodyWeight, `dayLogs[${index}].bodyWeight`),
  }
}

function parseWeekSummary(value: unknown, index: number): WeekSummary {
  const row = ensureRecord(value, `weekSummaries[${index}]`)

  return {
    id: requireString(row.id, `weekSummaries[${index}].id`),
    weekStartDate: requireISODate(row.weekStartDate, `weekSummaries[${index}].weekStartDate`),
    updatedAt: optionalFiniteNumber(row.updatedAt, `weekSummaries[${index}].updatedAt`),
    totalSessions: requireFiniteNumber(row.totalSessions, `weekSummaries[${index}].totalSessions`),
    totalMinutes: requireFiniteNumber(row.totalMinutes, `weekSummaries[${index}].totalMinutes`),
    plannedSessions: requireFiniteNumber(row.plannedSessions, `weekSummaries[${index}].plannedSessions`),
    completedSessions: requireFiniteNumber(row.completedSessions, `weekSummaries[${index}].completedSessions`),
    plannedMinutes: requireFiniteNumber(row.plannedMinutes, `weekSummaries[${index}].plannedMinutes`),
    completedMinutes: requireFiniteNumber(row.completedMinutes, `weekSummaries[${index}].completedMinutes`),
    squashSessions: requireFiniteNumber(row.squashSessions, `weekSummaries[${index}].squashSessions`),
    runningSessions: requireFiniteNumber(row.runningSessions, `weekSummaries[${index}].runningSessions`),
    strengthSessions: requireFiniteNumber(row.strengthSessions, `weekSummaries[${index}].strengthSessions`),
    adherencePct: optionalFiniteNumber(row.adherencePct, `weekSummaries[${index}].adherencePct`),
    plannedSquashSessions: optionalFiniteNumber(row.plannedSquashSessions, `weekSummaries[${index}].plannedSquashSessions`),
    plannedRunningSessions: optionalFiniteNumber(row.plannedRunningSessions, `weekSummaries[${index}].plannedRunningSessions`),
    plannedStrengthSessions: optionalFiniteNumber(row.plannedStrengthSessions, `weekSummaries[${index}].plannedStrengthSessions`),
    mobilityMinutes: optionalFiniteNumber(row.mobilityMinutes, `weekSummaries[${index}].mobilityMinutes`),
    avgRpe: optionalFiniteNumber(row.avgRpe, `weekSummaries[${index}].avgRpe`),
    avgActualRpe: optionalFiniteNumber(row.avgActualRpe, `weekSummaries[${index}].avgActualRpe`),
    avgSleep: optionalFiniteNumber(row.avgSleep, `weekSummaries[${index}].avgSleep`),
    avgEnergy: optionalFiniteNumber(row.avgEnergy, `weekSummaries[${index}].avgEnergy`),
    avgBodyWeight: optionalFiniteNumber(row.avgBodyWeight, `weekSummaries[${index}].avgBodyWeight`),
    weightEntries: optionalFiniteNumber(row.weightEntries, `weekSummaries[${index}].weightEntries`),
    weekNotes: optionalString(row.weekNotes, `weekSummaries[${index}].weekNotes`),
    objectives: optionalStringArray(row.objectives, `weekSummaries[${index}].objectives`),
    coachNote: optionalString(row.coachNote, `weekSummaries[${index}].coachNote`),
  }
}

function parseChatMessage(value: unknown, index: number): ChatMessage {
  const row = ensureRecord(value, `chatMessages[${index}]`)

  return {
    id: requireString(row.id, `chatMessages[${index}].id`),
    role: requireEnum(row.role, MESSAGE_ROLES, `chatMessages[${index}].role`) as ChatMessage['role'],
    content: requireString(row.content, `chatMessages[${index}].content`),
    timestamp: requireFiniteNumber(row.timestamp, `chatMessages[${index}].timestamp`),
    chatSessionId: optionalString(row.chatSessionId, `chatMessages[${index}].chatSessionId`),
    contextMeta: optionalChatContextMetadata(row.contextMeta, `chatMessages[${index}].contextMeta`),
    context: optionalChatContext(row.context, `chatMessages[${index}].context`),
    provider: optionalEnum(row.provider, AI_PROVIDERS, `chatMessages[${index}].provider`) as ChatMessage['provider'],
    proposalId: optionalString(row.proposalId, `chatMessages[${index}].proposalId`),
  }
}

function parseCoachProposal(value: unknown, index: number): CoachProposal {
  const row = ensureRecord(value, `coachProposals[${index}]`)

  return {
    id: requireString(row.id, `coachProposals[${index}].id`),
    chatMessageId: optionalString(row.chatMessageId, `coachProposals[${index}].chatMessageId`),
    message: requireString(row.message, `coachProposals[${index}].message`),
    actions: parseCoachActions(row.actions, `coachProposals[${index}].actions`),
    planSummary: optionalPlanGenerationSummary(row.planSummary, `coachProposals[${index}].planSummary`),
    status: requireEnum(row.status, PROPOSAL_STATUSES, `coachProposals[${index}].status`) as CoachProposal['status'],
    createdAt: requireFiniteNumber(row.createdAt, `coachProposals[${index}].createdAt`),
    resolvedAt: optionalFiniteNumber(row.resolvedAt, `coachProposals[${index}].resolvedAt`),
  }
}

function parseTrainingPlan(value: unknown, index: number): TrainingPlan {
  const row = ensureRecord(value, `trainingPlans[${index}]`)
  const status = requireEnum(row.status, PLAN_STATUSES, `trainingPlans[${index}].status`) as TrainingPlan['status']
  const phases = ensureArray(row.phases, `trainingPlans[${index}].phases`).map((phase, phaseIndex) => {
    const phaseRow = ensureRecord(phase, `trainingPlans[${index}].phases[${phaseIndex}]`)
    return {
      phase: requireEnum(phaseRow.phase, MACRO_PLAN_PHASES, `trainingPlans[${index}].phases[${phaseIndex}].phase`) as TrainingPlan['phases'][number]['phase'],
      startWeekIndex: requireFiniteNumber(phaseRow.startWeekIndex, `trainingPlans[${index}].phases[${phaseIndex}].startWeekIndex`),
      endWeekIndex: requireFiniteNumber(phaseRow.endWeekIndex, `trainingPlans[${index}].phases[${phaseIndex}].endWeekIndex`),
      blockFocus: requireString(phaseRow.blockFocus, `trainingPlans[${index}].phases[${phaseIndex}].blockFocus`),
      intentBySport: ensureRecord(phaseRow.intentBySport ?? {}, `trainingPlans[${index}].phases[${phaseIndex}].intentBySport`) as TrainingPlan['phases'][number]['intentBySport'],
    }
  })

  return {
    id: requireString(row.id, `trainingPlans[${index}].id`),
    athleteId: requireString(row.athleteId, `trainingPlans[${index}].athleteId`),
    goalEventId: requireString(row.goalEventId, `trainingPlans[${index}].goalEventId`),
    status,
    generationState: (
      optionalEnum(row.generationState, PLAN_GENERATION_STATES, `trainingPlans[${index}].generationState`)
      ?? (status === 'active' || status === 'archived' ? 'complete' : 'shell')
    ) as TrainingPlan['generationState'],
    title: requireString(row.title, `trainingPlans[${index}].title`),
    startDate: requireISODate(row.startDate, `trainingPlans[${index}].startDate`),
    endDate: requireISODate(row.endDate, `trainingPlans[${index}].endDate`),
    totalWeeks: requireFiniteNumber(row.totalWeeks, `trainingPlans[${index}].totalWeeks`),
    phases,
    wizardConfig: parsePlanWizardConfig(row.wizardConfig, `trainingPlans[${index}].wizardConfig`),
    macroSnapshot:
      optionalMacroPlan(row.macroSnapshot, `trainingPlans[${index}].macroSnapshot`)
      ?? optionalMacroPlan(row.macroPlan, `trainingPlans[${index}].macroPlan`)
      ?? (() => { throw new Error(`trainingPlans[${index}].macroSnapshot es requerido.`) })(),
    createdAt: requireFiniteNumber(row.createdAt, `trainingPlans[${index}].createdAt`),
    updatedAt: requireFiniteNumber(row.updatedAt, `trainingPlans[${index}].updatedAt`),
    acceptedAt: optionalFiniteNumber(row.acceptedAt, `trainingPlans[${index}].acceptedAt`),
    notes: optionalString(row.notes, `trainingPlans[${index}].notes`),
    generationSummary: optionalTrainingPlanGenerationSummary(row.generationSummary, `trainingPlans[${index}].generationSummary`),
  }
}

function parseTrainingPlanWeek(value: unknown, index: number): TrainingPlanWeek {
  const row = ensureRecord(value, `trainingPlanWeeks[${index}]`)
  return {
    id: requireString(row.id, `trainingPlanWeeks[${index}].id`),
    planId: requireString(row.planId, `trainingPlanWeeks[${index}].planId`),
    weekIndex: requireFiniteNumber(row.weekIndex, `trainingPlanWeeks[${index}].weekIndex`),
    weekStartDate: requireISODate(row.weekStartDate, `trainingPlanWeeks[${index}].weekStartDate`),
    phase: requireEnum(row.phase, MACRO_PLAN_PHASES, `trainingPlanWeeks[${index}].phase`) as TrainingPlanWeek['phase'],
    status: requireEnum(row.status, PLAN_WEEK_STATUSES, `trainingPlanWeeks[${index}].status`) as TrainingPlanWeek['status'],
    sessions: optionalCoachSessions(row.sessions, `trainingPlanWeeks[${index}].sessions`) ?? [],
    weekObjectives: optionalPlanWeekObjectives(row.weekObjectives, `trainingPlanWeeks[${index}].weekObjectives`),
    targetLoadBySport: ensureRecord(row.targetLoadBySport ?? {}, `trainingPlanWeeks[${index}].targetLoadBySport`) as TrainingPlanWeek['targetLoadBySport'],
    validationIssues: optionalPlanValidationIssues(row.validationIssues, `trainingPlanWeeks[${index}].validationIssues`),
    generationMeta: optionalWeekGenerationMeta(row.generationMeta, `trainingPlanWeeks[${index}].generationMeta`),
    createdAt: requireFiniteNumber(row.createdAt, `trainingPlanWeeks[${index}].createdAt`),
    updatedAt: requireFiniteNumber(row.updatedAt, `trainingPlanWeeks[${index}].updatedAt`),
  }
}

function parseAthleteProfile(value: unknown, index: number): AthleteProfile {
  const row = ensureRecord(value, `athleteProfiles[${index}]`)

  return {
    id: requireString(row.id, `athleteProfiles[${index}].id`),
    coachMemory: optionalString(row.coachMemory, `athleteProfiles[${index}].coachMemory`),
    updatedAt: requireFiniteNumber(row.updatedAt, `athleteProfiles[${index}].updatedAt`),
    name: optionalString(row.name, `athleteProfiles[${index}].name`),
    age: optionalFiniteNumber(row.age, `athleteProfiles[${index}].age`),
    weightKg: optionalFiniteNumber(row.weightKg, `athleteProfiles[${index}].weightKg`),
    primarySport: optionalString(row.primarySport, `athleteProfiles[${index}].primarySport`),
    secondarySports: optionalStringArray(row.secondarySports, `athleteProfiles[${index}].secondarySports`),
    sportContext: optionalSportContext(row.sportContext, `athleteProfiles[${index}].sportContext`),
    mainGoal: optionalString(row.mainGoal, `athleteProfiles[${index}].mainGoal`),
    secondaryGoal: optionalString(row.secondaryGoal, `athleteProfiles[${index}].secondaryGoal`),
    runningProfile: optionalRunningProfile(row.runningProfile, `athleteProfiles[${index}].runningProfile`),
    strengthProfile: optionalStrengthProfile(row.strengthProfile, `athleteProfiles[${index}].strengthProfile`),
    recoveryProfile: optionalRecoveryProfile(row.recoveryProfile, `athleteProfiles[${index}].recoveryProfile`),
    scheduleProfile: optionalScheduleProfile(row.scheduleProfile, `athleteProfiles[${index}].scheduleProfile`),
    nutritionProfile: optionalNutritionProfile(row.nutritionProfile, `athleteProfiles[${index}].nutritionProfile`),
    goalEvents: optionalGoalEvents(row.goalEvents, `athleteProfiles[${index}].goalEvents`),
    macroPlan: optionalMacroPlan(row.macroPlan, `athleteProfiles[${index}].macroPlan`),
  }
}

function parseCoachActions(value: unknown, path: string): CoachAction[] {
  const actions = ensureArray(value, path)
  return actions.map((action, index) => parseCoachAction(action, `${path}[${index}]`))
}

function parseCoachAction(value: unknown, path: string): CoachAction {
  const row = ensureRecord(value, path)

  return {
    type: requireEnum(row.type, COACH_ACTION_TYPES, `${path}.type`) as CoachAction['type'],
    reason: requireString(row.reason, `${path}.reason`),
    sessionId: optionalString(row.sessionId, `${path}.sessionId`),
    targetDate: optionalISODate(row.targetDate, `${path}.targetDate`),
    rpe: optionalFiniteNumber(row.rpe, `${path}.rpe`),
    newRpe: optionalFiniteNumber(row.newRpe, `${path}.newRpe`),
    newDurationMin: optionalFiniteNumber(row.newDurationMin, `${path}.newDurationMin`),
    newType: optionalEnum(row.newType, SESSION_TYPES, `${path}.newType`) as CoachAction['newType'],
    sessionType: optionalEnum(row.sessionType, SESSION_TYPES, `${path}.sessionType`) as CoachAction['sessionType'],
    title: optionalString(row.title, `${path}.title`),
    durationMin: optionalFiniteNumber(row.durationMin, `${path}.durationMin`),
    timeBlock: optionalEnum(row.timeBlock, TIME_BLOCKS, `${path}.timeBlock`) as CoachAction['timeBlock'],
    objective: optionalString(row.objective, `${path}.objective`),
    subtype: optionalEnum(row.subtype, SQUASH_SUBTYPES, `${path}.subtype`) as CoachAction['subtype'],
    runningType: optionalEnum(row.runningType, RUNNING_TYPES, `${path}.runningType`) as CoachAction['runningType'],
    targetPaceMin: optionalString(row.targetPaceMin, `${path}.targetPaceMin`),
    targetPaceMax: optionalString(row.targetPaceMax, `${path}.targetPaceMax`),
    targetHrMin: optionalFiniteNumber(row.targetHrMin, `${path}.targetHrMin`),
    targetHrMax: optionalFiniteNumber(row.targetHrMax, `${path}.targetHrMax`),
    sessions: optionalCoachSessions(row.sessions, `${path}.sessions`) as CoachAction['sessions'],
    weekObjectives: optionalStringArray(row.weekObjectives, `${path}.weekObjectives`),
    newTitle: optionalString(row.newTitle, `${path}.newTitle`),
    newObjective: optionalString(row.newObjective, `${path}.newObjective`),
    exercises: optionalCoachExercises(row.exercises, `${path}.exercises`) as CoachAction['exercises'],
    squashDetails: optionalSquashDetails(row.squashDetails, `${path}.squashDetails`) as CoachAction['squashDetails'],
    warmup: optionalGeneratedProtocol(row.warmup, `${path}.warmup`, 'warmup') as CoachAction['warmup'],
    cooldown: optionalGeneratedProtocol(row.cooldown, `${path}.cooldown`, 'cooldown') as CoachAction['cooldown'],
  }
}

function optionalExercises(value: unknown, path: string): Session['exercises'] {
  if (value == null) return undefined
  const exercises = ensureArray(value, path)

  return exercises.map((exercise, index) => {
    const row = ensureRecord(exercise, `${path}[${index}]`)
    return {
      id: requireString(row.id, `${path}[${index}].id`),
      name: requireString(row.name, `${path}[${index}].name`),
      sets: requireFiniteNumber(row.sets, `${path}[${index}].sets`),
      reps: requireNumberOrString(row.reps, `${path}[${index}].reps`),
      completed: requireBoolean(row.completed, `${path}[${index}].completed`),
      weight: optionalFiniteNumber(row.weight, `${path}[${index}].weight`),
      notes: optionalString(row.notes, `${path}[${index}].notes`),
      group: optionalString(row.group, `${path}[${index}].group`) as NonNullable<Session['exercises']>[number]['group'],
      mobilityFocus: optionalString(row.mobilityFocus, `${path}[${index}].mobilityFocus`) as NonNullable<Session['exercises']>[number]['mobilityFocus'],
      durationSec: optionalFiniteNumber(row.durationSec, `${path}[${index}].durationSec`),
      targetPercent1RM: optionalPercent1RM(row.targetPercent1RM, `${path}[${index}].targetPercent1RM`),
      targetRpe: optionalRpe(row.targetRpe, `${path}[${index}].targetRpe`),
      warmupSets: optionalWarmupSets(row.warmupSets, `${path}[${index}].warmupSets`),
    }
  })
}

function optionalPlanGenerationSummary(value: unknown, path: string): CoachProposal['planSummary'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)

  const sessionsBySport = ensureRecord(row.sessionsBySport ?? {}, `${path}.sessionsBySport`)
  const estimatedLoadBySport = ensureRecord(row.estimatedLoadBySport ?? {}, `${path}.estimatedLoadBySport`)
  const intentsBySport = ensureRecord(row.intentsBySport ?? {}, `${path}.intentsBySport`)

  return {
    allowedSports: optionalEnumArray(row.allowedSports, SUPPORTED_SPORTS, `${path}.allowedSports`) as SupportedSport[] ?? [],
    excludedSports: optionalEnumArray(row.excludedSports, SUPPORTED_SPORTS, `${path}.excludedSports`) as SupportedSport[] ?? [],
    sessionsBySport: Object.fromEntries(
      Object.entries(sessionsBySport).map(([key, item]) => [
        key,
        requireFiniteNumber(item, `${path}.sessionsBySport.${key}`),
      ]),
    ) as NonNullable<CoachProposal['planSummary']>['sessionsBySport'],
    estimatedLoadBySport: Object.fromEntries(
      Object.entries(estimatedLoadBySport).map(([key, item]) => [
        key,
        requireFiniteNumber(item, `${path}.estimatedLoadBySport.${key}`),
      ]),
    ) as NonNullable<CoachProposal['planSummary']>['estimatedLoadBySport'],
    intentsBySport: Object.fromEntries(
      Object.entries(intentsBySport).map(([key, item]) => [
        key,
        requireEnum(item, new Set(['progress', 'hold', 'rotate', 'deload', 'unknown']), `${path}.intentsBySport.${key}`),
      ]),
    ) as NonNullable<CoachProposal['planSummary']>['intentsBySport'],
    weeklyIntent: requireEnum(row.weeklyIntent, new Set(['progress', 'hold', 'rotate', 'deload', 'unknown']), `${path}.weeklyIntent`) as NonNullable<CoachProposal['planSummary']>['weeklyIntent'],
    weeklyGoalSummary: requireString(row.weeklyGoalSummary, `${path}.weeklyGoalSummary`),
    validationStatus: requireEnum(row.validationStatus, new Set(['ok', 'warning']), `${path}.validationStatus`) as NonNullable<CoachProposal['planSummary']>['validationStatus'],
    validationIssues: optionalStringArray(row.validationIssues, `${path}.validationIssues`) ?? [],
    macroWeekCoherence: optionalMacroWeekCoherenceSummary(row.macroWeekCoherence, `${path}.macroWeekCoherence`),
  }
}

function optionalMacroWeekCoherenceSummary(value: unknown, path: string): MacroWeekCoherenceSummary {
  if (value == null) {
    return {
      currentPhase: 'base',
      blockGoal: 'Construir base general.',
      weeklyRule: 'Construir base general sin sobrecargar accesorios.',
      targetDistributionBySport: {},
      actualDistributionBySport: {},
      expectedSessionsBySport: {},
      coherenceStatus: 'ok',
      coherenceIssues: [],
    }
  }
  const row = ensureRecord(value, path)
  const targetDistribution = ensureRecord(row.targetDistributionBySport ?? {}, `${path}.targetDistributionBySport`)
  const actualDistribution = ensureRecord(row.actualDistributionBySport ?? {}, `${path}.actualDistributionBySport`)
  const expectedSessions = ensureRecord(row.expectedSessionsBySport ?? {}, `${path}.expectedSessionsBySport`)

  return {
    currentPhase: requireEnum(row.currentPhase, MACRO_PLAN_PHASES, `${path}.currentPhase`) as MacroWeekCoherenceSummary['currentPhase'],
    blockGoal: requireString(row.blockGoal, `${path}.blockGoal`),
    weeklyRule: requireString(row.weeklyRule, `${path}.weeklyRule`),
    targetDistributionBySport: Object.fromEntries(
      Object.entries(targetDistribution).map(([key, item]) => [
        key,
        requireEnum(item, PHASE_SPORT_TARGET_ROLES, `${path}.targetDistributionBySport.${key}`),
      ]),
    ) as Partial<Record<SupportedSport, PhaseSportTargetRole>>,
    actualDistributionBySport: Object.fromEntries(
      Object.entries(actualDistribution).map(([key, item]) => [
        key,
        requireFiniteNumber(item, `${path}.actualDistributionBySport.${key}`),
      ]),
    ) as Partial<Record<SupportedSport, number>>,
    expectedSessionsBySport: Object.fromEntries(
      Object.entries(expectedSessions).map(([key, item]) => [
        key,
        requireString(item, `${path}.expectedSessionsBySport.${key}`),
      ]),
    ) as Partial<Record<SupportedSport, string>>,
    coherenceStatus: requireEnum(row.coherenceStatus, new Set(['ok', 'warning']), `${path}.coherenceStatus`) as MacroWeekCoherenceSummary['coherenceStatus'],
    coherenceIssues: optionalStringArray(row.coherenceIssues, `${path}.coherenceIssues`) ?? [],
  }
}

function optionalCoachExercises(value: unknown, path: string): CoachAction['exercises'] {
  if (value == null) return undefined
  const exercises = ensureArray(value, path)

  return exercises.map((exercise, index) => {
    const row = ensureRecord(exercise, `${path}[${index}]`)
    return {
      name: requireString(row.name, `${path}[${index}].name`),
      sets: requireFiniteNumber(row.sets, `${path}[${index}].sets`),
      reps: requireNumberOrString(row.reps, `${path}[${index}].reps`),
      weight: optionalFiniteNumber(row.weight, `${path}[${index}].weight`),
      notes: optionalString(row.notes, `${path}[${index}].notes`),
      group: optionalString(row.group, `${path}[${index}].group`) as NonNullable<CoachAction['exercises']>[number]['group'],
      mobilityFocus: optionalString(row.mobilityFocus, `${path}[${index}].mobilityFocus`) as NonNullable<CoachAction['exercises']>[number]['mobilityFocus'],
      targetPercent1RM: optionalPercent1RM(row.targetPercent1RM, `${path}[${index}].targetPercent1RM`),
      targetRpe: optionalRpe(row.targetRpe, `${path}[${index}].targetRpe`),
      warmupSets: optionalWarmupSets(row.warmupSets, `${path}[${index}].warmupSets`),
    }
  })
}

function optionalWarmupSets(value: unknown, path: string): WarmupSet[] | undefined {
  if (value == null) return undefined
  const sets = ensureArray(value, path).map((set, index) => {
    const row = ensureRecord(set, `${path}[${index}]`)
    return {
      reps: requireNumberOrString(row.reps, `${path}[${index}].reps`),
      weight: optionalPositiveNumber(row.weight, `${path}[${index}].weight`),
      percent1RM: optionalPercent1RM(row.percent1RM, `${path}[${index}].percent1RM`),
    }
  })
  return sets.length > 0 ? sets : undefined
}

function optionalPercent1RM(value: unknown, path: string): number | undefined {
  const number = optionalPositiveNumber(value, path)
  if (number == null) return undefined
  if (number > 100) throw new Error(`${path} debe ser menor o igual a 100.`)
  return number
}

function optionalRpe(value: unknown, path: string): number | undefined {
  if (value == null) return undefined
  const number = requireFiniteNumber(value, path)
  if (number < 1 || number > 10) throw new Error(`${path} debe estar entre 1 y 10.`)
  return number
}

function optionalPositiveNumber(value: unknown, path: string): number | undefined {
  if (value == null) return undefined
  const number = requireFiniteNumber(value, path)
  if (number <= 0) throw new Error(`${path} debe ser mayor que 0.`)
  return number
}

function optionalCoachSessions(value: unknown, path: string): CoachAction['sessions'] {
  if (value == null) return undefined
  const sessions = ensureArray(value, path)

  return sessions.map((session, index) => {
    const row = ensureRecord(session, `${path}[${index}]`)
    return {
      date: requireISODate(row.date, `${path}[${index}].date`),
      timeBlock: requireEnum(row.timeBlock, TIME_BLOCKS, `${path}[${index}].timeBlock`) as NonNullable<CoachAction['sessions']>[number]['timeBlock'],
      sessionType: requireEnum(row.sessionType, SESSION_TYPES, `${path}[${index}].sessionType`) as NonNullable<CoachAction['sessions']>[number]['sessionType'],
      title: requireString(row.title, `${path}[${index}].title`),
      durationMin: requireFiniteNumber(row.durationMin, `${path}[${index}].durationMin`),
      rpe: optionalFiniteNumber(row.rpe, `${path}[${index}].rpe`),
      objective: optionalString(row.objective, `${path}[${index}].objective`),
      subtype: optionalEnum(row.subtype, SQUASH_SUBTYPES, `${path}[${index}].subtype`) as NonNullable<CoachAction['sessions']>[number]['subtype'],
      runningType: optionalEnum(row.runningType, RUNNING_TYPES, `${path}[${index}].runningType`) as NonNullable<CoachAction['sessions']>[number]['runningType'],
      targetPaceMin: optionalString(row.targetPaceMin, `${path}[${index}].targetPaceMin`),
      targetPaceMax: optionalString(row.targetPaceMax, `${path}[${index}].targetPaceMax`),
      targetHrMin: optionalFiniteNumber(row.targetHrMin, `${path}[${index}].targetHrMin`),
      targetHrMax: optionalFiniteNumber(row.targetHrMax, `${path}[${index}].targetHrMax`),
      exercises: optionalCoachExercises(row.exercises, `${path}[${index}].exercises`),
      squashDetails: optionalSquashDetails(row.squashDetails, `${path}[${index}].squashDetails`),
      warmup: optionalGeneratedProtocol(row.warmup, `${path}[${index}].warmup`, 'warmup'),
      cooldown: optionalGeneratedProtocol(row.cooldown, `${path}[${index}].cooldown`, 'cooldown'),
    }
  })
}

function optionalGeneratedProtocol(
  value: unknown,
  path: string,
  kind: 'warmup' | 'cooldown',
): Session['warmup'] {
  if (value == null) return undefined

  if (Array.isArray(value)) {
    const rows = ensureArray(value, path)
    const steps = rows.flatMap((item, index) => {
      const row = ensureRecord(item, `${path}[${index}]`)
      const title = optionalString(row.title, `${path}[${index}].title`)
      return ensureArray(row.steps, `${path}[${index}].steps`).map((step, stepIndex) => ({
        label: title ? `${title}: ${requireString(step, `${path}[${index}].steps[${stepIndex}]`)}` : requireString(step, `${path}[${index}].steps[${stepIndex}]`),
      }))
    })

    const durationMin = rows.reduce<number>((total, item, index) => {
      const row = ensureRecord(item, `${path}[${index}]`)
      return total + (optionalFiniteNumber(row.durationMin, `${path}[${index}].durationMin`) ?? 0)
    }, 0)

    return {
      title: kind === 'warmup' ? 'Warm-up recomendado' : 'Cooldown recomendado',
      durationMin: durationMin > 0 ? durationMin : kind === 'warmup' ? 8 : 6,
      note: 'Protocolo migrado desde una versión anterior del backup.',
      tone: kind === 'warmup' ? 'general' : 'recovery',
      steps,
      source: 'base',
    }
  }

  const row = ensureRecord(value, path)
  const rawSteps = ensureArray(row.steps, `${path}.steps`).map((step, index) => {
    const stepPath = `${path}.steps[${index}]`
    if (typeof step === 'string') {
      return { label: requireString(step, stepPath) }
    }
    const stepRow = ensureRecord(step, stepPath)
    return {
      label: requireString(stepRow.label, `${stepPath}.label`),
      detail: optionalString(stepRow.detail, `${stepPath}.detail`),
    }
  })

  return {
    title: requireString(row.title, `${path}.title`),
    durationMin: requireFiniteNumber(row.durationMin, `${path}.durationMin`),
    note: requireString(row.note, `${path}.note`),
    tone: requireEnum(row.tone, new Set(['general', 'protective', 'competitive', 'recovery']), `${path}.tone`) as NonNullable<Session['warmup']>['tone'],
    steps: rawSteps,
    source: requireEnum(row.source, new Set(['base', 'adapted']), `${path}.source`) as NonNullable<Session['warmup']>['source'],
  }
}

function optionalRunningDetails(value: unknown, path: string): Session['runningDetails'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)

  return {
    runningType: requireEnum(row.runningType, RUNNING_TYPES, `${path}.runningType`) as NonNullable<Session['runningDetails']>['runningType'],
    targetPaceMin: optionalString(row.targetPaceMin, `${path}.targetPaceMin`),
    targetPaceMax: optionalString(row.targetPaceMax, `${path}.targetPaceMax`),
    targetHrMin: optionalFiniteNumber(row.targetHrMin, `${path}.targetHrMin`),
    targetHrMax: optionalFiniteNumber(row.targetHrMax, `${path}.targetHrMax`),
  }
}

function optionalCyclingDetails(value: unknown, path: string): Session['cyclingDetails'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)

  return {
    sessionCategory: requireString(row.sessionCategory, `${path}.sessionCategory`),
    sessionFamily: optionalString(row.sessionFamily, `${path}.sessionFamily`),
    targetStructure: requireString(row.targetStructure, `${path}.targetStructure`),
    intensityReference: optionalString(row.intensityReference, `${path}.intensityReference`),
    executionNotes: optionalString(row.executionNotes, `${path}.executionNotes`),
  }
}

function optionalMobilityDetails(value: unknown, path: string): Session['mobilityDetails'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  const focusAreas = ensureArray(row.focusAreas, `${path}.focusAreas`)
    .map((item, index) => requireString(item, `${path}.focusAreas[${index}]`))

  return {
    focusAreas,
    context: requireEnum(
      row.context,
      MOBILITY_SESSION_CONTEXTS,
      `${path}.context`,
    ) as NonNullable<Session['mobilityDetails']>['context'],
    targetStructure: requireString(row.targetStructure, `${path}.targetStructure`),
    executionNotes: optionalString(row.executionNotes, `${path}.executionNotes`),
  }
}

function optionalSquashDetails(value: unknown, path: string): Session['squashDetails'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  const parseDrill = (drill: unknown, drillPath: string) => {
    const drillRow = ensureRecord(drill, drillPath)
    return {
      name: requireString(drillRow.name, `${drillPath}.name`),
      durationMin: optionalFiniteNumber(drillRow.durationMin, `${drillPath}.durationMin`),
      notes: optionalString(drillRow.notes, `${drillPath}.notes`),
    }
  }
  const blocks = row.blocks == null
    ? undefined
    : ensureArray(row.blocks, `${path}.blocks`).map((block, index) => {
        const blockRow = ensureRecord(block, `${path}.blocks[${index}]`)
        const blockDrills = ensureArray(blockRow.drills, `${path}.blocks[${index}].drills`).map((drill, drillIndex) =>
          parseDrill(drill, `${path}.blocks[${index}].drills[${drillIndex}]`),
        )
        if (blockDrills.length === 0) {
          throw new Error(`${path}.blocks[${index}].drills debe incluir al menos un drill.`)
        }
        return {
          kind: requireEnum(blockRow.kind, SQUASH_BLOCK_KINDS, `${path}.blocks[${index}].kind`) as NonNullable<NonNullable<Session['squashDetails']>['blocks']>[number]['kind'],
          durationMin: optionalFiniteNumber(blockRow.durationMin, `${path}.blocks[${index}].durationMin`),
          drills: blockDrills,
        }
      })
  const drills = row.drills == null
    ? (blocks ?? []).flatMap((block) => block.drills)
    : ensureArray(row.drills, `${path}.drills`).map((drill, index) => parseDrill(drill, `${path}.drills[${index}]`))

  if (drills.length === 0) {
    throw new Error(`${path}.drills debe incluir al menos un drill o derivarse desde blocks.`)
  }

  return {
    trainingFocus: requireEnum(row.trainingFocus, SQUASH_TRAINING_FOCUSES, `${path}.trainingFocus`) as NonNullable<Session['squashDetails']>['trainingFocus'],
    drills,
    sessionMode: optionalEnum(row.sessionMode, SQUASH_SESSION_MODES, `${path}.sessionMode`) as NonNullable<Session['squashDetails']>['sessionMode'],
    sessionKind: optionalEnum(row.sessionKind, SQUASH_SESSION_KINDS, `${path}.sessionKind`) as NonNullable<Session['squashDetails']>['sessionKind'],
    blocks,
  }
}

function optionalChatContext(value: unknown, path: string): ChatMessage['context'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  const recentSessions = ensureArray(row.recentSessions, `${path}.recentSessions`)
  recentSessions.forEach((session, index) => {
    parseSession(session, index)
  })
  const plannedSessions = row.plannedSessions == null
    ? undefined
    : ensureArray(row.plannedSessions, `${path}.plannedSessions`).map((session, index) => parseSession(session, index))
  const historicalSessions = row.historicalSessions == null
    ? undefined
    : ensureArray(row.historicalSessions, `${path}.historicalSessions`).map((session, index) => parseSession(session, index))

  const context = {
    recentSessions: recentSessions as Session[],
    plannedSessions: plannedSessions as Session[] | undefined,
    historicalSessions: historicalSessions as Session[] | undefined,
    currentWeekSummary: row.currentWeekSummary == null ? undefined : parseWeekSummary(row.currentWeekSummary, 0),
    dayLog: row.dayLog == null ? undefined : parseDayLog(row.dayLog, 0),
    weekDayLogs: row.weekDayLogs == null
      ? undefined
      : ensureArray(row.weekDayLogs, `${path}.weekDayLogs`).map((log, index) => parseDayLog(log, index)),
    athleteMemory: optionalString(row.athleteMemory, `${path}.athleteMemory`),
    athleteProfile: row.athleteProfile == null ? undefined : parseAthleteProfile(row.athleteProfile, 0),
    recentMessages: row.recentMessages == null
      ? undefined
      : ensureArray(row.recentMessages, `${path}.recentMessages`).map((message, index) => {
          const item = ensureRecord(message, `${path}.recentMessages[${index}]`)
          return {
            role: requireEnum(item.role, MESSAGE_ROLES, `${path}.recentMessages[${index}].role`) as 'user' | 'coach',
            content: requireString(item.content, `${path}.recentMessages[${index}].content`),
          }
        }),
    intent: row.intent == null
      ? undefined
      : requireEnum(
          row.intent,
          new Set(['general_chat', 'plan_week', 'adjust_session', 'weekly_summary']),
          `${path}.intent`,
        ) as NonNullable<ChatMessage['context']>['intent'],
  }

  return context
}

function optionalChatContextMetadata(value: unknown, path: string): ChatMessage['contextMeta'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    contextVersion: 1,
    intent: row.intent == null
      ? undefined
      : requireEnum(
          row.intent,
          new Set(['general_chat', 'plan_week', 'adjust_session', 'weekly_summary']),
          `${path}.intent`,
        ) as NonNullable<ChatMessage['contextMeta']>['intent'],
    traceId: optionalString(row.traceId, `${path}.traceId`),
    likelyTruncated: optionalBoolean(row.likelyTruncated, `${path}.likelyTruncated`),
    plannedSessionCount: optionalFiniteNumber(row.plannedSessionCount, `${path}.plannedSessionCount`),
    historicalSessionCount: optionalFiniteNumber(row.historicalSessionCount, `${path}.historicalSessionCount`),
    recentSessionCount: optionalFiniteNumber(row.recentSessionCount, `${path}.recentSessionCount`),
    weekDayLogCount: optionalFiniteNumber(row.weekDayLogCount, `${path}.weekDayLogCount`),
    hasDayLog: optionalBoolean(row.hasDayLog, `${path}.hasDayLog`),
    hasAthleteProfile: optionalBoolean(row.hasAthleteProfile, `${path}.hasAthleteProfile`),
    hasAthleteMemory: optionalBoolean(row.hasAthleteMemory, `${path}.hasAthleteMemory`),
  }
}

function parsePlanWizardConfig(value: unknown, path: string): TrainingPlan['wizardConfig'] {
  const row = ensureRecord(value, path)
  return {
    goalEventId: requireString(row.goalEventId, `${path}.goalEventId`),
    trainingDays: optionalEnumArray(
      row.trainingDays,
      new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
      `${path}.trainingDays`,
    ) as TrainingPlan['wizardConfig']['trainingDays'] ?? [],
    sessionsPerWeek: requireFiniteNumber(row.sessionsPerWeek, `${path}.sessionsPerWeek`),
    sessionDurationMins: requireFiniteNumber(row.sessionDurationMins, `${path}.sessionDurationMins`),
    allowDoubleSession: requireBoolean(row.allowDoubleSession, `${path}.allowDoubleSession`),
    complementarySports: optionalEnumArray(row.complementarySports, SUPPORTED_SPORTS, `${path}.complementarySports`) as TrainingPlan['wizardConfig']['complementarySports'] ?? [],
    currentFitnessLevel: requireEnum(
      row.currentFitnessLevel,
      new Set(['fit', 'normal', 'returning', 'low']),
      `${path}.currentFitnessLevel`,
    ) as TrainingPlan['wizardConfig']['currentFitnessLevel'],
    currentFatigue: requireEnum(
      row.currentFatigue,
      new Set(['fresh', 'normal', 'loaded', 'overloaded']),
      `${path}.currentFatigue`,
    ) as TrainingPlan['wizardConfig']['currentFatigue'],
    injuryNotes: optionalString(row.injuryNotes, `${path}.injuryNotes`),
    createdAt: requireString(row.createdAt, `${path}.createdAt`),
    updatedAt: requireString(row.updatedAt, `${path}.updatedAt`),
  }
}

function optionalTrainingPlanGenerationSummary(value: unknown, path: string): TrainingPlan['generationSummary'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    startedAt: requireFiniteNumber(row.startedAt, `${path}.startedAt`),
    completedAt: optionalFiniteNumber(row.completedAt, `${path}.completedAt`),
    totalDurationMs: optionalFiniteNumber(row.totalDurationMs, `${path}.totalDurationMs`),
    strategy: requireEnum(row.strategy, new Set(['single', 'pairs']), `${path}.strategy`) as NonNullable<TrainingPlan['generationSummary']>['strategy'],
    completedWeeks: requireFiniteNumber(row.completedWeeks, `${path}.completedWeeks`),
    failedWeeks: ensureArray(row.failedWeeks ?? [], `${path}.failedWeeks`).map((item, index) => requireFiniteNumber(item, `${path}.failedWeeks[${index}]`)),
    totalAttempts: requireFiniteNumber(row.totalAttempts, `${path}.totalAttempts`),
    acceptedAt: optionalFiniteNumber(row.acceptedAt, `${path}.acceptedAt`),
    discardedAt: optionalFiniteNumber(row.discardedAt, `${path}.discardedAt`),
  }
}

function optionalPlanWeekObjectives(value: unknown, path: string): TrainingPlanWeek['weekObjectives'] {
  if (value == null) return []
  return ensureArray(value, path).map((item, index) => {
    const row = ensureRecord(item, `${path}[${index}]`)
    return {
      sport: optionalEnum(row.sport, SUPPORTED_SPORTS, `${path}[${index}].sport`) as TrainingPlanWeek['weekObjectives'][number]['sport'],
      goal: requireString(row.goal, `${path}[${index}].goal`),
      metric: optionalString(row.metric, `${path}[${index}].metric`),
    }
  })
}

function optionalPlanValidationIssues(value: unknown, path: string): TrainingPlanWeek['validationIssues'] {
  if (value == null) return []
  return ensureArray(value, path).map((item, index) => {
    const row = ensureRecord(item, `${path}[${index}]`)
    return {
      severity: requireEnum(row.severity, new Set(['error', 'warning', 'info']), `${path}[${index}].severity`) as TrainingPlanWeek['validationIssues'][number]['severity'],
      code: requireString(row.code, `${path}[${index}].code`),
      message: requireString(row.message, `${path}[${index}].message`),
      weekIndex: optionalFiniteNumber(row.weekIndex, `${path}[${index}].weekIndex`),
      sessionId: optionalString(row.sessionId, `${path}[${index}].sessionId`),
    }
  })
}

function optionalWeekGenerationMeta(value: unknown, path: string): TrainingPlanWeek['generationMeta'] {
  if (value == null) {
    return { attempts: 0 }
  }
  const row = ensureRecord(value, path)
  return {
    provider: optionalString(row.provider, `${path}.provider`),
    model: optionalString(row.model, `${path}.model`),
    requestClass: optionalString(row.requestClass, `${path}.requestClass`) as TrainingPlanWeek['generationMeta']['requestClass'],
    traceId: optionalString(row.traceId, `${path}.traceId`),
    promptTokens: optionalFiniteNumber(row.promptTokens, `${path}.promptTokens`),
    completionTokens: optionalFiniteNumber(row.completionTokens, `${path}.completionTokens`),
    attempts: requireFiniteNumber(row.attempts, `${path}.attempts`),
    lastError: optionalString(row.lastError, `${path}.lastError`),
    lastAttemptAt: optionalFiniteNumber(row.lastAttemptAt, `${path}.lastAttemptAt`),
    durationMs: optionalFiniteNumber(row.durationMs, `${path}.durationMs`),
    chunkCount: optionalFiniteNumber(row.chunkCount, `${path}.chunkCount`),
    retryUsed: optionalBoolean(row.retryUsed, `${path}.retryUsed`),
    fallbackUsed: optionalBoolean(row.fallbackUsed, `${path}.fallbackUsed`),
    strategy: optionalEnum(row.strategy, new Set(['single', 'pairs']), `${path}.strategy`) as TrainingPlanWeek['generationMeta']['strategy'],
    batchId: optionalString(row.batchId, `${path}.batchId`),
    rawSessionCount: optionalFiniteNumber(row.rawSessionCount, `${path}.rawSessionCount`),
    validSessionCount: optionalFiniteNumber(row.validSessionCount, `${path}.validSessionCount`),
    droppedSessionCount: optionalFiniteNumber(row.droppedSessionCount, `${path}.droppedSessionCount`),
    degradedFromPairs: optionalBoolean(row.degradedFromPairs, `${path}.degradedFromPairs`),
  }
}

function ensureUniqueIds<T extends { id: string }>(rows: T[], tableName: string): void {
  const ids = new Set<string>()
  for (const row of rows) {
    if (ids.has(row.id)) {
      throw new Error(`El backup contiene IDs duplicados en ${tableName}: ${row.id}.`)
    }
    ids.add(row.id)
  }
}

function ensureArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} debe ser un array.`)
  }
  return value
}

function ensureRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} debe ser un objeto.`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} debe ser un string no vacio.`)
  }
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value == null) return undefined
  return requireString(value, path)
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} debe ser un numero valido.`)
  }
  return value
}

function optionalFiniteNumber(value: unknown, path: string): number | undefined {
  if (value == null) return undefined
  return requireFiniteNumber(value, path)
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} debe ser boolean.`)
  }
  return value
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value == null) return undefined
  return requireBoolean(value, path)
}

function requireNumberOrString(value: unknown, path: string): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${path} debe ser numero o string.`)
}

function enumCollectionHas<T extends string>(allowed: EnumCollection<T>, value: T): boolean {
  if (allowed instanceof Set) {
    return allowed.has(value)
  }
  return (allowed as readonly T[]).includes(value)
}

function requireEnum<T extends string>(value: unknown, allowed: EnumCollection<T>, path: string): T {
  if (typeof value !== 'string' || !enumCollectionHas(allowed, value as T)) {
    throw new Error(`${path} tiene un valor no soportado.`)
  }
  return value as T
}

function optionalEnum<T extends string>(value: unknown, allowed: EnumCollection<T>, path: string): T | undefined {
  if (value == null) return undefined
  return requireEnum(value, allowed, path)
}

function requireISODate(value: unknown, path: string): string {
  if (typeof value !== 'string' || !isISODate(value)) {
    throw new Error(`${path} debe ser YYYY-MM-DD.`)
  }
  return value
}

function optionalISODate(value: unknown, path: string): string | undefined {
  if (value == null) return undefined
  return requireISODate(value, path)
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value == null) return undefined
  const items = ensureArray(value, path)
  return items.map((item, index) => requireString(item, `${path}[${index}]`))
}

function optionalEnumArray<T extends string>(value: unknown, allowed: EnumCollection<T>, path: string): T[] | undefined {
  if (value == null) return undefined
  const items = ensureArray(value, path)
  return items.map((item, index) => requireEnum(item, allowed, `${path}[${index}]`))
}

function optionalRunningProfile(value: unknown, path: string): AthleteProfile['runningProfile'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    fiveKTime: optionalString(row.fiveKTime, `${path}.fiveKTime`),
    tenKTime: optionalString(row.tenKTime, `${path}.tenKTime`),
    halfMarathonTime: optionalString(row.halfMarathonTime, `${path}.halfMarathonTime`),
    easyPaceMin: optionalString(row.easyPaceMin, `${path}.easyPaceMin`),
    easyPaceMax: optionalString(row.easyPaceMax, `${path}.easyPaceMax`),
    z2PaceMin: optionalString(row.z2PaceMin, `${path}.z2PaceMin`),
    z2PaceMax: optionalString(row.z2PaceMax, `${path}.z2PaceMax`),
    thresholdPace: optionalString(row.thresholdPace, `${path}.thresholdPace`),
    longRunPace: optionalString(row.longRunPace, `${path}.longRunPace`),
    notes: optionalString(row.notes, `${path}.notes`),
  }
}

function optionalStrengthProfile(value: unknown, path: string): AthleteProfile['strengthProfile'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    benchPress1RM: optionalFiniteNumber(row.benchPress1RM, `${path}.benchPress1RM`),
    squat1RM: optionalFiniteNumber(row.squat1RM, `${path}.squat1RM`),
    deadlift1RM: optionalFiniteNumber(row.deadlift1RM, `${path}.deadlift1RM`),
    overheadPress1RM: optionalFiniteNumber(row.overheadPress1RM, `${path}.overheadPress1RM`),
    pullUpMaxReps: optionalFiniteNumber(row.pullUpMaxReps, `${path}.pullUpMaxReps`),
    notes: optionalString(row.notes, `${path}.notes`),
  }
}

function optionalRecoveryProfile(value: unknown, path: string): AthleteProfile['recoveryProfile'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    currentInjuries: optionalString(row.currentInjuries, `${path}.currentInjuries`),
    previousInjuries: optionalString(row.previousInjuries, `${path}.previousInjuries`),
    restrictions: optionalString(row.restrictions, `${path}.restrictions`),
  }
}

function optionalScheduleProfile(value: unknown, path: string): AthleteProfile['scheduleProfile'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    availableDays: optionalStringArray(row.availableDays, `${path}.availableDays`),
    doubleSessionDays: optionalStringArray(row.doubleSessionDays, `${path}.doubleSessionDays`),
    sessionsPerWeek: optionalFiniteNumber(row.sessionsPerWeek, `${path}.sessionsPerWeek`),
    constraints: optionalString(row.constraints, `${path}.constraints`),
  }
}

function optionalSportContext(value: unknown, path: string): AthleteProfile['sportContext'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    enabledSports: optionalEnumArray(row.enabledSports, SUPPORTED_SPORTS, `${path}.enabledSports`) as SupportedSport[] | undefined,
    primarySport: optionalEnum(row.primarySport, SUPPORTED_SPORTS, `${path}.primarySport`) as SupportedSport | undefined,
    secondarySports: optionalEnumArray(row.secondarySports, SUPPORTED_SPORTS, `${path}.secondarySports`) as SupportedSport[] | undefined,
    trainingPriority: optionalEnum(row.trainingPriority, TRAINING_PRIORITIES, `${path}.trainingPriority`) as TrainingPriority | undefined,
  }
}

function optionalNutritionProfile(value: unknown, path: string): AthleteProfile['nutritionProfile'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    fuelingGoal: optionalEnum(row.fuelingGoal, ['performance', 'maintain', 'mild_fat_loss'] as const, `${path}.fuelingGoal`) as AthleteNutritionProfile['fuelingGoal'],
    sweatRate: optionalEnum(row.sweatRate, ['low', 'moderate', 'high'] as const, `${path}.sweatRate`) as AthleteNutritionProfile['sweatRate'],
    goalBodyWeightKg: optionalFiniteNumber(row.goalBodyWeightKg, `${path}.goalBodyWeightKg`),
    fatMassPct: optionalFiniteNumber(row.fatMassPct, `${path}.fatMassPct`),
    fatMassGoalPct: optionalFiniteNumber(row.fatMassGoalPct, `${path}.fatMassGoalPct`),
    muscleMassKg: optionalFiniteNumber(row.muscleMassKg, `${path}.muscleMassKg`),
    muscleMassGoalKg: optionalFiniteNumber(row.muscleMassGoalKg, `${path}.muscleMassGoalKg`),
    proteinTargetG: optionalFiniteNumber(row.proteinTargetG, `${path}.proteinTargetG`),
    dailyWaterLiters: optionalFiniteNumber(row.dailyWaterLiters, `${path}.dailyWaterLiters`),
    notes: optionalString(row.notes, `${path}.notes`),
  }
}

function optionalGoalEvents(value: unknown, path: string): GoalEvent[] | undefined {
  if (value == null) return undefined
  const items = ensureArray(value, path)
  return items.map((item, index) => {
    const row = ensureRecord(item, `${path}[${index}]`)
    return {
      id: requireString(row.id, `${path}[${index}].id`),
      title: requireString(row.title, `${path}[${index}].title`),
      date: requireISODate(row.date, `${path}[${index}].date`),
      sport: requireString(row.sport, `${path}[${index}].sport`),
      priority: (row.priority == null
        ? 'primary'
        : requireEnum(row.priority, GOAL_EVENT_PRIORITIES, `${path}[${index}].priority`)) as GoalEvent['priority'],
      notes: optionalString(row.notes, `${path}[${index}].notes`),
    }
  })
}

function optionalMacroPlanEventMarkers(value: unknown, path: string): MacroPlanEventMarker[] {
  if (value == null) return []
  return ensureArray(value, path).map((item, index) => {
    const row = ensureRecord(item, `${path}[${index}]`)
    return {
      id: requireString(row.id, `${path}[${index}].id`),
      title: requireString(row.title, `${path}[${index}].title`),
      date: requireISODate(row.date, `${path}[${index}].date`),
      sport: optionalEnum(row.sport, SUPPORTED_SPORTS, `${path}[${index}].sport`) as SupportedSport | undefined,
      priority: requireEnum(row.priority, GOAL_EVENT_PRIORITIES, `${path}[${index}].priority`) as GoalEvent['priority'],
      timing: requireEnum(row.timing, MACRO_PLAN_EVENT_TIMINGS, `${path}[${index}].timing`) as MacroPlanEventMarker['timing'],
      weeksFromReference: requireFiniteNumber(row.weeksFromReference, `${path}[${index}].weeksFromReference`),
    }
  })
}

function optionalMacroPlanSportDetails(value: unknown, path: string): MacroPlanSportDetail[] {
  if (value == null) return []
  return ensureArray(value, path).map((item, index) => {
    const row = ensureRecord(item, `${path}[${index}]`)
    return {
      sport: requireEnum(row.sport, SUPPORTED_SPORTS, `${path}[${index}].sport`) as SupportedSport,
      role: requireEnum(row.role, MACRO_PLAN_SPORT_ROLES, `${path}[${index}].role`) as MacroPlanSportDetail['role'],
      phaseFocus: requireString(row.phaseFocus, `${path}[${index}].phaseFocus`),
      weeklyIntent: requireString(row.weeklyIntent, `${path}[${index}].weeklyIntent`),
      volumeBias: requireEnum(row.volumeBias, MACRO_PLAN_LOAD_BIASES, `${path}[${index}].volumeBias`) as MacroPlanSportDetail['volumeBias'],
      intensityBias: requireEnum(row.intensityBias, MACRO_PLAN_LOAD_BIASES, `${path}[${index}].intensityBias`) as MacroPlanSportDetail['intensityBias'],
      notes: requireString(row.notes, `${path}[${index}].notes`),
    }
  })
}

function optionalMacroPlanTimeline(value: unknown, path: string): MacroPlanTimelineEntry[] {
  if (value == null) return []
  return ensureArray(value, path).map((item, index) => {
    const row = ensureRecord(item, `${path}[${index}]`)
    return {
      phase: requireEnum(row.phase, MACRO_PLAN_PHASES, `${path}[${index}].phase`) as MacroPlanPhase,
      startWeek: requireFiniteNumber(row.startWeek, `${path}[${index}].startWeek`),
      endWeek: requireFiniteNumber(row.endWeek, `${path}[${index}].endWeek`),
      label: requireString(row.label, `${path}[${index}].label`),
      focus: requireString(row.focus, `${path}[${index}].focus`),
      isCurrent: requireBoolean(row.isCurrent, `${path}[${index}].isCurrent`),
      eventMarkers: optionalMacroPlanEventMarkers(row.eventMarkers, `${path}[${index}].eventMarkers`),
    }
  })
}

function optionalMacroPlan(value: unknown, path: string): MacroPlan | undefined {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    goalEventId: requireString(row.goalEventId, `${path}.goalEventId`),
    goalEventDate: requireISODate(row.goalEventDate, `${path}.goalEventDate`),
    currentPhase: requireEnum(row.currentPhase, MACRO_PLAN_PHASES, `${path}.currentPhase`) as MacroPlanPhase,
    weeksRemaining: requireFiniteNumber(row.weeksRemaining, `${path}.weeksRemaining`),
    blockFocus: requireString(row.blockFocus, `${path}.blockFocus`),
    headline: optionalString(row.headline, `${path}.headline`) ?? requireString(row.blockFocus, `${path}.blockFocus`),
    timeline: optionalMacroPlanTimeline(row.timeline, `${path}.timeline`),
    sportDetails: optionalMacroPlanSportDetails(row.sportDetails, `${path}.sportDetails`),
    secondaryEvents: optionalMacroPlanEventMarkers(row.secondaryEvents, `${path}.secondaryEvents`),
    computedAt: requireFiniteNumber(row.computedAt, `${path}.computedAt`),
  }
}

function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return !Number.isNaN(time)
}

function normalizeBackupEnvelope(value: unknown): {
  exportedAt: string
  exportedFromAppVersion: string
  tables: Record<string, unknown>
} {
  if (!isRecord(value)) {
    throw new Error('Formato de backup invalido.')
  }

  if (value.app !== BACKUP_APP_NAME) {
    throw new Error('El archivo no corresponde a un backup de Entrenador.')
  }

  if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
    throw new Error('El backup no incluye una version valida.')
  }

  if (value.version < MIN_SUPPORTED_BACKUP_VERSION || value.version > CURRENT_BACKUP_VERSION) {
    throw new Error(`Version de backup no soportada: ${String(value.version)}.`)
  }

  if (!isIsoTimestamp(value.exportedAt)) {
    throw new Error('El backup no incluye fecha de exportacion valida.')
  }

  if (!isRecord(value.tables)) {
    throw new Error('El backup no incluye tablas validas.')
  }

  if (value.version === 1) {
    return migrateBackupV1(value)
  }

  return {
    exportedAt: value.exportedAt,
    exportedFromAppVersion: typeof value.exportedFromAppVersion === 'string' && value.exportedFromAppVersion.trim() !== ''
      ? value.exportedFromAppVersion
      : 'unknown',
    tables: value.tables,
  }
}

function migrateBackupV1(value: Record<string, unknown>): {
  exportedAt: string
  exportedFromAppVersion: string
  tables: Record<string, unknown>
} {
  return {
    exportedAt: value.exportedAt as string,
    exportedFromAppVersion: 'legacy-v1',
    tables: value.tables as Record<string, unknown>,
  }
}

function ensureChatProposalLinks(messages: ChatMessage[], proposals: CoachProposal[]): void {
  const messageIds = new Set(messages.map((message) => message.id))
  const proposalIds = new Set(proposals.map((proposal) => proposal.id))

  for (const message of messages) {
    if (message.proposalId && !proposalIds.has(message.proposalId)) {
      throw new Error(`chatMessages contiene proposalId inexistente: ${message.proposalId}.`)
    }
  }

  for (const proposal of proposals) {
    if (proposal.chatMessageId && !messageIds.has(proposal.chatMessageId)) {
      throw new Error(`coachProposals contiene chatMessageId inexistente: ${proposal.chatMessageId}.`)
    }
  }
}

function pickPreferredChatSessionId(messages: ChatMessage[]): string | null {
  const latestMessage = [...messages]
    .sort((a, b) => b.timestamp - a.timestamp)
    .find((message) => typeof message.chatSessionId === 'string' && message.chatSessionId.length > 0)

  return latestMessage?.chatSessionId ?? null
}

function syncStoresAfterImport(preferredChatSessionId: string | null): void {
  useTrainingStore.setState({
    sessions: [],
    dayLogs: {},
    currentWeekSummary: null,
    allWeekSummaries: [],
    isLoading: false,
    loadedWeekStart: null,
  })

  if (preferredChatSessionId) {
    setStoredChatSessionId(preferredChatSessionId)
  } else {
    clearStoredChatSessionId()
  }

  const nextSessionId = preferredChatSessionId ?? getOrCreateChatSessionId()

  useChatStore.setState({
    messages: [],
    currentSessionId: nextSessionId,
    isLoading: false,
    streamingText: '',
    error: null,
  })

  useCoachActionsStore.setState({ proposals: [] })
  useCoachMemoryStore.setState({ coachMemory: '', athleteProfile: null, isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
  usePlanBuilderStore.setState({
    plan: null,
    weeks: [],
    issues: [],
    status: 'idle',
    currentWeekIndex: null,
    completedWeeks: 0,
    failedWeekIndexes: [],
    streamingTextByWeekIndex: {},
    lastError: null,
  })
}
