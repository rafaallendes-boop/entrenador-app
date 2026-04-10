import type {
  CoachAction,
  CoachProposal,
  CoachProposalMetadata,
  CoachProposalQuality,
  CoachProposalSource,
  CoachProposalSpecificity,
  CoachProposalSportInsight,
  CoachSessionProposal,
  CyclingDetails,
  MobilityDetails,
  MobilitySessionContext,
  Session,
  SupportedSport,
} from '../types'

type DetailSport = 'cycling' | 'mobility'

interface SportObservation {
  sport: DetailSport
  explicit: boolean
}

export interface NormalizedCoachProposal {
  actions: CoachAction[]
  metadata: CoachProposalMetadata
}

export interface CoachProposalUsageSummary {
  totalTrackedProposals: number
  acceptedTrackedProposals: number
  bySport: Record<DetailSport, {
    total: number
    accepted: number
    explicitDetail: number
    genericFallback: number
  }>
  recentGenericProposals: CoachProposal[]
}

export function normalizeCoachProposal(
  actions: CoachAction[],
  options?: {
    source?: CoachProposalSource
    relatedAlertId?: string
    existingSessions?: Session[]
  },
): NormalizedCoachProposal {
  const existingSessions = options?.existingSessions ?? []
  const existingById = new Map(existingSessions.map((session) => [session.id, session]))
  const observations: SportObservation[] = []

  const normalizedActions = actions.map((action) => normalizeAction(action, existingById, observations))

  return {
    actions: normalizedActions,
    metadata: buildCoachProposalMetadata(observations, normalizedActions, {
      source: options?.source ?? 'chat',
      relatedAlertId: options?.relatedAlertId,
    }),
  }
}

export function summarizeCoachProposalUsage(proposals: CoachProposal[]): CoachProposalUsageSummary {
  const tracked = proposals.filter((proposal) =>
    proposal.metadata?.sportInsights.some((insight) => insight.sport === 'cycling' || insight.sport === 'mobility'),
  )

  const bySport: CoachProposalUsageSummary['bySport'] = {
    cycling: { total: 0, accepted: 0, explicitDetail: 0, genericFallback: 0 },
    mobility: { total: 0, accepted: 0, explicitDetail: 0, genericFallback: 0 },
  }

  for (const proposal of tracked) {
    const insights = proposal.metadata?.sportInsights ?? []
    for (const insight of insights) {
      bySport[insight.sport].total += 1
      if (proposal.status === 'accepted') bySport[insight.sport].accepted += 1
      if (insight.hasExplicitDetails) bySport[insight.sport].explicitDetail += 1
      if (insight.specificity === 'generic_fallback') bySport[insight.sport].genericFallback += 1
    }
  }

  return {
    totalTrackedProposals: tracked.length,
    acceptedTrackedProposals: tracked.filter((proposal) => proposal.status === 'accepted').length,
    bySport,
    recentGenericProposals: tracked
      .filter((proposal) => (proposal.metadata?.genericFallbackSports.length ?? 0) > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6),
  }
}

function normalizeAction(
  action: CoachAction,
  existingById: Map<string, Session>,
  observations: SportObservation[],
): CoachAction {
  if (action.type === 'create_week' && action.sessions) {
    const sessions = action.sessions.map((session) => normalizeSessionProposal(session, observations))
    return { ...action, sessions }
  }

  if (action.type === 'add_session') {
    const sessionType = action.sessionType
    if (sessionType === 'cycling') {
      const explicit = hasCompleteCyclingDetails(action.cyclingDetails)
      observations.push({ sport: 'cycling', explicit })
      return {
        ...action,
        cyclingDetails: explicit ? action.cyclingDetails : buildFallbackCyclingDetails(action),
      }
    }
    if (sessionType === 'mobility') {
      const explicit = hasCompleteMobilityDetails(action.mobilityDetails)
      observations.push({ sport: 'mobility', explicit })
      return {
        ...action,
        mobilityDetails: explicit ? action.mobilityDetails : buildFallbackMobilityDetails(action),
      }
    }
  }

  if (action.type === 'update_session') {
    const effectiveType = action.newType ?? (action.sessionId ? existingById.get(action.sessionId)?.type : undefined)
    if (effectiveType === 'cycling') {
      const explicit = hasCompleteCyclingDetails(action.cyclingDetails)
      observations.push({ sport: 'cycling', explicit })
      return {
        ...action,
        cyclingDetails: explicit ? action.cyclingDetails : buildFallbackCyclingDetails(action, existingById.get(action.sessionId ?? '')),
      }
    }
    if (effectiveType === 'mobility') {
      const explicit = hasCompleteMobilityDetails(action.mobilityDetails)
      observations.push({ sport: 'mobility', explicit })
      return {
        ...action,
        mobilityDetails: explicit ? action.mobilityDetails : buildFallbackMobilityDetails(action, existingById.get(action.sessionId ?? '')),
      }
    }
  }

  return action
}

