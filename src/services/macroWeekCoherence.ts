import type {
  AthleteProfile,
  CoachSessionProposal,
  MacroPlanPhase,
  MacroPlanSportDetail,
  MacroWeekCoherenceSummary,
  PhaseSportTargetRole,
  Session,
  SupportedSport,
} from '../types'
import { computeMacroPlan } from './macroPlan'
import { getAllowedPlanningSports, getPlanningPrimarySport, RESTRICTED_PLANNING_SPORTS } from './planningConstraints'

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  cycling: 'ciclismo',
}

type PhaseExpectation = {
  supportLimit: number
  runningSupportLimit: number
  taperLoadMultiplier?: number
}

const PHASE_EXPECTATIONS: Record<MacroPlanPhase, PhaseExpectation> = {
  base: { supportLimit: 2, runningSupportLimit: 2 },
  build: { supportLimit: 2, runningSupportLimit: 1 },
  peak: { supportLimit: 1, runningSupportLimit: 0 },
  taper: { supportLimit: 1, runningSupportLimit: 0, taperLoadMultiplier: 0.72 },
  race: { supportLimit: 1, runningSupportLimit: 0, taperLoadMultiplier: 0.55 },
  transition: { supportLimit: 1, runningSupportLimit: 1 },
}

function getSessionSport(session: Pick<CoachSessionProposal, 'sessionType'> | Pick<Session, 'type'>): SupportedSport | undefined {
  const raw = 'sessionType' in session ? session.sessionType : session.type
  return RESTRICTED_PLANNING_SPORTS.includes(raw as SupportedSport) ? (raw as SupportedSport) : undefined
}

function countSessionsBySport(
  sessions: Array<Pick<CoachSessionProposal, 'sessionType'> | Pick<Session, 'type'>>,
): Partial<Record<SupportedSport, number>> {
  const counts: Partial<Record<SupportedSport, number>> = {}
  for (const sport of RESTRICTED_PLANNING_SPORTS) counts[sport] = 0
  for (const session of sessions) {
    const sport = getSessionSport(session)
    if (!sport) continue
    counts[sport] = (counts[sport] ?? 0) + 1
  }
  return counts
}

function estimateTotalLoad(
  sessions: Array<Pick<CoachSessionProposal, 'sessionType' | 'durationMin' | 'rpe'> | Pick<Session, 'type' | 'durationMin' | 'rpe'>>,
): number {
  return sessions.reduce((total, session) => {
    const sport = getSessionSport(session)
    if (!sport) return total
    const rpe = session.rpe ?? (sport === 'strength' ? 6 : 5)
    return total + session.durationMin * rpe
  }, 0)
}

function buildTargetDistributionBySport(
  primarySport: SupportedSport | undefined,
  allowedSports: SupportedSport[],
  sportDetails: MacroPlanSportDetail[],
): Partial<Record<SupportedSport, PhaseSportTargetRole>> {
  const target: Partial<Record<SupportedSport, PhaseSportTargetRole>> = {}
  const bySport = new Map(sportDetails.map((detail) => [detail.sport, detail] as const))

  for (const sport of RESTRICTED_PLANNING_SPORTS) {
    const detail = bySport.get(sport)
    if (detail) {
      target[sport] = detail.role
      continue
    }

    if (primarySport && sport === primarySport) {
      target[sport] = 'primary'
    } else if (allowedSports.includes(sport)) {
      target[sport] = 'support'
    } else {
      target[sport] = 'excluded'
    }
  }

  return target
}

function buildExpectedSessionsBySport(
  phase: MacroPlanPhase,
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>,
  sportDetails: MacroPlanSportDetail[],
): Partial<Record<SupportedSport, string>> {
  const detailMap = new Map(sportDetails.map((detail) => [detail.sport, detail] as const))
  const expected: Partial<Record<SupportedSport, string>> = {}

  for (const sport of RESTRICTED_PLANNING_SPORTS) {
    const role = targetDistributionBySport[sport]
    if (!role) continue
    if (role === 'excluded') {
      expected[sport] = '0 sesiones'
      continue
    }

    expected[sport] = describeExpectedSessions({
      sport,
      role,
      phase,
      detail: detailMap.get(sport),
    })
  }

  return expected
}

