import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearWeeklyActionLaunchSearch,
  parseWeeklyActionLaunchIntent,
  type WeeklyActionLaunchIntent,
} from '../services/weeklyLaunchIntent'

interface WeeklyLaunchLocationState {
  weeklyLaunchIntent?: WeeklyActionLaunchIntent
  weeklyLaunchId?: number
}

export interface WeeklyLaunchIntentState {
  launchIntent: WeeklyActionLaunchIntent | null
  launchId: number
}

export function useWeeklyLaunchIntent(): WeeklyLaunchIntentState {
  const location = useLocation()
  const navigate = useNavigate()
  const locationState = (location.state as WeeklyLaunchLocationState | null) ?? null
  const parsedLaunchIntent = useMemo(
    () => parseWeeklyActionLaunchIntent(location.search),
    [location.search],
  )
  const launchIntent = parsedLaunchIntent ?? locationState?.weeklyLaunchIntent ?? null
  const launchId = parsedLaunchIntent ? 0 : (locationState?.weeklyLaunchId ?? 0)

  useEffect(() => {
    if (!parsedLaunchIntent) return
    const nextSearch = clearWeeklyActionLaunchSearch(location.search)
    navigate(
      { pathname: location.pathname, search: nextSearch },
      {
        replace: true,
        state: {
          ...(locationState ?? {}),
          weeklyLaunchIntent: parsedLaunchIntent,
          weeklyLaunchId: Date.now(),
        },
      },
    )
  }, [location.pathname, location.search, locationState, navigate, parsedLaunchIntent])

  return { launchIntent, launchId }
}
