import { describe, expect, it } from 'vitest'

import { searchCatalog } from '../coachExerciseCatalog'
import {
  findStrengthExerciseByName,
  getExerciseById,
  normalizeStrengthExerciseKey,
  STRENGTH_EXERCISE_LIBRARY,
} from '../exerciseLibrary'
import { RENAMED_STRENGTH_IDS, REWRITTEN_DESCRIPTION_IDS } from './strengthCopyScope'

/**
 * Task 3 del plan 2026-08-01 (`strength-exercise-copy`): los 12 renombres
 * cerrados en el spec §4, copiados literalmente. El nombre anterior queda
 * como alias del mismo id, así que texto legado y el picker siguen
 * encontrando la misma entrada.
 */
export const RENAMES: Record<string, { previous: string; next: string }> = {
  air_treadmill_20_20: { previous: 'Trotadora de aire 20/20', next: 'Trotadora curva 20/20' },
  copenhagen_side_plank: { previous: 'Plancha lateral Copenhagen', next: 'Plancha Copenhagen' },
  dead_bug: { previous: 'Control de tronco dead bug', next: 'Dead bug — control de tronco' },
  half_kneeling_diagonal_plate_chop: {
    previous: 'Corte diagonal con disco medio arrodillado',
    next: 'Corte diagonal con disco en media rodilla',
  },
  half_kneeling_lateral_jump: {
    previous: 'Salto lateral medio arrodillado',
    next: 'Salto lateral desde media rodilla',
  },
  half_kneeling_row: { previous: 'Remo medio arrodillado', next: 'Remo en media rodilla' },
  ladder_bipodal_front_2: {
    previous: 'Escalera frontal – in-in-out-out',
    next: 'Escalera frontal – dentro-dentro-fuera-fuera',
  },
  ladder_bipodal_lateral_3: {
    previous: 'Escalera lateral – shuffle in-in-out',
    next: 'Escalera lateral – dentro-dentro-fuera',
  },
  landmine_press: { previous: 'Landmine press', next: 'Press con barra en landmine' },
  overhead_press: { previous: 'Press sobre cabeza', next: 'Press vertical' },
  push_press: { previous: 'Push press con impulso', next: 'Push press' },
  split_squat: { previous: 'Sentadilla en zancada', next: 'Zancada estática' },
}

describe('copy de fuerza — renombres (spec §4)', () => {
  it('la tabla de renombres tiene exactamente 12 filas, igual que el set congelado en Task 1', () => {
    expect(Object.keys(RENAMES)).toHaveLength(12)
    expect(new Set(Object.keys(RENAMES))).toEqual(RENAMED_STRENGTH_IDS)
  })

  it.each(Object.entries(RENAMES))('%s: nombre nuevo, alias legado y búsqueda del picker', (id, { previous, next }) => {
    const definition = getExerciseById(id)
    expect(definition).toBeDefined()
    expect(definition!.name).toBe(next)
    expect(definition!.aliases).toContain(previous)

    expect(findStrengthExerciseByName(previous)?.id).toBe(id)
    expect(findStrengthExerciseByName(next)?.id).toBe(id)

    expect(searchCatalog('strength', previous)).toContainEqual(
      expect.objectContaining({ libraryId: id }),
    )
  })

  it('ningún nombre o alias normalizado pertenece a dos ids distintos', () => {
    const owners = new Map<string, string>()
    const offenders: string[] = []

    for (const exercise of STRENGTH_EXERCISE_LIBRARY) {
      const keys = [exercise.name, ...(exercise.aliases ?? [])]
      for (const key of keys) {
        const normalized = normalizeStrengthExerciseKey(key)
        const owner = owners.get(normalized)
        if (owner != null && owner !== exercise.id) {
          offenders.push(`"${key}" → ${owner} vs ${exercise.id}`)
        }
        owners.set(normalized, exercise.id)
      }
    }

    expect(offenders).toEqual([])
  })

  it('los 77 nombres canónicos resuelven a su propio id', () => {
    const offenders = STRENGTH_EXERCISE_LIBRARY
      .filter((definition) => findStrengthExerciseByName(definition.name)?.id !== definition.id)
      .map((definition) => definition.id)

    expect(STRENGTH_EXERCISE_LIBRARY).toHaveLength(77)
    expect(offenders).toEqual([])
  })
})

