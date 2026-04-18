import type {
  AthleteProfile,
  DayLog,
  HydrationSweatRate,
  NutritionDailyRecommendation,
  NutritionDayType,
  NutritionFuelingGoal,
  NutritionHydrationGuidance,
  NutritionMacroEmphasis,
  NutritionMealTimingGuidance,
  Session,
  SupportedSport,
} from '../types'
import { isCompetitionSquashMatch } from '../utils/squash'

interface NutritionContext {
  activeSessions: Session[]
  primarySport: SupportedSport | 'mixed' | 'none'
  sessionCount: number
  totalMinutes: number
  maxRpe: number
  averageRpe: number
  hasCompetition: boolean
  hasRecoverySession: boolean
  hasThresholdOrIntervals: boolean
  hasTempoOrZ2: boolean
  hasStrength: boolean
  fatigueSignals: string[]
  fuelingGoal: NutritionFuelingGoal
  sweatRate: HydrationSweatRate
  proteinTargetText?: string
  dietaryNotes?: string
}

const PROTEIN_FACTOR: Record<NutritionDayType, number> = {
  rest: 1.6,
  light: 1.7,
  moderate: 1.8,
  high: 1.9,
  double_session: 2.0,
  competition: 2.0,
  recovery: 1.8,
}

const TRAINING_WATER_ADD: Record<NutritionDayType, number> = {
  rest: 0,
  light: 0.4,
  moderate: 0.8,
  high: 1.1,
  double_session: 1.5,
  competition: 1.5,
  recovery: 0.5,
}

const SWEAT_RATE_ADD: Record<HydrationSweatRate, number> = {
  low: 0,
  moderate: 0.2,
  high: 0.5,
}

export function classifyNutritionDayType(sessions: Session[], dayLog?: DayLog): NutritionDayType {
  const context = buildNutritionContext(sessions, undefined, dayLog)

  if (context.sessionCount === 0) {
    return context.fatigueSignals.length > 0 ? 'recovery' : 'rest'
  }
  if (context.hasCompetition) return 'competition'
  if (context.sessionCount >= 2) return 'double_session'
  if (context.hasRecoverySession && !context.hasThresholdOrIntervals && context.maxRpe <= 4) return 'recovery'
  if (context.fatigueSignals.length >= 2 && !context.hasThresholdOrIntervals && context.maxRpe <= 6) return 'recovery'

  if (
    context.hasThresholdOrIntervals ||
    context.totalMinutes >= 90 ||
    context.maxRpe >= 8 ||
    (context.primarySport === 'squash' && context.averageRpe >= 7) ||
    (context.primarySport === 'cycling' && context.totalMinutes >= 100)
  ) {
    return 'high'
  }

  if (
    context.hasTempoOrZ2 ||
    context.hasStrength ||
    context.totalMinutes >= 45 ||
    context.averageRpe >= 5
  ) {
    return 'moderate'
  }

  return 'light'
}

export function classifyDayLoad(sessions: Session[], dayLog?: DayLog): NutritionDayType {
  return classifyNutritionDayType(sessions, dayLog)
}

export function resolveMacroEmphasis(
  dayType: NutritionDayType,
  sport: SupportedSport | 'mixed' | 'none',
  goal: NutritionFuelingGoal,
): NutritionMacroEmphasis {
  if (dayType === 'competition' || dayType === 'double_session') return 'carb_priority'
  if (dayType === 'recovery') return 'recovery_support'
  if (goal === 'mild_fat_loss') {
    return dayType === 'high' || dayType === 'moderate' ? 'carb_support' : 'protein_forward'
  }
  if (dayType === 'high') return sport === 'strength' ? 'balanced' : 'carb_priority'
  if (dayType === 'moderate') return sport === 'strength' ? 'balanced' : 'carb_support'
  if (dayType === 'light' || dayType === 'rest') return goal === 'performance' ? 'balanced' : 'protein_forward'
  return 'balanced'
}

