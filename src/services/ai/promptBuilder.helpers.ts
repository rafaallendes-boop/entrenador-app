import type { ChatContext, Session, SupportedSport } from '../../types'
import { currentWeekStartISO, todayISO } from '../../utils/date'
import { getPrimarySportNormalized } from '../../utils/athlete'
import {
  getPlanningPrimarySport,
  getAllowedPlanningSports,
} from '../planningConstraints'
import { summarizeSquashProgression, selectSquashDrills } from '../training/drillSelector'
import { selectStrengthSession, summarizeStrengthProgression } from '../training/strengthSelector'
import {
  SESSION_TYPE_ES,
  getDayName,
  buildWeekDatesList,
  deriveIntervalPace,
  addSecsToPace,
  formatSelectedSquashDrills,
  formatSelectedStrengthExercises,
  buildCyclingSelectionSummary,
  buildMobilitySelectionSummary,
  type SquashSelectionSummary,
  type StrengthSelectionSummary,
} from './promptModules'

const SPORT_ES: Record<string, string> = {
  squash: 'Squash',
  running: 'Running',
  cycling: 'Ciclismo',
  strength: 'Fuerza',
  mobility: 'Movilidad',
}

const TREND_ES: Record<string, string> = {
  increasing: 'subiendo',
  stable: 'estable',
  decreasing: 'bajando',
}

export interface ResponsePromptContext {
  today: string
  weekStart: string
  weekDates: string
  primary?: SupportedSport
  primarySportLabel: string
  sportPriority: string
  playsSquash: boolean
  hasRunning: boolean
  hasStrength: boolean
  hasCycling: boolean
  hasMobility: boolean
  plannedSessionLines: string
  z2min: string
  z2max: string
  tempoMin: string
  tempoMax: string
  longRunPaceStr: string
  intervalPaceStr: string
  w: {
    bench75: number
    bench85: number
    row75: number
    ohp75: number
    squat75: number
    squat85: number
    deadlift75: number
  }
  hipThrust85: number
  lunge45: number
  squashSummary: SquashSelectionSummary
  strengthSummary: StrengthSelectionSummary
  cyclingSummary: ReturnType<typeof buildCyclingSelectionSummary>
  mobilitySummary: ReturnType<typeof buildMobilitySelectionSummary>
  squashBaseSelection: ReturnType<typeof selectSquashDrills>
  squashCompetitiveSelection: ReturnType<typeof selectSquashDrills>
  squashControlSelection: ReturnType<typeof selectSquashDrills>
  squashTemplateSummary: string
  squashBaseDrillsJson: string
  squashControlDrillsJson: string
  squashCompetitiveDrillsJson: string
  squashBaseObjective: string
  squashCompetitiveObjective: string
  strengthBaseSelection: ReturnType<typeof selectStrengthSession>
  strengthSupportSelection: ReturnType<typeof selectStrengthSession>
  strengthPrimarySelection: ReturnType<typeof selectStrengthSession>
  strengthPrimaryFollowUpSelection: ReturnType<typeof selectStrengthSession>
  strengthBaseSummary: string
  strengthBaseExercisesJson: string
  strengthSupportExercisesJson: string
  strengthPrimaryExercisesJson: string
  strengthPrimaryFollowUpExercisesJson: string
}

