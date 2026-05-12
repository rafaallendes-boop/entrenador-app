import { subDays } from 'date-fns'
import { fromISO, toISO } from '../utils/date'
import { isCompetitionSquashMatch } from '../utils/squash'
import type {
  DayLog,
  GeneratedProtocol,
  ProtocolContext,
  ProtocolKind,
  ProtocolStep,
  Session,
  SessionType,
  SupportedSport,
} from '../types'

export interface ProtocolResolutionInputs {
  dayLog?: DayLog
  recentSessions?: Session[]
}

type LegacyProtocolBlock = {
  title?: unknown
  durationMin?: unknown
  steps?: unknown
}

export function resolveProtocolContext(
  session: Pick<Session, 'date' | 'timeBlock' | 'type' | 'subtype' | 'rpe' | 'runningDetails'>,
  kind: ProtocolKind,
  inputs: ProtocolResolutionInputs = {},
): ProtocolContext {
  const sport = resolveSport(session.type)
  const recentSessions = inputs.recentSessions ?? []
  const recentActiveSessions = recentSessions
    .filter((item) => item.status !== 'skipped')
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))

  const sessionDate = session.date
  const previousDates = new Set(
    recentActiveSessions
      .filter((item) => item.date < sessionDate)
      .map((item) => item.date),
  )

  let consecutiveTrainingDays = 1
  for (let i = 1; i <= 6; i += 1) {
    const prevDate = toISO(subDays(fromISO(sessionDate), i))
    if (!previousDates.has(prevDate)) break
    consecutiveTrainingDays += 1
  }

  const competitionCandidates = recentActiveSessions.filter((item) => {
    if (item.date < sessionDate) return false
    if (item.date === sessionDate && compareTimeBlocks(item.timeBlock, session.timeBlock) < 0) return false
    if (item.type !== sport) return false
    if (item.type === 'squash') return isCompetitionSquashMatch(item)
    return item.subtype === 'competitive'
  })

  const nextCompetition = competitionCandidates[0]
  const daysToCompetition = nextCompetition
    ? Math.max(0, Math.round((fromISO(nextCompetition.date).getTime() - fromISO(sessionDate).getTime()) / 86400000))
    : undefined

  return {
    kind,
    sport,
    sessionType: session.type,
    sessionSubtype: session.subtype,
    runningType: session.runningDetails?.runningType,
    plannedRpe: session.rpe,
    energyLevel: inputs.dayLog?.energyLevel,
    painLevel: inputs.dayLog?.painLevel,
    painNotes: inputs.dayLog?.painNotes,
    sleepHours: inputs.dayLog?.sleepHours,
    sleepQuality: inputs.dayLog?.sleepQuality,
    consecutiveTrainingDays,
    hasCompetitionSoon: daysToCompetition != null && daysToCompetition <= 2,
    daysToCompetition,
  }
}

function compareTimeBlocks(a: Session['timeBlock'], b: Session['timeBlock']): number {
  const order: Record<Session['timeBlock'], number> = {
    AM: 0,
    PM: 1,
  }
  return order[a] - order[b]
}

