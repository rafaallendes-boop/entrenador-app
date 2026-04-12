import { ROUTES } from '../constants/routes'
import { currentWeekStartISO, todayISO } from '../utils/date'
import type { WeeklyActionTarget } from '../types'

export type WeeklyActionLaunchIntentKind = WeeklyActionTarget | 'open_auto_adjustment'

export interface WeeklyActionLaunchIntent {
  intent: WeeklyActionLaunchIntentKind
  date?: string
  alertId?: string
  source?: string
  weeklyRule?: string
}

const LAUNCH_INTENT_PARAM = 'weeklyIntent'
const LAUNCH_DATE_PARAM = 'weeklyDate'
const LAUNCH_ALERT_ID_PARAM = 'weeklyAlertId'
const LAUNCH_SOURCE_PARAM = 'weeklySource'
const LAUNCH_RULE_PARAM = 'weeklyRule'

export function buildWeeklyActionLaunchUrl(intent: WeeklyActionLaunchIntent): string {
  const path = resolveWeeklyActionLaunchPath(intent)
  const search = buildWeeklyActionLaunchSearch(intent).toString()
  return search.length > 0 ? `${path}?${search}` : path
}

export function buildWeeklyActionLaunchSearch(intent: WeeklyActionLaunchIntent): URLSearchParams {
  const params = new URLSearchParams()
  params.set(LAUNCH_INTENT_PARAM, intent.intent)
  if (intent.date) params.set(LAUNCH_DATE_PARAM, intent.date)
  if (intent.alertId) params.set(LAUNCH_ALERT_ID_PARAM, intent.alertId)
  if (intent.source) params.set(LAUNCH_SOURCE_PARAM, intent.source)
  if (intent.weeklyRule) params.set(LAUNCH_RULE_PARAM, intent.weeklyRule)
  return params
}

export function parseWeeklyActionLaunchIntent(search: string | URLSearchParams): WeeklyActionLaunchIntent | null {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search)
  const intent = params.get(LAUNCH_INTENT_PARAM)
  if (!intent) return null
  if (!isWeeklyActionLaunchIntentKind(intent)) return null

  const parsed: WeeklyActionLaunchIntent = { intent }
  const date = params.get(LAUNCH_DATE_PARAM)
  const alertId = params.get(LAUNCH_ALERT_ID_PARAM)
  const source = params.get(LAUNCH_SOURCE_PARAM)
  const weeklyRule = params.get(LAUNCH_RULE_PARAM)

  if (date) parsed.date = date
  if (alertId) parsed.alertId = alertId
  if (source) parsed.source = source
  if (weeklyRule) parsed.weeklyRule = weeklyRule
  return parsed
}

export function serializeWeeklyActionLaunchIntent(intent: WeeklyActionLaunchIntent): string {
  return JSON.stringify([
    intent.intent,
    intent.date ?? '',
    intent.alertId ?? '',
    intent.source ?? '',
    intent.weeklyRule ?? '',
  ])
}

export function buildWeeklyActionComposerDraft(
  intent: Pick<WeeklyActionLaunchIntent, 'intent' | 'weeklyRule'> | null | undefined,
): string {
  if (!intent) return ''

  if (intent.intent === 'chat_adjust_week' || intent.intent === 'open_auto_adjustment') {
    return intent.weeklyRule?.trim()
      ? `Ajusta mi semana para respetar esta regla del bloque: ${intent.weeklyRule.trim()}`
      : 'Ajusta mi semana para que sea coherente con el bloque actual.'
  }

  return ''
}

export function clearWeeklyActionLaunchSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(LAUNCH_INTENT_PARAM)
  params.delete(LAUNCH_DATE_PARAM)
  params.delete(LAUNCH_ALERT_ID_PARAM)
  params.delete(LAUNCH_SOURCE_PARAM)
  params.delete(LAUNCH_RULE_PARAM)
  const next = params.toString()
  return next.length > 0 ? `?${next}` : ''
}

export function resolveWeeklyActionLaunchPath(intent: WeeklyActionLaunchIntent): string {
  switch (intent.intent) {
    case 'plan_builder':
      return ROUTES.PLAN_BUILDER
    case 'generate_coach_note':
    case 'today_checkin':
    case 'open_auto_adjustment':
      return ROUTES.WEEK
    case 'chat_adjust_week':
      return ROUTES.CHAT
    case 'today_detail':
      return ROUTES.DAY(intent.date ?? todayISO())
    default:
      return ROUTES.WEEK
  }
}

export function resolveWeeklyActionLaunchWeekStart(intent: WeeklyActionLaunchIntent): string {
  const date = intent.date ?? todayISO()
  return intent.intent === 'today_detail' ? date : currentWeekStartISO()
}

function isWeeklyActionLaunchIntentKind(value: string): value is WeeklyActionLaunchIntentKind {
  return value === 'plan_builder'
    || value === 'chat_adjust_week'
    || value === 'today_checkin'
    || value === 'today_detail'
    || value === 'generate_coach_note'
    || value === 'open_auto_adjustment'
}
