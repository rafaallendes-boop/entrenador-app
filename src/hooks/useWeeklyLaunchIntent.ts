import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearWeeklyActionLaunchSearch,
  parseWeeklyActionLaunchIntent,
  serializeWeeklyActionLaunchIntent,
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

function buildStableLaunchId(sourceKey: string): number {
  let hash = 0
  for (let i = 0; i < sourceKey.length; i += 1) {
    hash = (hash * 31 + sourceKey.charCodeAt(i)) >>> 0
  }
  return hash
}

export function useWeeklyLaunchIntent(): WeeklyLaunchIntentState {
  const location = useLocation()
  const navigate = useNavigate()
  const locationState = (location.state as WeeklyLaunchLocationState | null) ?? null
  const parsedLaunchIntent = useMemo(
    () => parseWeeklyActionLaunchIntent(location.search),
    [location.search],
  )
  const parsedLaunchSourceKey = parsedLaunchIntent
    ? `${location.key}:${serializeWeeklyActionLaunchIntent(parsedLaunchIntent)}`
    : null
  const parsedLaunchId = parsedLaunchSourceKey ? buildStableLaunchId(parsedLaunchSourceKey) : 0
  const launchIntent = parsedLaunchIntent ?? locationState?.weeklyLaunchIntent ?? null
  const launchId = parsedLaunchIntent
    ? parsedLaunchId
    : (locationState?.weeklyLaunchId ?? 0)

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
          weeklyLaunchId: parsedLaunchId,
        },
      },
    )
  }, [location.pathname, location.search, locationState, navigate, parsedLaunchId, parsedLaunchIntent])

  return { launchIntent, launchId }
}