export function getBaseProtocolBySport(
  context: ProtocolContext,
): { warmup?: GeneratedProtocol; cooldown?: GeneratedProtocol } {
  const sport = context.sport ?? resolveProtocolSport(context.sessionType)

  switch (sport) {
    case 'squash':
      return {
        warmup: protocol(
          'Entrada progresiva en cancha',
          10,
          'Activa pies, cadera y timing antes de subir intensidad.',
          'general',
          [
            step('Movilidad dinámica de tobillo, cadera y torácica'),
            step('Skipping, desplazamientos laterales y split step progresivo'),
            step('Ghosting corto con foco en volver a la T'),
            step('Peloteo progresivo antes de la parte fuerte'),
          ],
        ),
        cooldown: protocol(
          'Descarga post-squash',
          7,
          'Baja pulsaciones y descarga piernas, cadera y hombro sin rebotes.',
          'recovery',
          [
            step('Camina 3-4 min y recupera la respiración'),
            step('Movilidad suave de gemelos, aductores y flexores de cadera'),
            step('Descarga de hombro, antebrazo y torácica'),
          ],
        ),
      }
    case 'running':
      return {
        warmup: protocol(
          'Activación de carrera',
          10,
          'Entra progresivo para correr suelto desde el inicio.',
          'general',
          [
            step('Movilidad dinámica de tobillo, cadera e isquios'),
            step('Trote suave 5-6 min'),
            step('Drills cortos: skipping, talones y 2 progresivos'),
          ],
        ),
        cooldown: protocol(
          'Salida de running',
          6,
          'Termina bajando carga y soltando piernas antes de quedarte quieto.',
          'recovery',
          [
            step('Trote muy suave o caminata 4-6 min'),
            step('Movilidad suave de gemelos, cadera e isquios'),
            step('Respiración y relajación de piernas'),
          ],
        ),
      }
    case 'cycling':
      return {
        warmup: protocol(
          'Entrada en calor en bici',
          10,
          'Sube la cadencia de forma progresiva antes del bloque principal.',
          'general',
          [
            step('Pedaleo muy suave 4-5 min'),
            step('Movilidad breve de cadera, tobillo y torácica'),
            step('2-3 aceleraciones cortas si la sesión exige intensidad'),
          ],
        ),
        cooldown: protocol(
          'Bajada de carga en bici',
          7,
          'Cierra con pedaleo muy fácil y descarga cadera, gemelos y espalda alta.',
          'recovery',
          [
            step('Pedaleo suave 5-7 min'),
            step('Movilidad de cadera, gemelos y torácica'),
            step('Relaja cuello y hombros si vienes de salida larga'),
          ],
        ),
      }
    case 'strength':
      return {
        warmup: protocol(
          'Preparación general para fuerza',
          12,
          'Calienta general primero y luego activa el patrón principal del día.',
          'general',
          [
            step('8-10 min de bici, trote o elíptica suave'),
            step('Movilidad de tobillo, cadera, torácica y hombro según el foco'),
            step('Series de aproximación del primer ejercicio'),
          ],
        ),
        cooldown: protocol(
          'Cierre post-fuerza',
          7,
          'Baja carga y suelta las zonas más exigidas sin convertirlo en otra sesión.',
          'recovery',
          [
            step('2-4 min de caminata o bici suave'),
            step('Movilidad ligera de las zonas trabajadas'),
            step('Respiración controlada y salida suave'),
          ],
        ),
      }
    case 'mobility':
      return {
        warmup: protocol(
          'Entrada articular',
          5,
          'Empieza suave y gana rango antes del bloque principal.',
          'general',
          [
            step('Respiración y movilidad articular global'),
            step('CARs suaves de hombro, cadera y columna'),
            step('Primeros movimientos controlados sin llegar al tope'),
          ],
        ),
        cooldown: protocol(
          'Cierre de movilidad',
          4,
          'Consolida el rango ganado y vuelve al día normal sin tensión.',
          'recovery',
          [
            step('Respiración lenta 1-2 min'),
            step('Movilidad suave final de la zona trabajada'),
            step('Camina un poco antes de seguir con el día'),
          ],
        ),
      }
    case 'recovery':
      return {
        warmup: protocol(
          'Activación suave',
          5,
          'Solo lo justo para mover sangre y entrar en calor sin cargar más.',
          'recovery',
          [
            step('Caminata o bici muy suave'),
            step('Movilidad breve de las zonas cargadas'),
            step('Respiración nasal y sensación de soltura'),
          ],
        ),
        cooldown: protocol(
          'Cierre de recuperación',
          4,
          'Termina suave para salir mejor de como entraste.',
          'recovery',
          [
            step('Respiración y caminata breve'),
            step('Movilidad ligera si queda rigidez'),
            step('Chequeo rápido de sensaciones'),
          ],
        ),
      }
    default:
      return getGeneralProtocols()
  }
}

export function buildWarmup(context: ProtocolContext): GeneratedProtocol | undefined {
  const base = getBaseProtocolBySport(context).warmup ?? getGeneralProtocols().warmup
  return base ? adaptProtocol(base, context) : undefined
}

export function buildCooldown(context: ProtocolContext): GeneratedProtocol | undefined {
  const base = getBaseProtocolBySport(context).cooldown ?? getGeneralProtocols().cooldown
  return base ? adaptProtocol(base, context) : undefined
}