export function resolveHydrationGuidance(
  dayType: NutritionDayType,
  sport: SupportedSport | 'mixed' | 'none',
  sweatRate: HydrationSweatRate,
  sessionCount: number,
  intensity: number,
  weightKg?: number,
  baseWaterLiters?: number,
): NutritionHydrationGuidance {
  const baselineLiters = baseWaterLiters ?? (weightKg ? round05(weightKg * 0.033) : null)
  const trainingAddLiters = round05(
    TRAINING_WATER_ADD[dayType] + SWEAT_RATE_ADD[sweatRate] + (sessionCount > 1 ? 0.2 : 0) + (intensity >= 8 ? 0.2 : 0),
  )
  const totalLiters = baselineLiters != null ? round05(baselineLiters + trainingAddLiters) : null
  const electrolyteFocus =
    dayType === 'competition' || dayType === 'double_session' || sweatRate === 'high'
      ? 'recommended'
      : dayType === 'high' || sport === 'cycling'
        ? 'optional'
        : 'none'

  let summary = totalLiters != null ? `Apunta a ~${totalLiters.toFixed(1)}L hoy.` : 'Prioriza hidratación sostenida durante el día.'
  if (baselineLiters != null && trainingAddLiters > 0) {
    summary = `${baselineLiters.toFixed(1)}L base + ${trainingAddLiters.toFixed(1)}L por carga = ~${totalLiters?.toFixed(1)}L hoy.`
  }
  if (electrolyteFocus === 'recommended') summary += ' Usa electrolitos.'
  if (electrolyteFocus === 'optional') summary += ' Considera electrolitos si sudas mucho.'
  if (sport === 'cycling') summary += ' Llega con bidón listo y bebe de forma progresiva.'
  if (sport === 'running' && dayType !== 'rest') summary += ' En running, empieza a hidratarte antes de tener sed.'
  if (sport === 'squash' && (dayType === 'competition' || dayType === 'high')) summary += ' Entre games o pausas cortas, sorbos breves y constantes.'
  if (sport === 'strength' && dayType === 'moderate') summary += ' No llegues deshidratado si quieres sostener fuerza y concentración.'

  return {
    totalLiters,
    baselineLiters,
    trainingAddLiters,
    electrolyteFocus,
    summary,
  }
}

export function resolveWorkoutFueling(
  dayType: NutritionDayType,
  sessions: Session[],
): { pre?: NutritionMealTimingGuidance; post?: NutritionMealTimingGuidance; extras: NutritionMealTimingGuidance[] } {
  const active = sessions.filter((session) => session.status !== 'skipped')
  if (active.length === 0) {
    return { extras: [] }
  }

  const primary = [...active].sort((a, b) => b.durationMin - a.durationMin || (b.rpe ?? 0) - (a.rpe ?? 0))[0]
  const sport = getSessionSport(primary)

  let pre: NutritionMealTimingGuidance | undefined
  let post: NutritionMealTimingGuidance | undefined
  const extras: NutritionMealTimingGuidance[] = []

  if (dayType !== 'rest' && dayType !== 'recovery') {
    pre = {
      label: 'Pre-entreno',
      timing: 'pre',
      window: dayType === 'competition' ? '2-3h antes' : '60-120min antes',
      summary: buildPreWorkoutSummary(dayType, sport),
    }
    post = {
      label: 'Post-entreno',
      timing: 'post',
      window: dayType === 'competition' || dayType === 'double_session' ? '0-30min después' : '0-60min después',
      summary: buildPostWorkoutSummary(dayType, sport),
    }
  }

  if (dayType === 'double_session') {
    extras.push({
      label: 'Entre sesiones',
      timing: 'during',
      window: 'Dentro de 30-45min tras la primera',
      summary: 'Recarga con carbohidratos fáciles de digerir y algo de proteína liviana antes de la segunda sesión.',
    })
  }

  if (dayType === 'competition') {
    extras.push({
      label: 'Durante competencia',
      timing: 'during',
      window: 'Desde el calentamiento',
      summary: 'Ten a mano agua, electrolitos y una fuente simple de carbohidratos si la competencia se alarga.',
    })
  }

  return { pre, post, extras }
}