export function buildLoadAnalyticsSection(context: ChatContext): string {
  const analytics = context.loadAnalytics
  if (!analytics || analytics.weeks.length === 0) return ''
  const runningLoad = analytics.runningWeeklyLoads?.[0]
  const runningAcwr = analytics.runningAcwr
  const lines: string[] = ['══ CARGA HISTÓRICA POR DISCIPLINA (últimas semanas) ══']

  for (const week of analytics.weeks) {
    const isCurrentWeek = week === analytics.weeks[0]
    const label = isCurrentWeek ? 'Sem actual' : `Sem -${analytics.weeks.indexOf(week)}`
    const disciplineParts = week.disciplines
      .filter((d) => d.plannedSessions > 0 || d.completedSessions > 0)
      .map((d) => {
        const name = SPORT_ES[d.type] ?? d.type
        return `${name} ${d.completedSessions}/${d.plannedSessions} (${d.completedMinutes}min)`
      })
    const rpeStr = week.avgActualRpe != null ? ` · RPE ${week.avgActualRpe}` : ''
    const loadStr = week.totalWeightedLoad > 0 ? ` · Carga ${Math.round(week.totalWeightedLoad)}` : ''
    lines.push(
      `${label} [${week.weekStart}]: ${disciplineParts.join(' · ')} | Adherencia ${week.adherencePct}%${rpeStr}${loadStr}`,
    )
  }

  lines.push('')
  lines.push(`Tendencia general: ${TREND_ES[analytics.overallTrend]}`)
  if (analytics.weeks[0].runningMinutes > 0 || analytics.weeks[1]?.runningMinutes > 0) {
    lines.push(`Tendencia running: ${TREND_ES[analytics.runningTrend]}`)
  }
  lines.push(`Tendencia adherencia: ${TREND_ES[analytics.adherenceTrend]}`)

  if (analytics.acwr) {
    const acwr = analytics.acwr
    lines.push('')
    lines.push(`ACWR actual: ${acwr.ratio.toFixed(2)} · aguda ${Math.round(acwr.acute)} · cronica ${Math.round(acwr.chronic)} · baseline ${acwr.baselineWeeks} semana(s)`)

    if (acwr.baselineLimited) {
      lines.push('ACWR con baseline limitada: usalo solo como senal direccional, no como regla rigida.')
      lines.push('Si el atleta se siente bien y no hay competencia cercana, puedes progresar con prudencia.')
    } else if (acwr.zone === 'risk') {
      lines.push('ACWR en zona de riesgo: no agregues volumen ni intensidad extra salvo que el usuario pida una descarga muy puntual con razon clara.')
      lines.push('Prioriza reducir carga, mantener tecnica, recovery, movilidad y llegar fresco a sesiones clave.')
    } else if (acwr.zone === 'undertrained') {
      lines.push('ACWR en zona baja: puedes progresar la carga si no hay senales de fatiga, dolor o taper competitivo.')
      lines.push('La progresion debe ser gradual y sin apilar dos dias duros seguidos.')
    } else {
      lines.push('ACWR en zona razonable: manten una progresion moderada y evita cambios bruscos de volumen.')
    }
  } else {
    lines.push('ACWR no disponible todavia: no hay baseline suficiente de semanas previas con carga.')
  }

  lines.push('Usa esta informacion para ajustar la carga propuesta: si la carga viene alta, no sumes mas volumen; si viene baja y el atleta esta recuperado, puedes progresar.')

  if (runningLoad && runningLoad.sessionsCount > 0) {
    const distanceStr = runningLoad.totalDistanceKm != null
      ? `${runningLoad.totalDistanceKm} km`
      : `${runningLoad.totalDurationMin ?? 0} min`
    const ratioStr = runningAcwr.ratio != null ? runningAcwr.ratio.toFixed(2) : 'sin ratio'
    lines.push(`Running cuantitativo: ${distanceStr} en ${runningLoad.sessionsCount} sesion(es) - carga ${Math.round(runningLoad.totalLoad)} - ACWR running ${ratioStr} (${runningAcwr.status})`)
    if (runningAcwr.status === 'risk') {
      lines.push('Senal running: descarga running primero y no castigues squash o fuerza si esos deportes siguen estables.')
    } else if (runningAcwr.status === 'undertrained') {
      lines.push('Senal running: puedes progresar running si la fase y la fatiga lo permiten.')
    } else if (runningAcwr.status === 'limited') {
      lines.push('Senal running: historial insuficiente; usa esta capa solo como apoyo y manten la logica contextual actual.')
    }
  }

  const byDisc = analytics.acwrByDiscipline
  if (byDisc) {
    const ZONE_ES: Record<string, string> = {
      undertrained: 'baja',
      optimal: 'optima',
      risk: 'riesgo',
      limited: 'insuf',
    }
    const disciplineLines: string[] = []
    for (const sport of ['squash', 'running', 'strength'] as const) {
      const d = byDisc[sport]
      if (d.acuteLoad > 0) {
        const ratioStr = d.ratio != null ? d.ratio.toFixed(2) : 'sin ratio'
        disciplineLines.push(`${sport === 'strength' ? 'Fuerza' : sport.charAt(0).toUpperCase() + sport.slice(1)}: ${ratioStr} (${ZONE_ES[d.status]})`)
      }
    }
    if (disciplineLines.length > 0) {
      lines.push('')
      lines.push(`ACWR por deporte: ${disciplineLines.join(' · ')}`)
      lines.push('Usa estos ratios para decidir por deporte de forma independiente: puedes bajar running sin tocar squash, mantener fuerza aunque squash este alto, etc.')
    }
  }

  return lines.join('\n')
}

