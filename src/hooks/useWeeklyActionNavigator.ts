import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../constants/routes'
import { todayISO } from '../utils/date'
import type { WeeklyActionItem } from '../types'
import { buildWeeklyActionComposerDraft } from '../services/weeklyLaunchIntent'

export interface WeeklyActionNavigatorOverrides {
  /** Called when ctaTarget === 'generate_coach_note'. Defaults to navigate(ROUTES.WEEK). */
  onGenerateCoachNote?: () => void
  /** Called when ctaTarget === 'today_checkin' or falls through. Defaults to scroll-to-top. */
  onCheckIn?: () => void
  /** Weekly rule string for the fix_coherence composerDraft. */
  weeklyRule?: string
}

/**
 * Typed navigator for weekly action CTA items.
 * Centralises the dispatch logic that was duplicated in Dashboard and WeeklyView.
 */
export function useWeeklyActionNavigator(overrides: WeeklyActionNavigatorOverrides = {}) {
  const navigate = useNavigate()
  const today = todayISO()

  return function handleWeeklyAction(action: WeeklyActionItem): void {
    switch (action.ctaTarget) {
      case 'plan_builder':
        navigate(ROUTES.PLAN_BUILDER)
        return

      case 'chat_adjust_week': {
        const composerDraft = action.kind === 'fix_coherence'
          ? buildWeeklyActionComposerDraft({ intent: 'chat_adjust_week', weeklyRule: overrides.weeklyRule })
          : action.kind === 'recover_adherence'
            ? 'Revisa mi adherencia semanal y propon un ajuste concreto para que la semana sea mas realista.'
            : 'Simplifica o ajusta mi semana segun la carga y la fatiga de estos dias.'
        navigate(ROUTES.CHAT, { state: { composerDraft } })
        return
      }

      case 'generate_coach_note':
        if (overrides.onGenerateCoachNote) {
          overrides.onGenerateCoachNote()
        } else {
          navigate(ROUTES.WEEK)
        }
        return

      case 'today_detail':
        navigate(ROUTES.DAY(today))
        return

      case 'today_checkin':
      default:
        if (overrides.onCheckIn) {
          overrides.onCheckIn()
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
    }
  }
}