export function resolveRecoveryNotes(dayType: NutritionDayType, fatigueSignals: string[]): string | undefined {
  if (dayType !== 'recovery' && fatigueSignals.length === 0) return undefined
  if (fatigueSignals.length === 0) return 'Mantén proteína repartida durante el día y una cena que facilite recuperar sin pesadez.'
  return `Hoy conviene priorizar recuperación porque aparecen señales de fatiga: ${fatigueSignals.join(', ')}.`
}

export function buildNutritionReasoning(context: NutritionContext): { summary: string; factors: string[] } {
  const factors: string[] = []

  if (context.sessionCount === 0) factors.push('sin sesiones activas')
  else factors.push(`${context.sessionCount} sesión${context.sessionCount > 1 ? 'es' : ''}`)
  if (context.primarySport !== 'none') factors.push(`deporte base: ${context.primarySport}`)
  if (context.hasThresholdOrIntervals) factors.push('trabajo intenso o de umbral')
  else if (context.hasTempoOrZ2) factors.push('carga aeróbica/controlada')
  if (context.hasCompetition) factors.push('competencia')
  if (context.fatigueSignals.length > 0) factors.push(`fatiga: ${context.fatigueSignals.join(', ')}`)
  if (context.fuelingGoal !== 'maintain') factors.push(`objetivo: ${context.fuelingGoal}`)

  return {
    summary: factors.join(' · '),
    factors,
  }
}

export function getDayNutrition(
  sessions: Session[],
  profile?: AthleteProfile | null,
  dayLog?: DayLog,
): NutritionDailyRecommendation {
  const context = buildNutritionContext(sessions, profile, dayLog)
  const dayType = classifyNutritionDayType(sessions, dayLog)
  const macroEmphasis = resolveMacroEmphasis(dayType, context.primarySport, context.fuelingGoal)
  const hydrationGuidance = resolveHydrationGuidance(
    dayType,
    context.primarySport,
    context.sweatRate,
    context.sessionCount,
    context.maxRpe,
    profile?.weightKg,
    profile?.nutritionProfile?.dailyWaterLiters,
  )
  const workoutFueling = resolveWorkoutFueling(dayType, context.activeSessions)
  const reasoning = buildNutritionReasoning(context)
  const recoveryNote = resolveRecoveryNotes(dayType, context.fatigueSignals)
  const mainFocus = buildMainFocus(dayType, context.primarySport, macroEmphasis, context.fuelingGoal)
  const keyAction = buildKeyAction(dayType, context.primarySport, workoutFueling.pre?.summary, hydrationGuidance.summary)
  const whyItMatters = buildWhyItMatters(dayType, context.primarySport, context.fatigueSignals)
  const proteinTargetText = resolveProteinTarget(profile, PROTEIN_FACTOR[dayType])
  const mealTiming = [
    ...[workoutFueling.pre, workoutFueling.post].filter((item): item is NutritionMealTimingGuidance => Boolean(item)),
    ...workoutFueling.extras,
  ]

  return {
    loadType: dayType,
    dayType,
    sport: context.primarySport,
    sessionCount: context.sessionCount,
    mainFocus,
    keyAction,
    whyItMatters,
    macroEmphasis,
    hydrationGuidance,
    mealTiming,
    preWorkoutGuidance: workoutFueling.pre,
    postWorkoutGuidance: workoutFueling.post,
    recoveryNote,
    reasoning,
    dailyFocus: mainFocus,
    hydration: hydrationGuidance.summary,
    preWorkout: workoutFueling.pre?.summary,
    postWorkout: workoutFueling.post?.summary,
    breakfast: buildLegacyMealExample(dayType, 'breakfast'),
    lunch: buildLegacyMealExample(dayType, 'lunch'),
    snack: buildLegacyMealExample(dayType, 'snack'),
    dinner: buildLegacyMealExample(dayType, 'dinner'),
    preTraining: workoutFueling.pre?.summary,
    postTraining: workoutFueling.post?.summary,
    proteinTarget: proteinTargetText,
    dietaryNotes: context.dietaryNotes,
  }
}