export function buildResponsePromptContext(
  sessions: Session[],
  context: ChatContext,
  squashSummary: SquashSelectionSummary,
  strengthSummary: StrengthSelectionSummary,
  cyclingSummary: ReturnType<typeof buildCyclingSelectionSummary>,
  mobilitySummary: ReturnType<typeof buildMobilitySelectionSummary>,
): ResponsePromptContext {
  const today = todayISO()
  const weekStart = context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO()
  const weekDates = buildWeekDatesList(weekStart)
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  const primarySportNorm = getPlanningPrimarySport(context.athleteProfile) ?? getPrimarySportNormalized(context.athleteProfile)
  const primarySportLabel = primarySportNorm
    ?? context.athleteProfile?.primarySport?.trim()
    ?? 'deporte principal'
  const playsSquash = enabledSports.includes('squash')
  const hasRunning = enabledSports.includes('running')
  const hasStrength = enabledSports.includes('strength')
  const hasCycling = enabledSports.includes('cycling')
  const hasMobility = enabledSports.includes('mobility')

  const SPORT_SESSION_COUNTS: Partial<Record<string, string>> = {
    squash: '2-3 sesiones/semana',
    running: '2-3 sesiones/semana',
    strength: '1-2 sesiones/semana',
    mobility: '1 sesión/semana',
    cycling: '1-2 sesiones/semana',
  }

  const activeSportList = enabledSports.length > 0
    ? enabledSports
    : [
        playsSquash ? 'squash' : null,
        hasRunning ? 'running' : null,
        hasStrength ? 'strength' : null,
        hasCycling ? 'cycling' : null,
      ].filter(Boolean) as string[]

  const sportPriority = activeSportList.length > 0
    ? activeSportList.map((s) => `${s} (${SPORT_SESSION_COUNTS[s] ?? '1-2 sesiones/semana'})`).join(' > ')
    : `${primarySportLabel} (2-3 sesiones/semana)`

  const sp = context.athleteProfile?.strengthProfile
  const w = {
    bench75: sp?.benchPress1RM ? Math.round(sp.benchPress1RM * 0.75) : 80,
    bench85: sp?.benchPress1RM ? Math.round(sp.benchPress1RM * 0.85) : 90,
    row75: sp?.deadlift1RM ? Math.round(sp.deadlift1RM * 0.55) : 60,
    ohp75: sp?.overheadPress1RM ? Math.round(sp.overheadPress1RM * 0.75) : 50,
    squat75: sp?.squat1RM ? Math.round(sp.squat1RM * 0.75) : 90,
    squat85: sp?.squat1RM ? Math.round(sp.squat1RM * 0.85) : 102,
    deadlift75: sp?.deadlift1RM ? Math.round(sp.deadlift1RM * 0.75) : 110,
  }

  const rp = context.athleteProfile?.runningProfile
  const z2min = rp?.z2PaceMin ?? '5:30'
  const z2max = rp?.z2PaceMax ?? '6:00'
  const tempoMin = rp?.thresholdPace ? addSecsToPace(rp.thresholdPace, -10) : '4:40'
  const tempoMax = rp?.thresholdPace ?? '5:00'
  const longRunPaceStr = rp?.longRunPace ?? rp?.easyPaceMax ?? '6:00'
  const intervalPaceStr = rp?.fiveKTime ? deriveIntervalPace(rp.fiveKTime) : '4:15'

  const hipThrust85 = sp?.squat1RM ? Math.round(sp.squat1RM * 0.85) : 100
  const lunge45 = sp?.squat1RM ? Math.round(sp.squat1RM * 0.45) : 55
  const plannedSessionLines = sessions
    .filter((s) => s.status === 'planned' && s.date >= today)
    .slice(0, 10)
    .map((s) => `  [${s.id.slice(0, 8)}] ${getDayName(s.date)} ${s.timeBlock} · ${SESSION_TYPE_ES[s.type] ?? s.type} "${s.title}"`)
    .join('\n')

  const primary = getPlanningPrimarySport(context.athleteProfile)
  const squashSelection = squashSummary?.selection
  const squashSelectorContext = squashSummary?.selectionContext
  const strengthSelection = strengthSummary?.selection
  const strengthSelectorContext = strengthSummary?.selectionContext

  const squashBaseSelection = squashSelection ?? selectSquashDrills({
    fatigueLevel: 4,
    phase: 'build',
    recentDrills: [],
    goal: 'desarrollar control, precision y presion en squash',
    competitionSoon: false,
  })
  const squashCompetitiveSelection = selectSquashDrills({
    fatigueLevel: Math.max(squashSelectorContext?.fatigueLevel ?? 4, 4),
    phase: 'taper',
    recentDrills: squashSelectorContext?.recentDrills ?? [],
    goal: 'llegar fresco al partido objetivo y afinar timing en squash',
    competitionSoon: true,
  })
  const squashControlSelection = selectSquashDrills({
    fatigueLevel: 3,
    phase: squashSelectorContext?.phase ?? 'build',
    recentDrills: squashSelectorContext?.recentDrills ?? [],
    goal: 'ordenar sensaciones, control de T y consistencia tactica',
    competitionSoon: false,
  })

  const squashBaseObjective = squashBaseSelection.focusExplanation
  const squashCompetitiveObjective = squashCompetitiveSelection.focusExplanation
  const squashTemplateSummary = formatSelectedSquashDrills(squashBaseSelection.drills)
  const squashBaseDrillsJson = JSON.stringify(squashBaseSelection.drills.slice(0, 4))
  const squashControlDrillsJson = JSON.stringify(squashControlSelection.drills.slice(0, 4))
  const squashCompetitiveDrillsJson = JSON.stringify(squashCompetitiveSelection.drills.slice(0, 4))

  const strengthBaseSelection = strengthSelection ?? selectStrengthSession({
    sportProfile: hasRunning ? 'hybrid_running' : playsSquash ? 'hybrid_squash' : 'general',
    phase: 'build',
    fatigueLevel: 4,
    recentFocuses: [],
    competitionSoon: false,
  })
  const strengthSupportSelection = selectStrengthSession({
    sportProfile: hasRunning ? 'hybrid_running' : playsSquash ? 'hybrid_squash' : 'general',
    phase: strengthSelectorContext?.phase ?? 'build',
    fatigueLevel: 5,
    recentFocuses: strengthSelectorContext?.recentFocuses ?? [],
    competitionSoon: Boolean(strengthSelectorContext?.competitionSoon),
  })
  const strengthPrimarySelection = selectStrengthSession({
    sportProfile: primary === 'strength' ? 'strength_primary' : (hasRunning ? 'hybrid_running' : playsSquash ? 'hybrid_squash' : 'general'),
    phase: 'build',
    fatigueLevel: 4,
    recentFocuses: [],
    competitionSoon: false,
  })
  const strengthPrimaryFollowUpSelection = selectStrengthSession({
    sportProfile: primary === 'strength' ? 'strength_primary' : (hasRunning ? 'hybrid_running' : playsSquash ? 'hybrid_squash' : 'general'),
    phase: 'build',
    fatigueLevel: 5,
    recentFocuses: [strengthPrimarySelection.focus],
    competitionSoon: false,
  })

  const strengthBaseSummary = formatSelectedStrengthExercises(strengthBaseSelection.exercises)
  const strengthBaseExercisesJson = JSON.stringify(strengthBaseSelection.exercises.slice(0, 5))
  const strengthSupportExercisesJson = JSON.stringify(strengthSupportSelection.exercises.slice(0, 5))
  const strengthPrimaryExercisesJson = JSON.stringify(strengthPrimarySelection.exercises.slice(0, 5))
  const strengthPrimaryFollowUpExercisesJson = JSON.stringify(strengthPrimaryFollowUpSelection.exercises.slice(0, 5))

  return {
    today,
    weekStart,
    weekDates,
    primary,
    primarySportLabel,
    sportPriority,
    playsSquash,
    hasRunning,
    hasStrength,
    hasCycling,
    hasMobility,
    plannedSessionLines,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    longRunPaceStr,
    intervalPaceStr,
    w,
    hipThrust85,
    lunge45,
    squashSummary,
    strengthSummary,
    cyclingSummary,
    mobilitySummary,
    squashBaseSelection,
    squashCompetitiveSelection,
    squashControlSelection,
    squashTemplateSummary,
    squashBaseDrillsJson,
    squashControlDrillsJson,
    squashCompetitiveDrillsJson,
    squashBaseObjective,
    squashCompetitiveObjective,
    strengthBaseSelection,
    strengthSupportSelection,
    strengthPrimarySelection,
    strengthPrimaryFollowUpSelection,
    strengthBaseSummary,
    strengthBaseExercisesJson,
    strengthSupportExercisesJson,
    strengthPrimaryExercisesJson,
    strengthPrimaryFollowUpExercisesJson,
  }
}

