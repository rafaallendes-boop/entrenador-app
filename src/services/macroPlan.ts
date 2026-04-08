/**
 * Deterministic local macro-plan computation.
 *
 * MacroPlan V2 keeps a single global phase governed by the primary event while
 * adding sport-specific focus for squash, running, and strength.
 */

import type {
  AthleteProfile,
  GoalEvent,
  MacroPlan,
  MacroPlanEventMarker,
  MacroPlanPhase,
  MacroPlanSportDetail,
  MacroPlanSportRole,
  MacroPlanTimelineEntry,
  SupportedSport,
} from '../types'
import { getAllowedPlanningSports, getPlanningPrimarySport } from './planningConstraints'
import { normalizeSport } from '../utils/athlete'

type SportPhaseRule = {
  phaseFocus: string
  weeklyIntent: string
  volumeBias: MacroPlanSportDetail['volumeBias']
  intensityBias: MacroPlanSportDetail['intensityBias']
  notes: string
}

type SportRuleSet = Record<MacroPlanPhase, { primary: SportPhaseRule; support: SportPhaseRule }>

const SPORT_DETAIL_ORDER: SupportedSport[] = ['squash', 'running', 'strength']

const GENERIC_PRIMARY_RULES: Record<MacroPlanPhase, SportPhaseRule> = {
  base: {
    phaseFocus: 'Construir base amplia del deporte principal con soporte general bien dosificado.',
    weeklyIntent: 'Acumular trabajo tecnico y fisico sin perseguir picos de intensidad todavia.',
    volumeBias: 'build',
    intensityBias: 'hold',
    notes: 'Semana de acumulacion general con margen para progresar.',
  },
  build: {
    phaseFocus: 'Subir especificidad del deporte principal y consolidar soporte util.',
    weeklyIntent: 'Aumentar calidad especifica sin dejar que el accesorio domine.',
    volumeBias: 'build',
    intensityBias: 'build',
    notes: 'La progresion prioriza continuidad y especificidad.',
  },
  peak: {
    phaseFocus: 'Afilar el deporte principal con maxima calidad y volumen controlado.',
    weeklyIntent: 'Priorizar sesiones clave y recortar todo lo que reste frescura.',
    volumeBias: 'reduce',
    intensityBias: 'build',
    notes: 'La calidad manda sobre la cantidad.',
  },
  taper: {
    phaseFocus: 'Reducir volumen y proteger frescura manteniendo sensaciones competitivas.',
    weeklyIntent: 'Mantener chispa del deporte principal con muy poca fatiga residual.',
    volumeBias: 'reduce',
    intensityBias: 'hold',
    notes: 'El objetivo es llegar disponible, no ganar fitness nuevo.',
  },
  race: {
    phaseFocus: 'Semana de evento con activacion, confianza y minima carga accesoria.',
    weeklyIntent: 'Usar solo estimulos cortos y utiles antes de competir.',
    volumeBias: 'minimal',
    intensityBias: 'hold',
    notes: 'Todo se subordina a competir fresco.',
  },
  transition: {
    phaseFocus: 'Bajar estres y rearmar base despues del evento.',
    weeklyIntent: 'Recuperar, descargar y volver gradualmente a una rutina liviana.',
    volumeBias: 'minimal',
    intensityBias: 'minimal',
    notes: 'Momento de reset y disponibilidad general.',
  },
}