export function getLoadTypeLabel(loadType: NutritionDayType): string {
  const labels: Record<NutritionDayType, string> = {
    rest: 'Descanso',
    light: 'Ligero',
    moderate: 'Moderado',
    high: 'Alta carga',
    double_session: 'Doble sesión',
    competition: 'Competencia',
    recovery: 'Recuperación',
  }
  return labels[loadType]
}

export function getLoadTypeColor(loadType: NutritionDayType): string {
  const colors: Record<NutritionDayType, string> = {
    rest: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    light: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    moderate: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    high: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    double_session: 'text-red-400 bg-red-500/10 border-red-500/20',
    competition: 'text-brand-light bg-brand/10 border-brand/20',
    recovery: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  }
  return colors[loadType]
}

function buildNutritionContext(
  sessions: Session[],
  profile?: AthleteProfile | null,
  dayLog?: DayLog,
): NutritionContext {
  const activeSessions = sessions.filter((session) => session.status !== 'skipped')
  const rpeValues = activeSessions.map((session) => session.rpe).filter((value): value is number => typeof value === 'number')
  const averageRpe = rpeValues.length > 0 ? rpeValues.reduce((sum, value) => sum + value, 0) / rpeValues.length : 0
  const maxRpe = rpeValues.length > 0 ? Math.max(...rpeValues) : 0
  const fuelingGoal = profile?.nutritionProfile?.fuelingGoal ?? resolveFuelingGoal(profile)
  const sweatRate = profile?.nutritionProfile?.sweatRate ?? 'moderate'

  return {
    activeSessions,
    primarySport: resolvePrimarySport(activeSessions),
    sessionCount: activeSessions.length,
    totalMinutes: activeSessions.reduce((sum, session) => sum + session.durationMin, 0),
    maxRpe,
    averageRpe,
    hasCompetition: activeSessions.some((session) =>
      session.type === 'squash' ? isCompetitionSquashMatch(session) : session.subtype === 'competitive',
    ),
    hasRecoverySession: activeSessions.some((session) => session.type === 'recovery' || session.type === 'mobility'),
    hasThresholdOrIntervals: activeSessions.some((session) => isHighIntensitySession(session)),
    hasTempoOrZ2: activeSessions.some((session) => isModerateSession(session)),
    hasStrength: activeSessions.some((session) => session.type === 'strength'),
    fatigueSignals: resolveFatigueSignals(dayLog),
    fuelingGoal,
    sweatRate,
    proteinTargetText: undefined,
    dietaryNotes: profile?.nutritionProfile?.notes?.trim() || undefined,
  }
}

function resolvePrimarySport(sessions: Session[]): SupportedSport | 'mixed' | 'none' {
  const sports = [...new Set(sessions.map((session) => getSessionSport(session)).filter((sport): sport is SupportedSport => Boolean(sport)))]
  if (sports.length === 0) return 'none'
  if (sports.length === 1) return sports[0]
  return 'mixed'
}

function resolveFuelingGoal(profile?: AthleteProfile | null): NutritionFuelingGoal {
  if (profile?.sportContext?.trainingPriority === 'body_composition') return 'mild_fat_loss'
  if (profile?.sportContext?.trainingPriority === 'performance') return 'performance'
  return 'maintain'
}

