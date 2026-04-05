import type { RunningType, Session, SessionType, SquashSubtype, WorkoutProtocolBlock } from '../types'

interface SessionProtocolContext {
  type: SessionType
  subtype?: SquashSubtype
  runningType?: RunningType
}

export function generateDefaultProtocols(context: SessionProtocolContext): Pick<Session, 'warmup' | 'cooldown'> {
  return {
    warmup: buildWarmup(context),
    cooldown: buildCooldown(context),
  }
}

export function ensureSessionProtocols<T extends {
  type: SessionType
  subtype?: SquashSubtype
  runningDetails?: { runningType?: RunningType }
  warmup?: WorkoutProtocolBlock[]
  cooldown?: WorkoutProtocolBlock[]
}>(session: T): T {
  const defaults = generateDefaultProtocols({
    type: session.type,
    subtype: session.subtype,
    runningType: session.runningDetails?.runningType,
  })

  return {
    ...session,
    warmup: session.warmup && session.warmup.length > 0 ? session.warmup : defaults.warmup,
    cooldown: session.cooldown && session.cooldown.length > 0 ? session.cooldown : defaults.cooldown,
  }
}

function buildWarmup({ type, subtype, runningType }: SessionProtocolContext): WorkoutProtocolBlock[] | undefined {
  switch (type) {
    case 'squash':
      return [
        {
          title: subtype === 'match' || subtype === 'competitive' ? 'Activacion pre-partido' : 'Movilidad dinamica',
          durationMin: subtype === 'match' || subtype === 'competitive' ? 8 : 10,
          steps: [
            'Movilidad dinamica de tobillo, cadera y toracica',
            'Skipping suave, desplazamientos laterales y split step progresivo',
            'Activacion de hombro y antebrazo con swings y swings cortos de raqueta',
          ],
        },
        {
          title: 'Entrada especifica en cancha',
          durationMin: subtype === 'match' || subtype === 'competitive' ? 8 : 10,
          steps: [
            'Ghosting tecnico corto con foco en volver al T',
            'Peloteo progresivo de drives y voleas antes de subir intensidad',
          ],
        },
      ]
    case 'running':
      return [
        {
          title: runningType === 'tempo' || runningType === 'intervals' ? 'Calentamiento progresivo' : 'Movilidad dinamica',
          durationMin: runningType === 'tempo' || runningType === 'intervals' ? 12 : 8,
          steps: [
            'Movilidad dinamica de tobillo, cadera e isquios',
            'Trote suave o caminata activa 5-8 min',
            'Drills de tecnica: skipping, talones a gluteos y 2-4 progresivos cortos',
          ],
        },
      ]
    case 'cycling':
      return [
        {
          title: 'Entrada en calor aerobia',
          durationMin: runningType === 'intervals' || runningType === 'tempo' ? 12 : 10,
          steps: [
            'Pedaleo suave con cadencia progresiva 5-8 min',
            'Movilidad dinamica de cadera, tobillo y columna toracica antes de subir carga',
            '2-3 aceleraciones cortas controladas si la sesion tiene bloques intensos',
          ],
        },
      ]
    case 'strength':
      return [
        {
          title: 'Calentamiento general',
          durationMin: 10,
          steps: [
            'Bici, trote o eliptica 10 min a intensidad suave',
            'Movilidad dinamica de tobillo, cadera, toracica y hombro segun el foco del dia',
          ],
        },
        {
          title: 'Activacion especifica',
          durationMin: 6,
          steps: [
            'Series de activacion con banda, gluteos, core y escápulas',
            'Series de aproximacion progresivas del primer ejercicio antes de la carga efectiva',
          ],
        },
      ]
    case 'mobility':
      return [
        {
          title: 'Entrada articular',
          durationMin: 5,
          steps: [
            'Respiracion y movilidad articular global suave',
            'CARs de hombro, cadera y columna antes del bloque principal',
          ],
        },
      ]
    case 'recovery':
      return [
        {
          title: 'Activacion suave',
          durationMin: 5,
          steps: [
            'Caminata o bici muy suave',
            'Movilidad dinamica corta de zonas cargadas',
          ],
        },
      ]
    default:
      return undefined
  }
}

function buildCooldown({ type, subtype, runningType }: SessionProtocolContext): WorkoutProtocolBlock[] | undefined {
  switch (type) {
    case 'squash':
      return [
        {
          title: 'Vuelta a la calma',
          durationMin: 6,
          steps: [
            'Caminar y bajar pulsaciones 3-5 min',
            'Respiracion nasal y descarga suave de piernas',
          ],
        },
        {
          title: 'Estiramientos post-sesion',
          durationMin: subtype === 'match' || subtype === 'competitive' ? 8 : 6,
          steps: [
            'Flexores de cadera, gemelos, aductores y gluteos',
            'Antebrazo, hombro y toracica sin rebotes',
          ],
        },
      ]
    case 'running':
      return [
        {
          title: 'Vuelta a la calma',
          durationMin: runningType === 'tempo' || runningType === 'intervals' ? 8 : 6,
          steps: [
            'Trote muy suave o caminata 5-8 min',
            'Bajar pulsaciones antes de detenerte por completo',
          ],
        },
        {
          title: 'Movilidad y estiramientos',
          durationMin: 6,
          steps: [
            'Gemelos, soleo, flexores de cadera, gluteos e isquios',
            'Movilidad suave de tobillo y cadera sin dolor',
          ],
        },
      ]
    case 'cycling':
      return [
        {
          title: 'Enfriamiento',
          durationMin: 8,
          steps: [
            'Pedaleo muy suave 5-8 min antes de bajarte',
            'Reducir progresivamente la cadencia y la resistencia',
          ],
        },
        {
          title: 'Movilidad post-ciclismo',
          durationMin: 6,
          steps: [
            'Flexores de cadera, gluteos, gemelos y toracica',
            'Movilidad suave de cuello y hombros si fue una salida larga',
          ],
        },
      ]
    case 'strength':
      return [
        {
          title: 'Bajada de carga',
          durationMin: 5,
          steps: [
            '2-5 min de bici o caminata suave para bajar pulsaciones',
            'Respiracion controlada antes de salir del gimnasio',
          ],
        },
        {
          title: 'Movilidad post-fuerza',
          durationMin: 8,
          steps: [
            'Estiramientos suaves de las zonas trabajadas',
            'Movilidad de cadera/tobillo en lower o hombro/toracica en upper',
          ],
        },
      ]
    case 'mobility':
      return [
        {
          title: 'Salida suave',
          durationMin: 4,
          steps: [
            'Respiracion lenta para consolidar el rango ganado',
            'Caminar 2-3 min antes de seguir con el dia',
          ],
        },
      ]
    case 'recovery':
      return [
        {
          title: 'Cierre de recuperacion',
          durationMin: 4,
          steps: [
            'Respiracion y caminata suave',
            'Chequeo rapido de sensaciones para ajustar el dia siguiente',
          ],
        },
      ]
    default:
      return undefined
  }
}