function describeExpectedSessions(args: {
  sport: SupportedSport
  role: Exclude<PhaseSportTargetRole, 'excluded'>
  phase: MacroPlanPhase
  detail?: MacroPlanSportDetail
}): string {
  const { sport, role, phase, detail } = args

  if (role === 'support') {
    if (sport === 'running' && (phase === 'peak' || phase === 'taper' || phase === 'race')) return '0 sesiones o Z2 muy corta'
    if (phase === 'base' || phase === 'build') return '1-2 sesiones'
    return '0-1 sesiones'
  }

  if (sport === 'running') {
    switch (phase) {
      case 'base':
        return '3-4 sesiones'
      case 'build':
        return '3-5 sesiones'
      case 'peak':
        return '2-4 sesiones'
      case 'taper':
        return '2-3 sesiones ligeras/calidad'
      case 'race':
        return '1-2 activaciones'
      case 'transition':
        return '0-2 sesiones suaves'
    }
  }

  if (sport === 'strength') {
    switch (phase) {
      case 'base':
        return '2-4 sesiones'
      case 'build':
        return '2-3 sesiones'
      case 'peak':
        return '2-3 sesiones'
      case 'taper':
        return '1-2 sesiones'
      case 'race':
        return '1-2 activaciones'
      case 'transition':
        return '1-2 sesiones suaves'
    }
  }

  if (sport === 'squash') {
    switch (phase) {
      case 'base':
        return '2-3 sesiones'
      case 'build':
        return '3-4 sesiones'
      case 'peak':
        return '3-4 sesiones'
      case 'taper':
        return '1-3 sesiones ligeras/calidad'
      case 'race':
        return '1-2 activaciones'
      case 'transition':
        return '0-2 sesiones suaves'
    }
  }

  if (detail?.volumeBias === 'build') return '2-3 sesiones'
  if (detail?.volumeBias === 'hold') return '1-2 sesiones'
  if (detail?.volumeBias === 'reduce') return '0-1 sesiones'
  return '0-1 sesiones'
}

function buildCoherenceIssues(args: {
  phase: MacroPlanPhase
  blockGoal: string
  primarySport: SupportedSport | undefined
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>
  actualDistributionBySport: Partial<Record<SupportedSport, number>>
  totalLoad: number
  historicalSessions: Session[]
  sportDetails: MacroPlanSportDetail[]
}): string[] {
  const {
    phase,
    blockGoal,
    primarySport,
    targetDistributionBySport,
    actualDistributionBySport,
    totalLoad,
    historicalSessions,
    sportDetails,
  } = args
  const issues: string[] = []
  const expectation = PHASE_EXPECTATIONS[phase]
  const primaryCount = primarySport ? (actualDistributionBySport[primarySport] ?? 0) : 0
  const supportCount = Object.entries(targetDistributionBySport).reduce((total, [sport, role]) => {
    if (role !== 'support') return total
    return total + (actualDistributionBySport[sport as SupportedSport] ?? 0)
  }, 0)
  const runningCount = actualDistributionBySport.running ?? 0
  const strengthCount = actualDistributionBySport.strength ?? 0
  const detailMap = new Map(sportDetails.map((detail) => [detail.sport, detail] as const))

  for (const sport of RESTRICTED_PLANNING_SPORTS) {
    if (targetDistributionBySport[sport] === 'excluded' && (actualDistributionBySport[sport] ?? 0) > 0) {
      issues.push(`La semana incluye ${SPORT_LABELS[sport]} aunque este bloque lo marca como excluido.`)
    }
  }

  if (primarySport && primaryCount === 0) {
    issues.push(`La semana no incluye trabajo del deporte principal (${SPORT_LABELS[primarySport]}).`)
  }

  if ((phase === 'build' || phase === 'peak') && primarySport && primaryCount > 0 && primaryCount <= supportCount) {
    issues.push(`La distribucion de la semana deja demasiado protagonismo al trabajo accesorio para una fase ${phase}.`)
  }

  if (phase === 'peak' && primarySport === 'squash' && primaryCount < 2) {
    issues.push('La carga especifica de squash es baja para una fase peak orientada a sharpness y match pressure.')
  }

  if (phase === 'peak' && primarySport === 'running' && primaryCount < 2) {
    issues.push('La carga especifica de running es baja para una fase peak con foco en calidad controlada.')
  }

  if ((phase === 'peak' || phase === 'taper' || phase === 'race') && supportCount > expectation.supportLimit) {
    issues.push(`La semana no parece consistente con la fase ${phase}: hay demasiado trabajo accesorio.`)
  }

  if ((phase === 'build' || phase === 'peak' || phase === 'taper' || phase === 'race') && targetDistributionBySport.running === 'support' && runningCount > expectation.runningSupportLimit) {
    issues.push(`running aparece demasiado cargado como soporte para una fase ${phase}.`)
  }

  if ((phase === 'peak' || phase === 'race') && primarySport !== 'strength' && strengthCount >= Math.max(1, primaryCount)) {
    issues.push('La fuerza de soporte domina demasiado la semana para este momento del bloque.')
  }

  if (expectation.taperLoadMultiplier != null && historicalSessions.length > 0) {
    const recentHistorical = historicalSessions
      .filter((session) => getSessionSport(session))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6)
    const historicalAverageLoad = recentHistorical.length > 0
      ? estimateTotalLoad(recentHistorical) / recentHistorical.length
      : 0
    const plannedSessionsCount = Object.values(actualDistributionBySport).reduce((sum, count) => sum + (count ?? 0), 0)
    const proposedAverageLoad = plannedSessionsCount > 0 ? totalLoad / plannedSessionsCount : 0

    if (historicalAverageLoad > 0 && proposedAverageLoad > historicalAverageLoad * expectation.taperLoadMultiplier) {
      issues.push(`La semana sigue demasiado cargada para una fase ${phase} que deberia priorizar frescura.`)
    }
  }

  if (phase === 'base' && primarySport && primaryCount === 1 && supportCount >= 3) {
    issues.push(`La base queda demasiado inclinada hacia accesorios y deja corto el trabajo principal de ${SPORT_LABELS[primarySport]}.`)
  }

  if (blockGoal.toLowerCase().includes('fresco') && totalLoad > 1200) {
    issues.push('La semana acumula demasiada carga para un bloque que deberia priorizar frescura.')
  }

  const primaryDetail = primarySport ? detailMap.get(primarySport) : undefined
  if (primaryDetail?.volumeBias === 'minimal' && totalLoad > 900) {
    issues.push(`La semana no refleja un bloque donde ${SPORT_LABELS[primarySport!]} deberia estar con carga minima.`)
  }

  return issues
}

