import { Navigate, useLocation } from 'react-router-dom'
import { ROUTES } from '../constants/routes'

export default function PlanBuilderPage() {
  const location = useLocation()

  return (
    <Navigate
      replace
      to={{
        pathname: ROUTES.PLAN_BUILDER_V2,
        search: location.search,
      }}
      state={{
        ...(location.state ?? {}),
        redirectedFromLegacyPlanBuilder: true,
      }}
    />
  )
}