function normalizeSessionProposal(
  session: CoachSessionProposal,
  observations: SportObservation[],
): CoachSessionProposal {
  if (session.sessionType === 'cycling') {
    const explicit = hasCompleteCyclingDetails(session.cyclingDetails)
    observations.push({ sport: 'cycling', explicit })
    return {
      ...session,
      cyclingDetails: explicit ? session.cyclingDetails : buildFallbackCyclingDetails(session),
    }
  }

  if (session.sessionType === 'mobility') {
    const explicit = hasCompleteMobilityDetails(session.mobilityDetails)
    observations.push({ sport: 'mobility', explicit })
    return {
      ...session,
      mobilityDetails: explicit ? session.mobilityDetails : buildFallbackMobilityDetails(session),
    }
  }

  return session
}

function buildCoachProposalMetadata(
  observations: SportObservation[],
  actions: CoachAction[],
  opts: { source: CoachProposalSource; relatedAlertId?: string },
): CoachProposalMetadata {
  const supportedSports = new Set<SupportedSport>()
  const summaries = new Map<DetailSport, CoachProposalSportInsight>()

  for (const action of actions) {
    collectSportsFromAction(action).forEach((sport) => supportedSports.add(sport))
  }

  for (const observation of observations) {
    const current = summaries.get(observation.sport) ?? {
      sport: observation.sport,
      actionCount: 0,
      hasExplicitDetails: true,
      specificity: 'detailed' as CoachProposalSpecificity,
    }
    current.actionCount += 1
    current.hasExplicitDetails = current.hasExplicitDetails && observation.explicit
    if (!observation.explicit) current.specificity = 'generic_fallback'
    summaries.set(observation.sport, current)
  }

  const sportInsights = [...summaries.values()]
  const fallbackSports = sportInsights
    .filter((insight) => insight.specificity === 'generic_fallback')
    .map((insight) => insight.sport)

  return {
    source: opts.source,
    sports: [...supportedSports],
    sportInsights,
    genericFallbackSports: fallbackSports,
    quality: resolveProposalQuality(sportInsights),
    resolutionOutcome: 'pending',
    relatedAlertId: opts.relatedAlertId,
  }
}

function resolveProposalQuality(insights: CoachProposalSportInsight[]): CoachProposalQuality {
  if (insights.length === 0) return 'none'
  const fallbackCount = insights.filter((insight) => insight.specificity === 'generic_fallback').length
  if (fallbackCount === 0) return 'detailed'
  if (fallbackCount === insights.length) return 'generic_fallback'
  return 'mixed'
}

function collectSportsFromAction(action: CoachAction): SupportedSport[] {
  const sports = new Set<SupportedSport>()

  if (action.type === 'add_session' && action.sessionType && isSupportedSport(action.sessionType)) {
    sports.add(action.sessionType)
  }
  if (action.type === 'update_session' && action.newType && isSupportedSport(action.newType)) {
    sports.add(action.newType)
  }
  if (action.type === 'create_week') {
    for (const session of action.sessions ?? []) {
      if (isSupportedSport(session.sessionType)) sports.add(session.sessionType)
    }
  }

  return [...sports]
}

function isSupportedSport(value: string): value is SupportedSport {
  return ['squash', 'running', 'strength', 'cycling', 'mobility'].includes(value)
}