const GENERIC_SUPPORT_RULES: Record<MacroPlanPhase, SportPhaseRule> = {
  base: {
    phaseFocus: 'Dar soporte general sin competir con el deporte principal.',
    weeklyIntent: 'Mantener una dosis util y sostenible de trabajo complementario.',
    volumeBias: 'hold',
    intensityBias: 'hold',
    notes: 'El complemento suma, no manda.',
  },
  build: {
    phaseFocus: 'Sostener soporte util mientras sube la especificidad principal.',
    weeklyIntent: 'Mantener frecuencia baja-media y evitar fatiga innecesaria.',
    volumeBias: 'hold',
    intensityBias: 'hold',
    notes: 'El trabajo accesorio debe quedar al servicio del bloque.',
  },
  peak: {
    phaseFocus: 'Reducir el accesorio y dejar solo lo que potencia la sesion clave.',
    weeklyIntent: 'Usar soporte minimo para no quitar calidad ni frescura.',
    volumeBias: 'reduce',
    intensityBias: 'reduce',
    notes: 'Toda la carga secundaria se cuestiona en peak.',
  },
  taper: {
    phaseFocus: 'Mantener soporte minimo y muy controlado.',
    weeklyIntent: 'Activar sin cansar ni agregar agujetas o fatiga residual.',
    volumeBias: 'minimal',
    intensityBias: 'minimal',
    notes: 'Si no aporta frescura o sensacion, sobra.',
  },
  race: {
    phaseFocus: 'Accesorio casi nulo durante la semana del evento.',
    weeklyIntent: 'Solo micro-activaciones si son claramente utiles.',
    volumeBias: 'minimal',
    intensityBias: 'minimal',
    notes: 'Semana de competir, no de desarrollar soporte.',
  },
  transition: {
    phaseFocus: 'Recuperacion activa como soporte post-evento.',
    weeklyIntent: 'Moverse suave y recuperar disponibilidad general.',
    volumeBias: 'minimal',
    intensityBias: 'minimal',
    notes: 'El objetivo es salir mejor del bloque, no seguir cargando.',
  },
}