function resolveFatigueSignals(dayLog?: DayLog): string[] {
  const factors: string[] = []
  if (!dayLog) return factors
  if (typeof dayLog.energyLevel === 'number' && dayLog.energyLevel <= 4) factors.push('energía baja')
  if (typeof dayLog.sleepHours === 'number' && dayLog.sleepHours < 6.5) factors.push('poco sueño')
  if (typeof dayLog.sleepQuality === 'number' && dayLog.sleepQuality <= 2) factors.push('sueño pobre')
  if (typeof dayLog.painLevel === 'number' && dayLog.painLevel >= 4) factors.push('dolor')
  return factors
}

function resolveProteinTarget(profile: AthleteProfile | null | undefined, factor: number): string | undefined {
  const explicit = profile?.nutritionProfile?.proteinTargetG
  if (explicit) return `~${explicit}g proteína`
  if (profile?.weightKg) return `~${Math.round(profile.weightKg * factor)}g proteína`
  return undefined
}

function isHighIntensitySession(session: Session): boolean {
  if (session.type === 'running') {
    return session.runningDetails?.runningType === 'intervals' || session.runningDetails?.runningType === 'tempo'
  }
  if (session.type === 'cycling') {
    return ['intervals_vo2', 'sweetspot_tempo', 'long_ride'].includes(session.cyclingDetails?.sessionFamily ?? '')
  }
  if (session.type === 'squash') {
    return session.subtype === 'competitive' || session.subtype === 'match' || (session.rpe ?? 0) >= 7
  }
  if (session.type === 'strength') {
    return (session.rpe ?? 0) >= 8 || session.durationMin >= 75
  }
  return (session.rpe ?? 0) >= 8
}

function isModerateSession(session: Session): boolean {
  if (session.type === 'running') {
    return session.runningDetails?.runningType === 'z2' || session.runningDetails?.runningType === 'tempo'
  }
  if (session.type === 'cycling') {
    return ['z2_aerobic', 'sweetspot_tempo', 'long_ride'].includes(session.cyclingDetails?.sessionFamily ?? '')
  }
  if (session.type === 'strength') return true
  return (session.rpe ?? 0) >= 5 || session.durationMin >= 40
}

function getSessionSport(session: Session): SupportedSport | null {
  if (session.type === 'nutrition' || session.type === 'recovery') return null
  return session.type
}

function buildPreWorkoutSummary(dayType: NutritionDayType, sport: SupportedSport | null): string {
  if (dayType === 'competition') {
    if (sport === 'squash') return 'Llega al partido con una comida simple 2-3h antes; evita fibra alta y deja un snack fácil para más cerca del warm-up.'
    return 'Come liviano y fácil de digerir 2-3h antes; evita fibra alta y experimentos.'
  }
  if (dayType === 'double_session') return 'Empieza la primera sesión con carbohidratos disponibles y sin llegar pesado.'
  if (sport === 'strength') return 'Llega con algo de carbohidrato y proteína ligera 60-90min antes para rendir mejor.'
  if (sport === 'running') return 'Prioriza carbohidratos fáciles de digerir 60-120min antes para no recortar calidad de ritmos o volumen.'
  if (sport === 'cycling') return 'Carga carbohidratos fáciles de tolerar y empieza la sesión con líquidos ya preparados.'
  if (sport === 'squash') return 'Llega ligero pero con energía: carbohidratos simples y nada que te deje pesado para moverte rápido.'
  return 'Llega con energía estable y una ingesta fácil de digerir antes de entrenar.'
}

function buildPostWorkoutSummary(dayType: NutritionDayType, sport: SupportedSport | null): string {
  if (dayType === 'competition' || dayType === 'double_session') {
    return 'Recupera de inmediato con proteína y carbohidratos rápidos para acelerar la reposición.'
  }
  if (sport === 'strength') return 'Asegura proteína completa y algo de carbohidrato tras la sesión.'
  if (sport === 'running') return 'Repón carbohidratos y proteína dentro de la primera hora para sostener la siguiente sesión.'
  if (sport === 'cycling') return 'Recupera con carbohidratos, proteína y líquidos para no arrastrar fatiga al siguiente bloque.'
  if (sport === 'squash') return 'Recarga rápido para bajar el desgaste neuromuscular y recuperar piernas.'
  return 'Haz una comida o colación de recuperación dentro de la primera hora.'
}

