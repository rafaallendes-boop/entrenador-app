import type {
  AthleteProfile,
  CoachSessionProposal,
  MacroPlanPhase,
  MacroWeekCoherenceSummary,
  PhaseSportTargetRole,
  Session,
  SupportedSport,
} from '../types'
import { computeMacroPlan, getPrimaryGoalEvent } from './macroPlan'
import { getAllowedPlanningSports, getPlanningPrimarySport, RESTRICTED_PLANNING_SPORTS } from './planningConstraints'

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  cycling: 'ciclismo',
}

type PhaseExpectation = {
  weeklyRule: string
  expectedPrimary: string
  expectedSupport: string
  supportLimit: number
  runningSupportLimit: number
  taperLoadMultiplier?: number
}

const PHASE_EXPECTATIONS: Record<MacroPlanPhase, PhaseExpectation> = {
  base: {
    weeklyRule: 'Construir base general con mezcla equilibrada y sin sobrecargar accesorios.',
    expectedPrimary: '2-3 sesiones',
    expectedSupport: '1-2 sesiones',
    supportLimit: 2,
    runningSupportLimit: 2,
  },
  build: {
    weeklyRule: 'Subir especificidad del deporte principal y mantener el soporte bajo control.',
    expectedPrimary: '3-4 sesiones',
    expectedSupport: '1-2 sesiones',
    supportLimit: 2,
    runningSupportLimit: 1,
  },
  peak: {
    weeklyRule: 'Priorizar máxima especificidad del deporte principal y bajar accesorio innecesario.',
    expectedPrimary: '3-4 sesiones',
    expectedSupport: '0-1 sesiones',
    supportLimit: 1,
    runningSupportLimit: 0,
  },
  taper: {
    weeklyRule: 'Reducir volumen total, mantener calidad y proteger frescura competitiva.',
    expectedPrimary: '1-3 sesiones ligeras/calidad',
    expectedSupport: '0-1 sesiones',
    supportLimit: 1,
    runningSupportLimit: 0,
    taperLoadMultiplier: 0.72,
  },
  race: {
    weeklyRule: 'Semana de evento: activación, frescura y mínima carga accesoria.',
    expectedPrimary: '1-2 activaciones',
    expectedSupport: '0-1 sesiones',
    supportLimit: 1,
    runningSupportLimit: 0,
    taperLoadMultiplier: 0.55,
  },
  transition: {
    weeklyRule: 'Recuperar, bajar estrés y volver a una distribución general liviana.',
    expectedPrimary: '0-2 sesiones suaves',
    expectedSupport: '0-1 sesiones',
    supportLimit: 1,
    runningSupportLimit: 1,
  },
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
): Partial<Record<SupportedSport, PhaseSportTargetRole>> {
  const target: Partial<Record<SupportedSport, PhaseSportTargetRole>> = {}

  for (const sport of RESTRICTED_PLANNING_SPORTS) {
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
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>,
  phase: MacroPlanPhase,
): Partial<Record<SupportedSport, string>> {
  const expectation = PHASE_EXPECTATIONS[phase]
  const expected: Partial<Record<SupportedSport, string>> = {}

  for (const sport of RESTRICTED_PLANNING_SPORTS) {
    const role = targetDistributionBySport[sport]
    if (role === 'primary') expected[sport] = expectation.expectedPrimary
    if (role === 'support') expected[sport] = expectation.expectedSupport
    if (role === 'excluded') expected[sport] = '0 sesiones'
  }

  return expected
}

function buildCoherenceIssues(args: {
  phase: MacroPlanPhase
  blockGoal: string
  primarySport: SupportedSport | undefined
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>
  actualDistributionBySport: Partial<Record<SupportedSport, number>>
  totalLoad: number
  historicalSessions: Session[]
}): string[] {
  const {
    phase,
    blockGoal,
    primarySport,
    targetDistributionBySport,
    actualDistributionBySport,
    totalLoad,
    historicalSessions,
  } = args
  const issues: string[] = []
  const expectation = PHASE_EXPECTATIONS[phase]
  const primaryCount = primarySport ? (actualDistributionBySport[primarySport] ?? 0) : 0
  const supportCount = Object.entries(targetDistributionBySport).reduce((total, [sport, role]) => {
    if (role !== 'support') return total
    return total + (actualDistributionBySport[sport as SupportedSport] ?? 0)
  }, 0)
  const runningCount = actualDistributionBySport.running ?? 0

  for (const sport of RESTRICTED_PLANNING_SPORTS) {
    if (targetDistributionBySport[sport] === 'excluded' && (actualDistributionBySport[sport] ?? 0) > 0) {
      issues.push(`La semana incluye ${SPORT_LABELS[sport]} aunque la fase actual lo marca como excluido.`)
    }
  }

  if (primarySport && primaryCount === 0) {
    issues.push(`La semana no incluye trabajo del deporte principal (${SPORT_LABELS[primarySport]}).`)
  }

  if ((phase === 'build' || phase === 'peak') && primarySport && primaryCount > 0 && primaryCount <= supportCount) {
    issues.push(`La distribución del plan prioriza demasiado trabajo accesorio para una fase ${phase}.`)
  }

  if (phase === 'peak' && primarySport && primaryCount < 2) {
    issues.push(`La carga específica de ${SPORT_LABELS[primarySport]} es baja para una fase peak.`)
  }

  if ((phase === 'peak' || phase === 'taper' || phase === 'race') && supportCount > expectation.supportLimit) {
    issues.push(`La semana generada no parece consistente con la fase ${phase}: hay demasiado trabajo accesorio.`)
  }

  if ((phase === 'build' || phase === 'peak' || phase === 'taper' || phase === 'race') && runningCount > expectation.runningSupportLimit) {
    issues.push(`La regla de la fase actual pide mantener running bajo, pero el plan propone ${runningCount} sesión(es).`)
  }

  if (expectation.taperLoadMultiplier != null && historicalSessions.length > 0) {
    const recentHistorical = historicalSessions
      .filter((session) => getSessionSport(session))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6)
    const historicalAverageLoad = recentHistorical.length > 0
      ? estimateTotalLoad(recentHistorical) / recentHistorical.length
      : 0
    const proposedAverageLoad = Object.values(actualDistributionBySport).reduce((sum, count) => sum + (count ?? 0), 0) > 0
      ? totalLoad / Math.max(1, Object.values(actualDistributionBySport).reduce((sum, count) => sum + (count ?? 0), 0))
      : 0

    if (historicalAverageLoad > 0 && proposedAverageLoad > historicalAverageLoad * (1 + expectation.taperLoadMultiplier)) {
      issues.push(`La semana generada no parece consistente con la fase ${phase}: la carga total sigue demasiado alta.`)
    }
  }

  if (phase === 'base' && primarySport && primaryCount === 1 && supportCount >= 3) {
    issues.push(`La base está demasiado cargada hacia accesorios y deja corto el trabajo principal de ${SPORT_LABELS[primarySport]}.`)
  }

  if (blockGoal.toLowerCase().includes('frescura') && totalLoad > 1200) {
    issues.push('La semana acumula demasiada carga para un bloque que debería priorizar frescura.')
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
  const phase = macroPlan?.currentPhase ?? 'base'
  const blockGoal = macroPlan?.blockFocus ?? PHASE_EXPECTATIONS.base.weeklyRule
  const primarySport = getPlanningPrimarySport(athleteProfile)
  const allowedSports = getAllowedPlanningSports(athleteProfile)
  const targetDistributionBySport = buildTargetDistributionBySport(primarySport, allowedSports)
  const actualDistributionBySport = countSessionsBySport(sessions)
  const expectedSessionsBySport = buildExpectedSessionsBySport(targetDistributionBySport, phase)
  const issues = buildCoherenceIssues({
    phase,
    blockGoal,
    primarySport,
    targetDistributionBySport,
    actualDistributionBySport,
    totalLoad: estimateTotalLoad(sessions),
    historicalSessions,
  })

  return {
    currentPhase: phase,
    blockGoal,
    weeklyRule: buildWeeklyRule({
      phase,
      primarySport,
      targetDistributionBySport,
      athleteProfile,
    }),
    targetDistributionBySport,
    actualDistributionBySport,
    expectedSessionsBySport,
    coherenceStatus: issues.length > 0 ? 'warning' : 'ok',
    coherenceIssues: issues,
  }
}

function buildWeeklyRule(args: {
  phase: MacroPlanPhase
  primarySport: SupportedSport | undefined
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>
  athleteProfile: AthleteProfile | null | undefined
}): string {
  const { phase, primarySport, targetDistributionBySport, athleteProfile } = args
  const expectation = PHASE_EXPECTATIONS[phase]
  const primaryLabel = primarySport ? SPORT_LABELS[primarySport] : 'el deporte principal'
  const lowRunning = targetDistributionBySport.running === 'excluded' || phase === 'peak' || phase === 'taper' || phase === 'race'
  const strengthRole = targetDistributionBySport.strength

  if (phase === 'build') {
    if (strengthRole === 'support' && lowRunning) {
      return `Subir volumen específico de ${primaryLabel}, mantener fuerza y no cargar running.`
    }
    return `Subir volumen específico de ${primaryLabel} y sostener los complementos permitidos.`
  }

  if (phase === 'peak') {
    return `Priorizar calidad específica de ${primaryLabel} y recortar accesorio innecesario.`
  }

  if (phase === 'taper' || phase === 'race') {
    return `Mantener chispa en ${primaryLabel}, bajar volumen y proteger frescura.`
  }

  if (phase === 'transition') {
    return 'Bajar estrés, recuperar y volver a una semana liviana.'
  }

  const eventSport = getPrimaryGoalEvent(athleteProfile)?.sport
  if (eventSport && primarySport) {
    return `Construir base amplia para ${primaryLabel} con soporte general bien dosificado.`
  }

  return expectation.weeklyRule
}