const SPORT_RULES: Record<'squash' | 'running' | 'strength', SportRuleSet> = {
  squash: {
    base: {
      primary: {
        phaseFocus: 'Base tecnico-general de squash con volumen sostenible y calidad repetible.',
        weeklyIntent: 'Combinar tecnica, control y base fisica sin vivir todavia de match-play duro.',
        volumeBias: 'build',
        intensityBias: 'hold',
        notes: 'Priorizar repeticiones limpias, timing y desplazamiento util.',
      },
      support: {
        phaseFocus: 'Squash como soporte tecnico liviano del bloque principal.',
        weeklyIntent: 'Usar control tecnico o match-play medido sin robar carga al objetivo principal.',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'Complemento tecnico, no ancla del bloque.',
      },
    },
    build: {
      primary: {
        phaseFocus: 'Subir especificidad de squash con mas trabajo tactico, de match y de presion.',
        weeklyIntent: 'Elevar calidad de rally, lectura de juego y tolerancia a esfuerzos especificos.',
        volumeBias: 'build',
        intensityBias: 'build',
        notes: 'Mas especificidad de cancha y menos relleno general.',
      },
      support: {
        phaseFocus: 'Mantener squash como soporte especifico pero dosificado.',
        weeklyIntent: 'Usar una o dos exposiciones de calidad sin comprometer la disciplina principal.',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'La especificidad existe, pero la dosis manda.',
      },
    },
    peak: {
      primary: {
        phaseFocus: 'Afilar squash con calidad, pressure drills y sensacion real de partido.',
        weeklyIntent: 'Bajar volumen total y dejar solo las sesiones que eleven precision competitiva.',
        volumeBias: 'reduce',
        intensityBias: 'build',
        notes: 'Menos cantidad, mas sharpness y toma de T.',
      },
      support: {
        phaseFocus: 'Squash como activacion especifica corta y de alta utilidad.',
        weeklyIntent: 'Mantener contacto tecnico sin añadir fatiga competitiva extra.',
        volumeBias: 'reduce',
        intensityBias: 'hold',
        notes: 'Complemento breve, muy intencional.',
      },
    },
    taper: {
      primary: {
        phaseFocus: 'Llegar fresco a squash con activaciones tecnicas cortas y sin desgaste acumulado.',
        weeklyIntent: 'Mantener timing, precision y pies vivos con fatiga residual minima.',
        volumeBias: 'reduce',
        intensityBias: 'hold',
        notes: 'Control tecnico, activacion y nada de volumen inutil.',
      },
      support: {
        phaseFocus: 'Squash de soporte minimo durante taper.',
        weeklyIntent: 'Una dosis corta de sensaciones si suma al bloque principal.',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: 'Si genera cansancio, sobra.',
      },
    },
    race: {
      primary: {
        phaseFocus: 'Semana de competir en squash con activacion y foco mental.',
        weeklyIntent: 'Reservar energia para el partido o torneo y no llegar pesado.',
        volumeBias: 'minimal',
        intensityBias: 'hold',
        notes: 'Todo se orienta al rendimiento del dia clave.',
      },
      support: GENERIC_SUPPORT_RULES.race,
    },
    transition: {
      primary: {
        phaseFocus: 'Bajar carga de squash y recuperar despues del bloque competitivo.',
        weeklyIntent: 'Volver a sensaciones suaves antes de reconstruir volumen.',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: 'Recuperacion activa y reset tecnico.',
      },
      support: GENERIC_SUPPORT_RULES.transition,
    },
  },
  running: {
    base: {
      primary: {
        phaseFocus: 'Construir base aerobica de running con volumen estable y economia.',
        weeklyIntent: 'Acumular Z2, tecnica y regularidad antes de exigir demasiada intensidad.',
        volumeBias: 'build',
        intensityBias: 'hold',
        notes: 'Base primero, chispa despues.',
      },
      support: {
        phaseFocus: 'Running como soporte aerobico util para el bloque principal.',
        weeklyIntent: 'Usar volumen controlado y evitar que el running se coma la recuperacion.',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'El running suma capacidad de trabajo, no manda la semana.',
      },
    },
    build: {
      primary: {
        phaseFocus: 'Subir intensidad especifica de running sin perder soporte aerobico.',
        weeklyIntent: 'Combinar tempo, intervalos y fondo suficiente para consolidar rendimiento.',
        volumeBias: 'build',
        intensityBias: 'build',
        notes: 'Mas especificidad de ritmo con buena tolerancia de carga.',
      },
      support: {
        phaseFocus: 'Running de soporte con dosis baja-media y bien controlada.',
        weeklyIntent: 'Mantener motor aerobico sin competir con la disciplina principal.',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'En build de otro deporte, el running acompana.',
      },
    },
    peak: {
      primary: {
        phaseFocus: 'Afilar running con calidad controlada y menos volumen bruto.',
        weeklyIntent: 'Sostener sesiones clave, bajar carga basura y proteger frescura.',
        volumeBias: 'reduce',
        intensityBias: 'build',
        notes: 'La semana gira en torno a calidad especifica y economia.',
      },
      support: {
        phaseFocus: 'Running minimo como soporte en peak de otro deporte.',
        weeklyIntent: 'Usar solo trotes suaves o Z2 corta para no interferir.',
        volumeBias: 'reduce',
        intensityBias: 'minimal',
        notes: 'Nada de tempo o intervalos si running no es el foco.',
      },
    },
    taper: {
      primary: {
        phaseFocus: 'Bajar volumen de running y mantener chispa con minima fatiga.',
        weeklyIntent: 'Llegar liviano, con sensacion de ritmo y piernas frescas.',
        volumeBias: 'reduce',
        intensityBias: 'hold',
        notes: 'Se sostiene la sensacion, no la carga.',
      },
      support: {
        phaseFocus: 'Running residual y muy suave durante taper de otro deporte.',
        weeklyIntent: 'Usar solo recuperacion aerobica si realmente ayuda.',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: 'El running se vuelve recuperativo.',
      },
    },
    race: {
      primary: {
        phaseFocus: 'Semana de carrera con activacion especifica y minima fatiga.',
        weeklyIntent: 'Mantener confianza de ritmo y reservar energia para competir.',
        volumeBias: 'minimal',
        intensityBias: 'hold',
        notes: 'El rendimiento del evento define toda la semana.',
      },
      support: GENERIC_SUPPORT_RULES.race,
    },
    transition: {
      primary: {
        phaseFocus: 'Recuperar del bloque de running con movimiento suave y baja carga.',
        weeklyIntent: 'Volver a correr con comodidad antes de reconstruir trabajo serio.',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: 'Reset aerobico y articular.',
      },
      support: GENERIC_SUPPORT_RULES.transition,
    },
  },
  strength: {
    base: {
      primary: {
        phaseFocus: 'Construir fuerza general, estructura y tolerancia de trabajo.',
        weeklyIntent: 'Acumular fuerza util y tecnica solida sin perseguir picos neurales aun.',
        volumeBias: 'build',
        intensityBias: 'hold',
        notes: 'Base de patrones, consistencia y capacidad de carga.',
      },
      support: {
        phaseFocus: 'Fuerza de soporte general para sostener la disciplina principal.',
        weeklyIntent: 'Mantener patrones base y prevenir perdidas sin dominar la semana.',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'Complemento estructural y preventivo.',
      },
    },
    build: {
      primary: {
        phaseFocus: 'Subir fuerza-potencia especifica con foco en calidad de patrones principales.',
        weeklyIntent: 'Empujar fuerza util, velocidad de ejecucion y transferencia al objetivo.',
        volumeBias: 'build',
        intensityBias: 'build',
        notes: 'Menos dispersion, mas fuerza aplicable.',
      },
      support: {
        phaseFocus: 'Fuerza de apoyo bien dosificada durante build de otro deporte.',
        weeklyIntent: 'Mantener estimulo neural y estructural sin generar agujetas excesivas.',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'Soporte eficiente, no fatiga adicional.',
      },
    },
    peak: {
      primary: {
        phaseFocus: 'Bajar fatiga en fuerza y dejar estimulos neurales de alta calidad.',
        weeklyIntent: 'Mantener intensidad util con mucho menos volumen accesorio.',
        volumeBias: 'reduce',
        intensityBias: 'build',
        notes: 'La frescura neural vale mas que el tonelaje.',
      },
      support: {
        phaseFocus: 'Fuerza minima de soporte durante peak del bloque principal.',
        weeklyIntent: 'Una o dos exposiciones muy controladas sin DOMS ni residuo.',
        volumeBias: 'reduce',
        intensityBias: 'hold',
        notes: 'La fuerza acompana, no roba adaptacion.',
      },
    },
    taper: {
      primary: {
        phaseFocus: 'Mantener fuerza minima y sensacion neural sin cansancio residual.',
        weeklyIntent: 'Usar pocas series utiles y salir fresco de cada sesion.',
        volumeBias: 'minimal',
        intensityBias: 'hold',
        notes: 'Nada de hipertrofia ni acumulacion pesada en taper.',
      },
      support: {
        phaseFocus: 'Fuerza casi simbolica durante taper de otro deporte.',
        weeklyIntent: 'Activar sin generar agujetas ni tension innecesaria.',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: 'Solo mantenimiento si de verdad suma.',
      },
    },
    race: {
      primary: {
        phaseFocus: 'Semana de demostracion o evento con fuerza minima de activacion.',
        weeklyIntent: 'Preservar sensacion de potencia sin agotar el sistema.',
        volumeBias: 'minimal',
        intensityBias: 'hold',
        notes: 'Todo se orienta al rendimiento del evento.',
      },
      support: GENERIC_SUPPORT_RULES.race,
    },
    transition: {
      primary: {
        phaseFocus: 'Descargar fuerza y reconstruir disponibilidad post-bloque.',
        weeklyIntent: 'Mover patrones base con baja exigencia y salir de la fatiga acumulada.',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: 'Semana de reset estructural.',
      },
      support: GENERIC_SUPPORT_RULES.transition,
    },
  },
}

