import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearWeeklyActionLaunchSearch,
  parseWeeklyActionLaunchIntent,
  serializeWeeklyActionLaunchIntent,
  type WeeklyActionLaunchIntent,
} from '../services/weeklyLaunchIntent'

export interface WeeklyLaunchIntentState {
  launchIntent: WeeklyActionLaunchIntent | null
  launchId: number
}

export function useWeeklyLaunchIntent(): WeeklyLaunchIntentState {
  const location = useLocation()
  const navigate = useNavigate()
  const [launchIntent, setLaunchIntent] = useState<WeeklyActionLaunchIntent | null>(null)
  const [launchId, setLaunchId] = useState(0)
  const lastHandledKey = useRef<string | null>(null)

  useEffect(() => {
    const parsed = parseWeeklyActionLaunchIntent(location.search)
    if (!parsed) {
      lastHandledKey.current = null
      return
    }

    const key = serializeWeeklyActionLaunchIntent(parsed)
    if (lastHandledKey.current === key) return

    lastHandledKey.current = key
    setLaunchIntent(parsed)
    setLaunchId((value) => value + 1)
    const nextSearch = clearWeeklyActionLaunchSearch(location.search)
    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true })
  }, [location.pathname, location.search, navigate])

  return { launchIntent, launchId }
}