export function adaptProtocol(protocol: GeneratedProtocol, context: ProtocolContext): GeneratedProtocol {
  const steps = [...protocol.steps]
  let durationMin = protocol.durationMin
  let tone = protocol.tone
  let note = protocol.note
  let title = protocol.title

  const lowReadiness =
    (context.energyLevel != null && context.energyLevel <= 4) ||
    (context.sleepHours != null && context.sleepHours < 6) ||
    (context.sleepQuality != null && context.sleepQuality <= 2)

  const protective =
    (context.painLevel != null && context.painLevel >= 4) ||
    Boolean(context.painNotes?.trim())

  const highDemand =
    (context.plannedRpe != null && context.plannedRpe >= 8) ||
    context.runningType === 'tempo' ||
    context.runningType === 'intervals' ||
    context.sessionSubtype === 'match' ||
    context.sessionSubtype === 'competitive'

  if (context.hasCompetitionSoon) {
    tone = 'competitive'
    durationMin = Math.max(5, durationMin - 2)
    title = context.kind === 'warmup' ? 'Activación pre-competitiva' : 'Salida post-competencia'
    note =
      context.kind === 'warmup'
        ? 'Por cercanía competitiva, hoy conviene activar sin generar fatiga extra.'
        : 'Tras una sesión o competencia exigente, baja carga y protege la recuperación.'
    if (context.kind === 'warmup') {
      steps.splice(steps.length - 1, 1, step('Termina con entradas específicas cortas y controladas'))
    }
  }

  if (protective) {
    tone = 'protective'
    durationMin = Math.max(5, durationMin - 2)
    note =
      context.kind === 'warmup'
        ? 'Hoy prioriza movilidad y activación controlada en vez de entrar agresivo.'
        : 'Hoy conviene un cierre más protector para soltar sin irritar la zona sensible.'
    steps.splice(0, steps.length, ...toProtectiveSteps(steps, context.kind))
  } else if (lowReadiness) {
    durationMin = Math.max(5, durationMin - 1)
    tone = tone === 'competitive' ? tone : 'recovery'
    note =
      context.kind === 'warmup'
        ? 'Como vienes con baja energía o sueño corto, entra progresivo y guarda la chispa para la sesión.'
        : 'Cierra suave y simple para facilitar la recuperación del día.'
  } else if (context.consecutiveTrainingDays >= 3) {
    durationMin = Math.max(6, durationMin)
    note =
      context.kind === 'warmup'
        ? 'Llevas varios días seguidos de entrenamiento: hoy conviene preparar mejor movilidad y activación ligera.'
        : 'Tras varios días seguidos, usa este cierre para descargar antes del siguiente estímulo.'
    if (context.kind === 'warmup' && steps.length < 5) {
      steps.push(step('Añade 1-2 minutos extra de movilidad de la zona más cargada'))
    }
  } else if (highDemand) {
    durationMin += 2
    note =
      context.kind === 'warmup'
        ? 'Hoy la sesión pide una entrada progresiva y específica antes del bloque principal.'
        : 'La sesión fue exigente: conviene bajar pulsaciones y soltar antes de cortar del todo.'
  }

  return {
    ...protocol,
    title,
    durationMin,
    note,
    tone,
    steps: steps.slice(0, 5),
    source: protocol.source === 'base' && (tone !== protocol.tone || note !== protocol.note || durationMin !== protocol.durationMin)
      ? 'adapted'
      : protocol.source,
  }
}

export function normalizeGeneratedProtocol(
  value: unknown,
  kind: ProtocolKind,
): GeneratedProtocol | undefined {
  if (!value) return undefined

  if (isGeneratedProtocol(value)) {
    return value
  }

  if (Array.isArray(value)) {
    const steps: ProtocolStep[] = []
    let duration = 0

    for (const item of value as LegacyProtocolBlock[]) {
      const title = typeof item?.title === 'string' ? item.title.trim() : ''
      if (typeof item?.durationMin === 'number' && Number.isFinite(item.durationMin)) {
        duration += item.durationMin
      }
      const rawSteps = Array.isArray(item?.steps) ? item.steps : []
      for (const step of rawSteps) {
        if (typeof step !== 'string' || !step.trim()) continue
        steps.push(stepProtocol(title ? `${title}: ${step.trim()}` : step.trim()))
      }
    }

    if (steps.length === 0) return undefined

    return {
      title: kind === 'warmup' ? 'Warm-up recomendado' : 'Cooldown recomendado',
      durationMin: duration > 0 ? duration : kind === 'warmup' ? 8 : 6,
      note: 'Protocolo adaptado desde una sesión creada con el formato anterior.',
      tone: kind === 'warmup' ? 'general' : 'recovery',
      steps,
      source: 'base',
    }
  }

  return undefined
}