const PHASE_LABELS: Record<MacroPlanPhase, string> = {
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Taper',
  race: 'Evento',
  transition: 'Transición',
}

const PHASE_ORDER: MacroPlanPhase[] = ['base', 'build', 'peak', 'taper', 'race']

export function computeMacroPlan(
  profile: AthleteProfile | null | undefined,
  now?: Date,
): MacroPlan | undefined {
  const event = getPrimaryGoalEvent(profile)
  if (!event) return undefined

  const refDate = now ?? new Date()
  const weeksRemaining = computeWeeksRemaining(event.date, refDate)
  const currentPhase = resolvePhase(weeksRemaining)
  const primarySport = getPlanningPrimarySport(profile) ?? normalizeSport(event.sport)
  const allowedSports = getAllowedPlanningSports(profile)
  const detailSports = resolveDetailSports(primarySport, allowedSports)
  const sportDetails = detailSports.map((sport) =>
    buildSportDetail({
      sport,
      role: primarySport === sport ? 'primary' : 'support',
      phase: currentPhase,
    }),
  )
  const secondaryEvents = getSecondaryGoalEvents(profile)
    .map((goalEvent) => toEventMarker(goalEvent, refDate))
    .sort((a, b) => a.weeksFromReference - b.weeksFromReference)
  const blockFocus = sportDetails.find((detail) => detail.role === 'primary')?.phaseFocus ?? resolveBlockFocus(currentPhase)
  const headline = buildHeadline({
    phase: currentPhase,
    primarySport,
    primaryDetail: sportDetails.find((detail) => detail.role === 'primary'),
    secondaryEvents,
  })

  return {
    goalEventId: event.id,
    goalEventDate: event.date,
    currentPhase,
    weeksRemaining,
    blockFocus,
    headline,
    timeline: buildTimeline({
      weeksRemaining,
      currentPhase,
      secondaryEvents,
      primaryEvent: toEventMarker(event, refDate),
      primarySport,
    }),
    sportDetails,
    secondaryEvents,
    computedAt: Date.now(),
  }
}