export function buildMacroWeekCoherenceSummary(args: {
  athleteProfile: AthleteProfile | null | undefined
  sessions: Array<
    Pick<CoachSessionProposal, 'sessionType' | 'durationMin' | 'rpe'> |
    Pick<Session, 'type' | 'durationMin' | 'rpe' | 'date'>
  >
  historicalSessions?: Session[]
  referenceDate?: Date
}): MacroWeekCoherenceSummary {
  const { athleteProfile, sessions, historicalSessions = [], referenceDate } = args
  const macroPlan = computeMacroPlan(athleteProfile, referenceDate)
  // Sin evento objetivo primario no hay macroplan, y sin macroplan no hay bloque
  // contra el cual medir coherencia. Cada issue afirma algo *sobre un bloque*
  // ("este bloque lo marca como excluido"), así que ninguno puede ser verdadero.
  const hasMacroPlan = macroPlan != null
  const phase = macroPlan?.currentPhase ?? 'base'
  const blockGoal = macroPlan?.headline ?? macroPlan?.blockFocus ?? 'Construir base general.'
  const primarySport = getPlanningPrimarySport(athleteProfile)
  const allowedSports = getAllowedPlanningSports(athleteProfile)
  const sportDetails = macroPlan?.sportDetails ?? []
  const targetDistributionBySport = buildTargetDistributionBySport(primarySport, allowedSports, sportDetails)
  const actualDistributionBySport = countSessionsBySport(sessions)
  const expectedSessionsBySport = buildExpectedSessionsBySport(phase, targetDistributionBySport, sportDetails)
  const issues = hasMacroPlan
    ? buildCoherenceIssues({
      phase,
      blockGoal,
      primarySport,
      targetDistributionBySport,
      actualDistributionBySport,
      totalLoad: estimateTotalLoad(sessions),
      historicalSessions,
      sportDetails,
    })
    : []

  return {
    currentPhase: phase,
    blockGoal,
    weeklyRule: buildWeeklyRule({
      phase,
      primarySport,
      sportDetails,
      targetDistributionBySport,
    }),
    targetDistributionBySport,
    actualDistributionBySport,
    expectedSessionsBySport,
    coherenceStatus: hasMacroPlan
      ? (issues.length > 0 ? 'warning' : 'ok')
      : 'not_applicable',
    coherenceIssues: issues,
  }
}

function buildWeeklyRule(args: {
  phase: MacroPlanPhase
  primarySport: SupportedSport | undefined
  sportDetails: MacroPlanSportDetail[]
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>
}): string {
  const { phase, primarySport, sportDetails, targetDistributionBySport } = args
  const primaryDetail = primarySport
    ? sportDetails.find((detail) => detail.sport === primarySport)
    : undefined

  if (primaryDetail) {
    const supportLabels = sportDetails
      .filter((detail) => detail.role === 'support' && targetDistributionBySport[detail.sport] === 'support')
      .map((detail) => formatSupportIntent(detail))
    const primaryLabel = primarySport ? SPORT_LABELS[primarySport] : 'deporte principal'

    if (supportLabels.length > 0) {
      return `${primaryLabel}: ${primaryDetail.weeklyIntent} Soporte: ${supportLabels.join(' ')}`
    }

    return `${primaryLabel}: ${primaryDetail.weeklyIntent}`
  }

  if (phase === 'transition') return 'Bajar estres, recuperar y volver a una semana liviana.'
  if (phase === 'taper' || phase === 'race') return 'Mantener chispa del deporte principal, bajar volumen y proteger frescura.'
  if (phase === 'peak') return 'Priorizar calidad especifica del deporte principal y recortar accesorio innecesario.'
  if (phase === 'build') return 'Subir especificidad del deporte principal y sostener solo complementos utiles.'
  return 'Construir base amplia para el deporte principal con soporte general bien dosificado.'
}

function formatSupportIntent(detail: MacroPlanSportDetail): string {
  return `${SPORT_LABELS[detail.sport]} ${detail.volumeBias === 'minimal' ? 'muy bajo' : detail.volumeBias === 'reduce' ? 'controlado' : 'de apoyo'}.`
}