/**
 * Task 4 del plan 2026-08-01 (`strength-exercise-copy`): las 31 descripciones
 * cerradas en el spec §5, copiadas literalmente carácter por carácter.
 */
export const FINAL_DESCRIPTIONS: Record<string, string> = {
  air_treadmill_20_20: 'Completa 4 minutos en una trotadora curva alternando 20 segundos fuertes y 20 segundos suaves. Busca aceleraciones cortas y una técnica rápida sin prolongar el esfuerzo.',
  alternating_step_up_jump: 'Sube de forma explosiva al cajón y cambia de pierna en el aire antes de aterrizar. Entrena potencia unilateral y ritmo; prioriza una recepción estable.',
  assault_bike_30_30: 'Completa 4 minutos en bici de asalto alternando 30 segundos fuertes y 30 segundos suaves. Mantén potencia alta y una postura estable durante cada esfuerzo.',
  barbell_jump_squat: 'Haz una sentadilla con barra y termina cada repetición con un salto. Usa una carga ligera —como máximo 30% de tu sentadilla trasera— y aterriza con control.',
  bb_reverse_lunge: 'Da una zancada hacia atrás con la barra en posición alta. Entrena desaceleración, control de cadera y fuerza en posiciones amplias de cancha.',
  clean: 'Lleva la barra desde el piso hasta los hombros mediante un tirón explosivo y una recepción estable. Es un movimiento avanzado: aprende la técnica antes de aumentar la carga.',
  clean_high_pull: 'Extiende cadera, rodillas y tobillos para realizar un tirón alto explosivo, sin recibir la barra en los hombros. Desarrolla potencia mientras se aprende la cargada completa.',
  close_grip_bench_press: 'Haz press banca con un agarre más cerrado que el habitual. Mantiene el patrón de empuje y aumenta el trabajo de tríceps sin cambiar el levantamiento principal.',
  copenhagen_side_plank: 'Mantén una plancha lateral con la pierna superior apoyada en un banco. Entrena aductores y estabilidad lateral; comienza con apoyo de rodilla antes de progresar al tobillo.',
  dead_bug: 'Acuéstate boca arriba y extiende de forma alternada un brazo y la pierna contraria sin perder la posición de la pelvis. Coordina la respiración con el control del tronco.',
  depth_jump: 'Déjate caer desde un cajón y enlaza el aterrizaje con un salto vertical alto. Es una pliometría avanzada de alta intensidad: usa muy pocas repeticiones y prioriza la calidad.',
  farmer_carry: 'Camina sosteniendo una mancuerna o kettlebell en cada mano. Mantén el tronco firme, los hombros estables y una marcha natural durante todo el recorrido.',
  goblet_squat: 'Sostén una mancuerna o kettlebell frente al pecho y realiza la sentadilla con el tronco estable. Es una opción accesible para practicar técnica o sumar volumen.',
  half_kneeling_diagonal_plate_chop: 'Desde media rodilla, mueve un disco en diagonal sin perder la posición de la pelvis. Mantén caderas y pies estables para que el control nazca del tronco.',
  half_kneeling_lateral_jump: 'Desde media rodilla, impulsa la cadera y salta lateralmente hasta una recepción estable. Entrena potencia en el plano frontal desde una posición baja.',
  half_kneeling_row: 'Desde media rodilla, tira de la polea, banda o mancuerna hacia el cuerpo. Mantén la pelvis estable y evita girar la cadera durante el remo.',
  hip_thrust: 'Apoya la espalda en un banco y extiende la cadera con la barra sobre la pelvis. Entrena fuerza de glúteos con transferencia a aceleraciones y saltos.',
  kettlebell_swing: 'Lleva la kettlebell hasta la altura del pecho mediante una extensión explosiva de cadera. El impulso nace de la bisagra, no de levantar el peso con los brazos.',
  ladder_bipodal_front_2: 'Entra con ambos pies en un cuadro y sácalos a los lados del siguiente antes de volver a entrar. Repite la secuencia dentro-dentro-fuera-fuera con ritmo y precisión.',
  ladder_bipodal_lateral_3: 'Avanza de costado entrando ambos pies en el cuadro y sacando uno antes del siguiente paso. Mantén la cadera baja y un ritmo lateral preciso.',
  ladder_coordinativo_front_4: 'Ejecuta el patrón Icky shuffle: dos apoyos dentro y uno fuera mientras avanzas en diagonal. Aumenta la velocidad solo cuando puedas conservar la precisión.',
  landmine_press: 'Empuja la barra en diagonal desde el hombro usando el anclaje landmine. Permite entrenar un press fuerte con menor demanda vertical y buen control del tronco.',
  lateral_band_walk: 'Da pasos laterales cortos con una banda en las rodillas o los tobillos. Mantén el tronco quieto y las rodillas alineadas con los pies.',
  overhead_press: 'Empuja la barra o las mancuernas en vertical hasta extender los brazos por encima de la cabeza. Mantén el tronco firme y controla la posición de los hombros.',
  pallof_press: 'Con una polea o banda tirando desde un costado, extiende los brazos al frente sin dejar que el tronco gire. Mantén tensión abdominal durante toda la repetición.',
  pogo_jumps: 'Encadena saltos verticales bajos usando principalmente los tobillos. Mantén poco tiempo de contacto con el suelo y una flexión mínima de rodillas para mejorar la respuesta del split-step.',
  push_press: 'Inicia el press con una flexión corta de piernas y transmite ese impulso a la barra o las mancuernas. Busca velocidad y una recepción estable por encima de la cabeza.',
  split_squat: 'Desde una zancada fija, baja y sube sin mover los pies de su posición inicial. Es un patrón unilateral accesible para aprender control y sumar volumen.',
  stability_ball_front_plank: 'Apoya los antebrazos sobre un fitball y mantén una plancha frontal estable. Controla la relación entre hombros y tronco; agrega círculos pequeños para aumentar la dificultad.',
  sumo_deadlift: 'Realiza el peso muerto con una separación amplia de pies y el agarre por dentro de las piernas. La variante aumenta la participación de aductores sin dejar de ser una bisagra pesada.',
  z_press: 'Sentado en el piso con las piernas extendidas, empuja la barra o las mancuernas en vertical. Mantén el tronco erguido para exponer y entrenar el control de hombros y zona media.',
}