export function getPrimaryGoalEvent(
  profile: AthleteProfile | null | undefined,
): GoalEvent | undefined {
  if (!profile?.goalEvents || profile.goalEvents.length === 0) return undefined

  return profile.goalEvents.find(
    (event) => event.priority === 'primary' && isValidGoalEvent(event),
  )
}

export function getSecondaryGoalEvents(
  profile: AthleteProfile | null | undefined,
): GoalEvent[] {
  if (!profile?.goalEvents || profile.goalEvents.length === 0) return []

  return profile.goalEvents
    .filter((event) => event.priority === 'secondary' && isValidGoalEvent(event))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function computeWeeksRemaining(eventDateISO: string, refDate: Date): number {
  const [y, m, d] = eventDateISO.split('-').map(Number)
  const eventDate = new Date(y, m - 1, d)
  const refNormalized = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate())

  const diffMs = eventDate.getTime() - refNormalized.getTime()
  const diffDays = diffMs / (24 * 60 * 60 * 1000)

  return Math.ceil(diffDays / 7)
}

export function resolvePhase(weeksRemaining: number): MacroPlanPhase {
  if (weeksRemaining < 0) return 'transition'
  if (weeksRemaining === 0) return 'race'
  if (weeksRemaining <= 4) return 'taper'
  if (weeksRemaining <= 8) return 'peak'
  if (weeksRemaining <= 12) return 'build'
  return 'base'
}

export function resolveBlockFocus(phase: MacroPlanPhase): string {
  return GENERIC_PRIMARY_RULES[phase].phaseFocus
}

export function getPhaseLabel(phase: MacroPlanPhase): string {
  return PHASE_LABELS[phase]
}

export function formatWeeksRemaining(weeks: number): string {
  if (weeks < 0) return 'Evento pasado'
  if (weeks === 0) return 'Esta semana'
  if (weeks === 1) return '1 semana'
  return `${weeks} semanas`
}

function resolveDetailSports(
  primarySport: SupportedSport | undefined,
  allowedSports: SupportedSport[],
): SupportedSport[] {
  const ordered = [...new Set([
    primarySport,
    ...allowedSports,
  ])]
    .filter((sport): sport is SupportedSport => sport != null)
    .filter((sport) => SPORT_DETAIL_ORDER.includes(sport))

  return ordered
}

function buildSportDetail(args: {
  sport: SupportedSport
  role: MacroPlanSportRole
  phase: MacroPlanPhase
}): MacroPlanSportDetail {
  const { sport, role, phase } = args
  const rules = getSportRuleSet(sport)
  const phaseRule = rules?.[phase]?.[role] ?? (role === 'primary' ? GENERIC_PRIMARY_RULES[phase] : GENERIC_SUPPORT_RULES[phase])

  return {
    sport,
    role,
    phaseFocus: phaseRule.phaseFocus,
    weeklyIntent: phaseRule.weeklyIntent,
    volumeBias: phaseRule.volumeBias,
    intensityBias: phaseRule.intensityBias,
    notes: phaseRule.notes,
  }
}

function getSportRuleSet(sport: SupportedSport): SportRuleSet | undefined {
  if (sport === 'squash' || sport === 'running' || sport === 'strength') {
    return SPORT_RULES[sport]
  }
  return undefined
}

