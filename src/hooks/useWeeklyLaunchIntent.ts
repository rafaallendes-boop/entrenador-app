import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearWeeklyActionLaunchSearch,
  parseWeeklyActionLaunchIntent,
  type WeeklyActionLaunchIntent,
} from '../services/weeklyLaunchIntent'

export interface WeeklyLaunchIntentState {
  launchIntent: WeeklyActionLaunchIntent | null
  launchId: number
}

export function useWeeklyLaunchIntent(): WeeklyLaunchIntentState {
  const location = useLocation()
  const navigate = useNavigate()
  const parsedLaunchIntent = useMemo(
    () => parseWeeklyActionLaunchIntent(location.search),
    [location.search],
  )

  useEffect(() => {
    if (!parsedLaunchIntent) return
    const nextSearch = clearWeeklyActionLaunchSearch(location.search)
    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true })
  }, [location.pathname, location.search, navigate, parsedLaunchIntent])

  const launchId = useMemo(() => {
    if (!parsedLaunchIntent) return 0

    const seed = `${location.key}:${location.pathname}:${location.search}`
    let hash = 0
    for (const char of seed) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    }
    return hash
  }, [location.key, location.pathname, location.search, parsedLaunchIntent])

  return { launchIntent: parsedLaunchIntent, launchId }
}