export function resolveSessionProtocols(
  session: Session,
  inputs: ProtocolResolutionInputs = {},
): Pick<Session, 'warmup' | 'cooldown'> {
  const warmupContext = resolveProtocolContext(session, 'warmup', inputs)
  const cooldownContext = resolveProtocolContext(session, 'cooldown', inputs)

  const storedWarmup = normalizeGeneratedProtocol(session.warmup, 'warmup')
  const storedCooldown = normalizeGeneratedProtocol(session.cooldown, 'cooldown')

  return {
    warmup: storedWarmup ? adaptProtocol(storedWarmup, warmupContext) : buildWarmup(warmupContext),
    cooldown: storedCooldown ? adaptProtocol(storedCooldown, cooldownContext) : buildCooldown(cooldownContext),
  }
}

export function getProtocolSummary(protocol?: GeneratedProtocol): string | undefined {
  if (!protocol) return undefined
  const firstSteps = protocol.steps
    .slice(0, 2)
    .map((step) => step.label.toLowerCase())
    .join(' + ')
  return `${protocol.durationMin} min${firstSteps ? ` · ${firstSteps}` : ''}`
}

function protocol(
  title: string,
  durationMin: number,
  note: string,
  tone: GeneratedProtocol['tone'],
  steps: ProtocolStep[],
): GeneratedProtocol {
  return {
    title,
    durationMin,
    note,
    tone,
    steps,
    source: 'base',
  }
}

function step(label: string, detail?: string): ProtocolStep {
  return { label, detail }
}

function stepProtocol(label: string): ProtocolStep {
  return { label }
}

function resolveSport(type: SessionType): SupportedSport | undefined {
  switch (type) {
    case 'squash':
    case 'running':
    case 'cycling':
    case 'strength':
    case 'mobility':
      return type
    default:
      return undefined
  }
}

function resolveProtocolSport(type?: SessionType): SupportedSport | 'recovery' | 'general' {
  if (!type) return 'general'
  if (type === 'recovery') return 'recovery'
  return resolveSport(type) ?? 'general'
}

function getGeneralProtocols(): { warmup: GeneratedProtocol; cooldown: GeneratedProtocol } {
  return {
    warmup: protocol(
      'Activación general',
      8,
      'Haz una entrada progresiva y simple antes de la sesión.',
      'general',
      [
        step('Movilidad dinámica de las articulaciones principales'),
        step('2-4 minutos de movimiento suave'),
        step('1-2 repeticiones progresivas del gesto principal'),
      ],
    ),
    cooldown: protocol(
      'Vuelta a la calma',
      6,
      'Cierra con un descenso breve de carga y algo de movilidad suave.',
      'recovery',
      [
        step('Movimiento muy suave 3-4 minutos'),
        step('Respiración controlada'),
        step('Movilidad ligera de la zona más cargada'),
      ],
    ),
  }
}

function toProtectiveSteps(steps: ProtocolStep[], kind: ProtocolKind): ProtocolStep[] {
  const head = kind === 'warmup'
    ? [
        step('Empieza con movilidad suave y sin dolor'),
        step('Activa de forma progresiva la zona más sensible'),
        step('Sube intensidad solo si el cuerpo se siente suelto'),
      ]
    : [
        step('Baja pulsaciones con movimiento muy suave'),
        step('Descarga la zona sensible con movilidad controlada'),
        step('Evita rebotes o rangos forzados al terminar'),
      ]

  return [...head, ...steps.slice(0, 1)].slice(0, 4)
}

function isGeneratedProtocol(value: unknown): value is GeneratedProtocol {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.title === 'string' &&
    typeof row.durationMin === 'number' &&
    typeof row.note === 'string' &&
    typeof row.tone === 'string' &&
    Array.isArray(row.steps)
  )
}