function buildMainFocus(
  dayType: NutritionDayType,
  sport: SupportedSport | 'mixed' | 'none',
  macro: NutritionMacroEmphasis,
  goal: NutritionFuelingGoal,
): string {
  switch (dayType) {
    case 'competition':
      return sport === 'squash'
        ? 'Día competitivo de squash: energía disponible, digestión simple e hidratación fina para sostener intensidad y decisiones.'
        : 'Día competitivo: energía disponible, digestión simple e hidratación precisa.'
    case 'double_session':
      return sport === 'mixed'
        ? 'Doble sesión: prioriza carbohidratos y recuperación entre bloques para que la segunda no salga vacía.'
        : `Doble sesión${sport !== 'none' ? ` de ${sport}` : ''}: prioriza carbohidratos y recuperación entre bloques.`
    case 'high':
      if (sport === 'running') return 'Alta carga de running: protege la calidad del trabajo clave con combustible suficiente y recuperación temprana.'
      if (sport === 'cycling') return 'Alta carga de ciclismo: prioriza carbohidratos, líquidos y una reposición rápida al terminar.'
      if (sport === 'squash') return 'Alta carga de squash: necesitas energía disponible para sostener intensidad, cambios de ritmo y toma de decisión.'
      return 'Alta carga: no te quedes corto de combustible ni de proteína.'
    case 'moderate':
      if (sport === 'strength') return 'Fuerza moderada: proteína constante y suficiente energía alrededor de la sesión para rendir sin pesadez.'
      return macro === 'balanced'
        ? 'Carga moderada: equilibrio entre combustible y reparación.'
        : 'Carga moderada: acompaña la sesión con carbohidratos útiles y proteína constante.'
    case 'recovery':
      return 'Recuperación: proteína repartida, hidratación y comida fácil de tolerar.'
    case 'light':
      return goal === 'mild_fat_loss'
        ? 'Día liviano: mantén proteína alta sin sobredimensionar carbohidratos.'
        : 'Día liviano: energía estable y proteína suficiente.'
    case 'rest':
    default:
      return 'Descanso: enfócate en recuperación, saciedad y consistencia.'
  }
}

function buildKeyAction(
  dayType: NutritionDayType,
  sport: SupportedSport | 'mixed' | 'none',
  preWorkoutSummary: string | undefined,
  hydrationSummary: string,
): string {
  if (dayType === 'rest') return 'Mantén proteína repartida en 3-4 comidas y cumple tu hidratación base.'
  if (dayType === 'recovery') return 'Haz comidas simples, bien toleradas, y no saltes la proteína del día.'
  if (dayType === 'competition') {
    if (sport === 'squash') return 'Planifica temprano la comida pre-partido y deja listo un snack rápido más líquidos con sales para antes de entrar.'
    return 'Planifica desde temprano la comida pre-competencia y llega con líquidos y sales preparados.'
  }
  if (dayType === 'double_session') return 'Deja lista una recarga entre sesiones; no dependas solo de la comida principal.'
  if (sport === 'running') return preWorkoutSummary ?? 'No empieces la sesión clave con déficit de energía.'
  if (sport === 'cycling') return preWorkoutSummary ?? 'Deja resuelta la hidratación y el combustible antes de salir.'
  if (sport === 'strength') return 'Asegura una comida o colación previa con proteína ligera y algo de carbohidrato.'
  if (sport === 'squash') return 'Llega liviano pero con energía lista para sostener cambios de ritmo y concentración.'
  return hydrationSummary
}