function hasCompleteCyclingDetails(details: CyclingDetails | undefined): details is CyclingDetails {
  return Boolean(
    details?.sessionCategory?.trim() &&
    details?.sessionFamily?.trim() &&
    details?.targetStructure?.trim(),
  )
}

function hasCompleteMobilityDetails(details: MobilityDetails | undefined): details is MobilityDetails {
  return Boolean(
    details?.context &&
    details?.targetStructure?.trim() &&
    Array.isArray(details?.focusAreas) &&
    details.focusAreas.length > 0,
  )
}

export function buildFallbackCyclingDetails(
  item: Pick<CoachAction, 'title' | 'objective' | 'runningType' | 'intervalStructure'> | Pick<CoachSessionProposal, 'title' | 'objective' | 'runningType' | 'intervalStructure'>,
  currentSession?: Session,
): CyclingDetails {
  const text = normalizeText([
    item.title,
    item.objective,
    currentSession?.title,
    currentSession?.objective,
    currentSession?.cyclingDetails?.sessionCategory,
    currentSession?.cyclingDetails?.sessionFamily,
  ].filter(Boolean).join(' '))

  const family = inferCyclingFamily(text, item.runningType)
  const category = inferCyclingCategory(family)
  const structure = currentSession?.cyclingDetails?.targetStructure
    ?? (item.intervalStructure
      ? describeIntervalStructure(item.intervalStructure)
      : inferCyclingStructure(family))

  return {
    sessionCategory: category,
    sessionFamily: family,
    targetStructure: structure,
    intensityReference: inferCyclingIntensity(family),
    executionNotes: currentSession?.cyclingDetails?.executionNotes ?? 'Detalle inferido automaticamente para evitar una salida generica del coach.',
  }
}

export function buildFallbackMobilityDetails(
  item: Pick<CoachAction, 'title' | 'objective' | 'exercises'> | Pick<CoachSessionProposal, 'title' | 'objective' | 'exercises'>,
  currentSession?: Session,
): MobilityDetails {
  const text = normalizeText([
    item.title,
    item.objective,
    currentSession?.title,
    currentSession?.objective,
    currentSession?.mobilityDetails?.context,
    currentSession?.mobilityDetails?.focusAreas?.join(' '),
  ].filter(Boolean).join(' '))

  const focusAreas = inferMobilityFocusAreas(text, item.exercises, currentSession)
  const context = inferMobilityContext(text, currentSession)

  return {
    context,
    focusAreas,
    targetStructure: currentSession?.mobilityDetails?.targetStructure ?? inferMobilityStructure(context, focusAreas),
    executionNotes: currentSession?.mobilityDetails?.executionNotes ?? 'Detalle inferido automaticamente para no guardar una propuesta de movilidad generica.',
  }
}

function inferCyclingFamily(text: string, runningType?: string): string {
  if (runningType === 'intervals' || /interval|vo2|series|alta intensidad/.test(text)) return 'intervals_vo2'
  if (runningType === 'tempo' || /tempo|sweetspot|umbral|threshold|over under/.test(text)) return 'sweetspot_tempo'
  if (runningType === 'long' || /long ride|fondo|largo/.test(text)) return 'long_ride'
  if (/activation|activacion|opener|openers|pre event|pre race/.test(text)) return 'activation'
  if (/recovery|recupera|suave|flush/.test(text)) return 'recovery'
  return 'z2_aerobic'
}

function inferCyclingCategory(family: string): string {
  switch (family) {
    case 'intervals_vo2':
      return 'primary build'
    case 'sweetspot_tempo':
      return 'fatigue-managed threshold'
    case 'long_ride':
      return 'primary endurance'
    case 'activation':
      return 'activation'
    case 'recovery':
      return 'recovery'
    case 'z2_aerobic':
    default:
      return 'support aerobic'
  }
}