export function buildReferenceLoadSection(promptContext: ResponsePromptContext): string {
  const {
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    intervalPaceStr,
    longRunPaceStr,
    w,
    hipThrust85,
    lunge45,
  } = promptContext

  return `CARGAS Y RITMOS DE REFERENCIA (aplica estos valores en todas las propuestas de running y fuerza):
Running:
  Â· Z2: ${z2min}â€“${z2max} /km  Â· Tempo/umbral: ${tempoMin}â€“${tempoMax} /km  Â· Intervalos VO2max: ${intervalPaceStr} /km  Â· Long run: ${longRunPaceStr} /km
Fuerza upper:
  Â· Press banca ${w.bench75}kg (75%) / ${w.bench85}kg (85%)  Â· Remo con barra ${w.row75}kg  Â· Press hombro ${w.ohp75}kg (75%)
Fuerza lower:
  Â· Sentadilla ${w.squat75}kg (75%) / ${w.squat85}kg (85%)  Â· Peso muerto ${w.deadlift75}kg (75%)  Â· Hip thrust ${hipThrust85}kg  Â· Lunge ${lunge45}kg`
}

export function buildCyclingMobilityActionSchemaAddendum(promptContext: ResponsePromptContext): string {
  const sections: string[] = ['ADDENDUM - CAMPOS EXPLICITOS PARA CYCLING Y MOBILITY']

  if (promptContext.hasCycling) {
    sections.push(
      'Cuando sessionType = "cycling", incluye cyclingDetails siempre que la sesion sea creada o actualizada por el coach.',
      'cyclingDetails: {',
      '  sessionCategory: "support aerobic" | "primary build" | "fatigue-managed threshold" | "activation" | "recovery",',
      '  sessionFamily: "z2_aerobic" | "long_ride" | "sweetspot_tempo" | "intervals_vo2" | "activation" | "recovery",',
      '  targetStructure: "estructura breve y accionable",',
      '  intensityReference: "low|moderate|moderate-high|high o referencia equivalente",',
      '  executionNotes: "nota corta de ejecucion"',
      '}',
    )
  }

  if (promptContext.hasMobility) {
    sections.push(
      'Cuando sessionType = "mobility", incluye mobilityDetails siempre que la sesion sea creada o actualizada por el coach.',
      'mobilityDetails: {',
      '  focusAreas: ["hip"|"ankle_foot"|"shoulder_thoracic"|"full_body"|"sport_specific"|"activation", ...],',
      '  context: "post_run" | "post_cycling" | "post_squash" | "post_strength" | "pre_training_activation" | "recovery" | "full_body" | "sport_specific",',
      '  targetStructure: "bloques concretos o flujo resumido",',
      '  executionNotes: "nota corta de uso o dosificacion"',
      '}',
      'Si propones movilidad, el titulo y el objetivo deben reflejar foco anatomico o contexto real; no uses solo "Movilidad".',
    )
  }

  if (promptContext.hasCycling || promptContext.hasMobility) {
    sections.push(
      'Ejemplos compactos válidos:',
      '  cycling -> {"sessionType":"cycling","title":"Ciclismo Z2","runningType":"z2","cyclingDetails":{"sessionCategory":"support aerobic","sessionFamily":"z2_aerobic","targetStructure":"Rodaje Z2 continuo con cadencia estable.","intensityReference":"moderate","executionNotes":"Soporte aerobico sin interferir con el deporte principal."}}',
      '  mobility -> {"sessionType":"mobility","title":"Movilidad post-cycling","mobilityDetails":{"context":"post_cycling","focusAreas":["hip","ankle_foot"],"targetStructure":"10-15min post sesion con movilidad activa y reset articular.","executionNotes":"Usar como descarga corta y especifica."}}',
    )
  }

  return sections.join('\n')
}