function buildWhyItMatters(
  dayType: NutritionDayType,
  sport: SupportedSport | 'mixed' | 'none',
  fatigueSignals: string[],
): string {
  if (fatigueSignals.length > 0) return `Hoy la nutrición importa más porque vienes con ${fatigueSignals.join(', ')}.`
  if (dayType === 'competition') return 'Una mala estrategia hoy impacta rendimiento, digestión y recuperación post evento.'
  if (dayType === 'double_session') return 'La segunda sesión depende mucho de cómo repongas entre bloques.'
  if (dayType === 'high') {
    if (sport === 'running') return 'Si te quedas corto hoy, suele caer primero la calidad de ritmos y luego la recuperación.'
    if (sport === 'cycling') return 'En ciclismo, la hidratación y los carbohidratos sostienen potencia, volumen y recuperación.'
    if (sport === 'squash') return 'En squash, llegar vacío se nota rápido en piernas, lectura del punto y velocidad de reacción.'
    return `La carga ${sport !== 'none' ? `de ${sport}` : 'del día'} necesita combustible suficiente para sostener calidad.`
  }
  if (dayType === 'rest') return 'Comer mejor hoy prepara la siguiente sesión sin arrastrar fatiga innecesaria.'
  if (sport === 'strength' && dayType === 'moderate') return 'Una sesión de fuerza bien alimentada se mueve mejor y deja menos fatiga residual innecesaria.'
  return 'Ajustar el día al contexto evita recomendaciones genéricas y mejora consistencia.'
}

function buildLegacyMealExample(
  dayType: NutritionDayType,
  meal: 'breakfast' | 'lunch' | 'snack' | 'dinner',
): string | undefined {
  const menu: Record<NutritionDayType, Record<typeof meal, string>> = {
    rest: {
      breakfast: 'Huevos, avena o yogur con fruta para empezar sin pesadez.',
      lunch: 'Proteína magra, verduras y una porción moderada de carbohidratos.',
      snack: 'Yogur griego o fruta con frutos secos.',
      dinner: 'Cena simple con proteína, verduras y carbohidrato moderado.',
    },
    light: {
      breakfast: 'Desayuno completo pero ligero, con proteína y carbohidrato simple.',
      lunch: 'Comida equilibrada con proteína y carbohidratos moderados.',
      snack: 'Fruta con yogur o un sándwich pequeño.',
      dinner: 'Cena completa sin excederse en volumen.',
    },
    moderate: {
      breakfast: 'Incluye avena, pan o fruta junto a proteína.',
      lunch: 'Base de arroz, pasta o papas con proteína magra.',
      snack: 'Colación con carbohidrato y algo de proteína.',
      dinner: 'Cena de recuperación con carbohidratos útiles y proteína.',
    },
    high: {
      breakfast: 'Desayuno abundante con carbohidratos y proteína.',
      lunch: 'Comida alta en carbohidratos y proteína magra.',
      snack: 'Colación de recuperación o pre-entreno según horario.',
      dinner: 'Cena completa para reponer glucógeno y reparar.',
    },
    double_session: {
      breakfast: 'Empieza fuerte con carbohidratos disponibles y proteína.',
      lunch: 'Usa la comida principal como recarga entre o tras sesiones.',
      snack: 'Ten una recarga lista para usar entre bloques.',
      dinner: 'Cierra el día con una cena completa y suficiente.',
    },
    competition: {
      breakfast: 'Desayuno conocido, simple y fácil de digerir.',
      lunch: 'Comida pre-competencia baja en fibra y rica en carbohidratos.',
      snack: 'Usa snacks simples y familiares cerca del evento.',
      dinner: 'Cena de recuperación bien tolerada y completa.',
    },
    recovery: {
      breakfast: 'Empieza con proteína y carbohidrato fácil de digerir.',
      lunch: 'Comida simple, hidratante y con buena proteína.',
      snack: 'Colación suave para sostener energía sin pesadez.',
      dinner: 'Cena reparadora, fácil de tolerar y suficiente.',
    },
  }

  return menu[dayType][meal]
}

function round05(value: number): number {
  return Math.round(value * 2) / 2
}