function buildHeadline(args: {
  phase: MacroPlanPhase
  primarySport: SupportedSport | undefined
  primaryDetail: MacroPlanSportDetail | undefined
  secondaryEvents: MacroPlanEventMarker[]
}): string {
  const { phase, primarySport, primaryDetail, secondaryEvents } = args
  const sportLabel = primarySport ? formatSportLabel(primarySport) : 'deporte principal'
  const base = primaryDetail?.weeklyIntent ?? resolveBlockFocus(phase)

  if (secondaryEvents.length === 0) {
    return `${sportLabel}: ${base}`
  }

  const nextSecondary = secondaryEvents
    .filter((event) => event.weeksFromReference >= 0)
    .sort((a, b) => a.weeksFromReference - b.weeksFromReference)[0]

  if (!nextSecondary) {
    return `${sportLabel}: ${base}`
  }

  return `${sportLabel}: ${base} Evento secundario cercano: ${nextSecondary.title}.`
}

function buildTimeline(args: {
  weeksRemaining: number
  currentPhase: MacroPlanPhase
  secondaryEvents: MacroPlanEventMarker[]
  primaryEvent: MacroPlanEventMarker
  primarySport: SupportedSport | undefined
}): MacroPlanTimelineEntry[] {
  const { weeksRemaining, currentPhase, secondaryEvents, primaryEvent, primarySport } = args

  if (weeksRemaining < 0) {
    return [{
      phase: 'transition',
      startWeek: weeksRemaining,
      endWeek: weeksRemaining,
      label: getPhaseLabel('transition'),
      focus: resolveBlockFocus('transition'),
      isCurrent: currentPhase === 'transition',
      eventMarkers: [primaryEvent, ...secondaryEvents.filter((event) => event.weeksFromReference <= 0)],
    }]
  }

  const entries = PHASE_ORDER
    .map((phase) => {
      const range = getPhaseRange(phase)
      const intersection = intersectWeekRanges({ min: 0, max: weeksRemaining }, range)
      if (!intersection) return null

      const focus = primarySport
        ? buildSportDetail({ sport: primarySport, role: 'primary', phase }).phaseFocus
        : resolveBlockFocus(phase)
      const eventMarkers = [
        ...(phase === 'race' ? [primaryEvent] : []),
        ...secondaryEvents.filter((event) =>
          event.weeksFromReference <= intersection.max &&
          event.weeksFromReference >= intersection.min,
        ),
      ]

      return {
        phase,
        startWeek: intersection.max,
        endWeek: intersection.min,
        label: getPhaseLabel(phase),
        focus,
        isCurrent: phase === currentPhase,
        eventMarkers,
      } satisfies MacroPlanTimelineEntry
    })
    .filter((entry): entry is MacroPlanTimelineEntry => entry != null)

  return entries
}

function getPhaseRange(phase: MacroPlanPhase): { min: number; max: number } {
  switch (phase) {
    case 'base':
      return { min: 13, max: Number.MAX_SAFE_INTEGER }
    case 'build':
      return { min: 9, max: 12 }
    case 'peak':
      return { min: 5, max: 8 }
    case 'taper':
      return { min: 1, max: 4 }
    case 'race':
      return { min: 0, max: 0 }
    case 'transition':
      return { min: Number.MIN_SAFE_INTEGER, max: -1 }
  }
}

function intersectWeekRanges(
  a: { min: number; max: number },
  b: { min: number; max: number },
): { min: number; max: number } | null {
  const min = Math.max(a.min, b.min)
  const max = Math.min(a.max, b.max)
  return min <= max ? { min, max } : null
}

function toEventMarker(event: GoalEvent, refDate: Date): MacroPlanEventMarker {
  const weeksFromReference = computeWeeksRemaining(event.date, refDate)
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    sport: normalizeSport(event.sport),
    priority: event.priority,
    timing: weeksFromReference < 0 ? 'past' : weeksFromReference === 0 ? 'active' : 'upcoming',
    weeksFromReference,
  }
}

function formatSportLabel(sport: SupportedSport): string {
  switch (sport) {
    case 'strength':
      return 'Fuerza'
    case 'running':
      return 'Running'
    case 'cycling':
      return 'Ciclismo'
    case 'mobility':
      return 'Movilidad'
    default:
      return 'Squash'
  }
}

function isValidGoalEvent(event: GoalEvent): boolean {
  return Boolean(event.id && event.title.trim().length > 0 && isValidISODate(event.date))
}

function isValidISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}