function inferCyclingStructure(family: string): string {
  switch (family) {
    case 'intervals_vo2':
      return '15min suaves + 4-6 repeticiones de 3-5min fuertes con recuperacion activa + 10min suaves.'
    case 'sweetspot_tempo':
      return '15min de entrada en calor + 2-3 bloques de 10-15min sostenidos + vuelta a la calma.'
    case 'long_ride':
      return 'Rodaje continuo en Z2 con cadencia estable y nutricion si supera 90min.'
    case 'activation':
      return '20-35min suaves con 3-4 aceleraciones cortas para activar piernas sin fatigar.'
    case 'recovery':
      return '20-40min muy suaves, pedaleo relajado y sin tension acumulada.'
    default:
      return 'Rodaje Z2 continuo con cadencia comoda y foco aeróbico controlado.'
  }
}

function inferCyclingIntensity(family: string): string {
  switch (family) {
    case 'intervals_vo2':
      return 'high'
    case 'sweetspot_tempo':
      return 'moderate-high'
    case 'long_ride':
      return 'moderate'
    case 'activation':
    case 'recovery':
      return 'low'
    default:
      return 'moderate'
  }
}

function inferMobilityContext(text: string, currentSession?: Session): MobilitySessionContext {
  const existingContext = currentSession?.mobilityDetails?.context
  if (existingContext) return existingContext
  if (/post cycling|post ciclismo|post bici/.test(text)) return 'post_cycling'
  if (/post run|post running/.test(text)) return 'post_run'
  if (/post squash/.test(text)) return 'post_squash'
  if (/post strength|post fuerza|reset/.test(text)) return 'post_strength'
  if (/activacion|pre training|pre entrenamiento/.test(text)) return 'pre_training_activation'
  if (/recovery|recuperacion|descarga/.test(text)) return 'recovery'
  if (/full body|global|general/.test(text)) return 'full_body'
  return 'sport_specific'
}

function inferMobilityFocusAreas(
  text: string,
  exercises: Array<{ mobilityFocus?: string }> | undefined,
  currentSession?: Session,
): string[] {
  const explicit = currentSession?.mobilityDetails?.focusAreas?.filter(Boolean)
  if (explicit && explicit.length > 0) return explicit

  const areas = new Set<string>()
  for (const exercise of exercises ?? []) {
    if (exercise.mobilityFocus) areas.add(exercise.mobilityFocus)
  }
  if (/cadera|hip/.test(text)) areas.add('hip')
  if (/tobillo|ankle/.test(text)) areas.add('ankle_foot')
  if (/hombro|thoracic|torac/.test(text)) areas.add('shoulder_thoracic')
  if (/full body|global|general/.test(text)) areas.add('full_body')
  if (/activacion/.test(text)) areas.add('activation')
  if (/sport|deporte|running|cycling|squash|fuerza/.test(text)) areas.add('sport_specific')
  if (areas.size === 0) {
    areas.add('hip')
    areas.add('ankle_foot')
  }
  return [...areas]
}

function inferMobilityStructure(context: MobilitySessionContext, focusAreas: string[]): string {
  if (context === 'pre_training_activation') {
    return `8-12min de activacion dinamica con foco en ${focusAreas.join(', ')} y transiciones rapidas.`
  }
  if (context === 'recovery') {
    return `20-30min suaves con respiracion, rangos controlados y foco en ${focusAreas.join(', ')}.`
  }
  if (context.startsWith('post_')) {
    return `10-15min post sesion: liberar ${focusAreas.join(', ')} con movilidad activa y reset articular.`
  }
  return `15-25min de flujo estructurado sobre ${focusAreas.join(', ')} con bloques breves y accionables.`
}

function describeIntervalStructure(
  intervalStructure: Pick<NonNullable<CoachSessionProposal['intervalStructure']>, 'blocks'> | undefined,
): string {
  const blocks = intervalStructure?.blocks ?? []
  if (blocks.length === 0) return 'Bloques de intensidad guiados por el coach con recuperacion activa entre repeticiones.'
  return blocks
    .slice(0, 3)
    .map((block) => {
      if (block.repetitions && block.distanceKm) return `${block.label}: ${block.repetitions}x${block.distanceKm}km`
      if (block.repetitions && block.durationMin) return `${block.label}: ${block.repetitions}x${block.durationMin}min`
      if (block.durationMin) return `${block.label}: ${block.durationMin}min`
      return block.label
    })
    .join(' + ')
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