describe('copy de fuerza — descripciones finales (spec §5)', () => {
  it('la tabla de descripciones tiene exactamente 31 filas, igual que el set congelado en Task 1', () => {
    expect(Object.keys(FINAL_DESCRIPTIONS)).toHaveLength(31)
    expect(new Set(Object.keys(FINAL_DESCRIPTIONS))).toEqual(REWRITTEN_DESCRIPTION_IDS)
  })

  it.each(Object.entries(FINAL_DESCRIPTIONS))('%s: descripción final exacta', (id, description) => {
    const definition = getExerciseById(id)
    expect(definition).toBeDefined()
    expect(definition!.description).toBe(description)
  })

  it('los 46 ids fuera de alcance conservan la descripción congelada en el snapshot de Task 1', () => {
    const offenders = STRENGTH_EXERCISE_LIBRARY
      .filter((definition) => !REWRITTEN_DESCRIPTION_IDS.has(definition.id))
      .filter((definition) => FINAL_DESCRIPTIONS[definition.id] !== undefined)

    expect(offenders).toEqual([])
    expect(
      STRENGTH_EXERCISE_LIBRARY.filter((definition) => !REWRITTEN_DESCRIPTION_IDS.has(definition.id)),
    ).toHaveLength(46)
  })
})

describe('copy de fuerza — guard de vocabulario (plan §4.2)', () => {
  const bannedDescriptionTerms: RegExp[] = [
    /\bstance\b/i,
    /\bsetup\b/i,
    /\btracking\b/i,
    /\bbracing\b/i,
    /\bsnap\b/i,
    /cachad/i,
    /\brepeat sprint\b/i,
    /\breps\b/i,
    /\boverhead\b/i,
    /\blunge\b/i,
    /\bfootwork\b/i,
    /\bstep-up\b/i,
  ]

  it('ningún `name`/`description` de los 77 ejercicios usa jerga en inglés retirada del copy', () => {
    const offenders: string[] = []

    for (const definition of STRENGTH_EXERCISE_LIBRARY) {
      const haystack = `${definition.name}\n${definition.description}`
      for (const pattern of bannedDescriptionTerms) {
        if (pattern.test(haystack)) {
          offenders.push(`${definition.id}: ${pattern} matched "${haystack}"`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
