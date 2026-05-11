import type {
  SquashDrill,
  SquashDrillExecutionMode,
  SquashSessionBlockKind,
  SquashTrainingFocus,
} from '../../types'

export type DrillCategory = 'technical' | 'tactical' | 'physical' | 'match'
export type DrillIntensity = 'low' | 'moderate' | 'high'
export type DrillProgressionLevel = 1 | 2 | 3
export type DrillIntent = 'consistency' | 'pressure' | 'finishing' | 'recovery' | 'control'

export interface SquashDrillDefinition {
  id: string
  name: string
  category: DrillCategory
  focus: string[]
  intensity: DrillIntensity
  tags: string[]
  description: string
  intent?: DrillIntent
  constraints?: string[]
  progressionLevel?: DrillProgressionLevel
  executionMode?: SquashDrillExecutionMode
}

export function isSquashMatchDrill(value: Pick<SquashDrillDefinition, 'category' | 'tags'>): boolean {
  return value.category === 'match' || value.tags.includes('match_play')
}

export function isControlDrill(value: Pick<SquashDrillDefinition, 'tags'>): boolean {
  return value.tags.includes('control_session') || value.tags.includes('solo') || value.tags.includes('volume_reps')
}

export function isShadowsDrill(value: Pick<SquashDrillDefinition, 'category' | 'tags' | 'focus'>): boolean {
  return value.category === 'physical' && (
    value.tags.includes('ghosting') ||
    value.tags.includes('footwork') ||
    value.focus.includes('ghosting')
  )
}

export function resolveDrillExecutionMode(
  definition: Pick<SquashDrillDefinition, 'category' | 'tags' | 'executionMode'>,
): SquashDrillExecutionMode {
  if (definition.executionMode) return definition.executionMode
  if (definition.category === 'match' || definition.tags.includes('match_play')) return 'match'
  if (
    definition.tags.includes('solo') ||
    definition.tags.includes('volume_reps') ||
    definition.tags.includes('ghosting') ||
    definition.tags.includes('footwork')
  ) {
    return 'solo'
  }
  if (
    definition.tags.includes('conditioned_game') ||
    definition.tags.includes('multiball') ||
    definition.tags.includes('practice')
  ) {
    return 'partner'
  }
  if (definition.tags.includes('control_session')) return 'either'
  return 'either'
}

export function resolveSquashDrillKind(definition: SquashDrillDefinition): SquashSessionBlockKind {
  if (isSquashMatchDrill(definition)) return 'match'
  if (isShadowsDrill(definition)) return 'shadows'
  if (isControlDrill(definition)) return 'control'
  return 'technical'
}

export function orderSquashDrillsForSession<T extends { name: string }>(
  drills: T[],
  resolveDefinition: (drill: T) => SquashDrillDefinition | undefined = (drill) => findSquashDrillByName(drill.name),
): T[] {
  const regular = drills.filter((drill) => !isSquashMatchDrill(resolveDefinition(drill) ?? { category: 'technical', tags: [] }))
  const matches = drills.filter((drill) => isSquashMatchDrill(resolveDefinition(drill) ?? { category: 'technical', tags: [] }))
  return [...regular, ...matches]
}

export function orderSquashBlocksForSession<T extends { kind: SquashSessionBlockKind }>(blocks: T[]): T[] {
  const order: Record<SquashSessionBlockKind, number> = {
    shadows: 0,
    technical: 1,
    control: 2,
    match: 3,
  }
  return [...blocks].sort((a, b) => order[a.kind] - order[b.kind])
}

export const SQUASH_DRILL_LIBRARY: SquashDrillDefinition[] = [
  {
    id: 'drive_parallel_depth',
    name: 'Tiros paralelos profundos',
    category: 'technical',
    focus: ['drive', 'length', 'control'],
    intensity: 'moderate',
    tags: ['parallel', 'drive', 'base', 'build', 'length', 'length_control'],
    description: 'Golpea paralelo desde el fondo hacia la esquina del fondo del mismo lado. El objetivo es que la pelota llegue profunda y cerca de la pared lateral de forma repetida.',
    intent: 'consistency',
    constraints: ['La pelota debe pasar alta por la pared frontal y llegar detrás del cuadro de saque'],
    progressionLevel: 1,
  },
  {
    id: 'drive_crosscourt_length',
    name: 'Tiros cruzados profundos',
    category: 'technical',
    focus: ['drive', 'crosscourt', 'length'],
    intensity: 'moderate',
    tags: ['crosscourt', 'drive', 'base', 'build', 'length', 'length_control'],
    description: 'Golpea cruzado desde un lado hacia la esquina profunda contraria. Busca que el rival tenga que moverse al fondo y que la pelota no quede corta en media cancha.',
    intent: 'control',
    progressionLevel: 1,
  },
  {
    id: 'drive_switch_parallel_cross',
    name: 'Cambio de paralelo a cruzado',
    category: 'technical',
    focus: ['drive', 'transition', 'precision'],
    intensity: 'moderate',
    tags: ['parallel', 'crosscourt', 'drive', 'build', 'variation'],
    description: 'Alterna un tiro paralelo y uno cruzado desde el fondo o media cancha. La meta es cambiar dirección sin que la pelota quede corta ni te saque del centro.',
    progressionLevel: 2,
  },
  {
    id: 'boast_to_straight_drive',
    name: 'Boast y drive paralelo de salida',
    category: 'technical',
    focus: ['boast', 'drive', 'recovery'],
    intensity: 'moderate',
    tags: ['boast', 'drive', 'build', 'recovery_technical'],
    description: 'Juega un boast (pared lateral hacia el frente) y responde con un drive paralelo profundo. Tienes que salir del rincón y recuperar la T antes del siguiente golpe.',
    progressionLevel: 2,
  },
  {
    id: 'drop_and_counter_drop',
    name: 'Drop y contra-drop por ambos lados',
    category: 'technical',
    focus: ['drop', 'touch', 'front_court'],
    intensity: 'low',
    tags: ['drop', 'front_court', 'taper', 'recovery_technical', 'control_session'],
    description: 'Desde la zona delantera, juega un drop corto y responde con otro drop del mismo lado o cruzado. Busca que la pelota bote baja y obligue al rival a entrar al frente.',
    progressionLevel: 1,
  },
  {
    id: 'solo_100_drops',
    name: '100 drops en solitario (50 por lado)',
    category: 'technical',
    focus: ['drop', 'touch', 'front_court'],
    intensity: 'low',
    tags: ['drop', 'front_court', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper', 'recovery_technical'],
    description: 'Sin rival: 100 drops desde la zona delantera, 50 por lado. La pelota debe quedar baja y morir antes del cuadro de saque. Ejercicio de control y sensación de manos; no apurar el contacto.',
    intent: 'control',
    constraints: ['50 repeticiones por lado', 'La segunda bote debe quedar antes del cuadro de saque'],
    progressionLevel: 1,
  },
  {
    id: 'solo_100_mid_court_shots',
    name: '100 drives desde media cancha',
    category: 'technical',
    focus: ['midcourt', 'length', 'precision'],
    intensity: 'low',
    tags: ['midcourt', 'length', 'precision', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper'],
    description: 'Desde media cancha, golpea 100 drives alternando paralelo y cruzado. Contacta delante del pie delantero y manda la pelota a una zona profunda clara.',
    intent: 'control',
    constraints: ['Alternar paralelo y cruzado cada 10 golpes', 'Contactar la pelota delante del pie delantero'],
    progressionLevel: 1,
  },
  {
    id: 'solo_100_service_box',
    name: '100 drives al cuadro de saque',
    category: 'technical',
    focus: ['target', 'length', 'precision'],
    intensity: 'low',
    tags: ['target', 'length', 'precision', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper'],
    description: 'Juega 100 drives hacia un objetivo dentro del cuadro de saque del lado elegido. Cuenta como buena solo la pelota que cae o pasa por la zona marcada. 50 repeticiones por lado; marca un cono o cinta como target.',
    intent: 'control',
    constraints: ['Marcar un objetivo visible dentro del cuadro de saque', '50 repeticiones por lado'],
    progressionLevel: 1,
  },
  {
    id: 'solo_100_parallels_back',
    name: '100 drives paralelos desde el fondo',
    category: 'technical',
    focus: ['drive', 'parallel', 'length'],
    intensity: 'moderate',
    tags: ['drive', 'parallel', 'length', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper'],
    description: 'Desde el fondo, juega 100 drives paralelos pegados a la pared lateral. La repetición es buena si la pelota llega profunda y no queda fácil en media cancha. Mantén la pelota a menos de una raqueta de la pared lateral.',
    intent: 'control',
    constraints: ['Mantener la pelota a menos de una raqueta de la pared lateral', '50 repeticiones por lado'],
    progressionLevel: 1,
  },
  {
    id: 'mid_court_drops',
    name: 'Drops desde media cancha',
    category: 'technical',
    focus: ['drop', 'transition', 'touch'],
    intensity: 'low',
    tags: ['drop', 'transition', 'touch', 'control_session', 'base', 'build', 'taper', 'recovery_technical'],
    description: 'Desde media cancha, juega drops hacia la esquina delantera del mismo lado. Baja la velocidad de la pelota sin cambiar tu preparación de forma evidente.',
    intent: 'control',
    constraints: ['No acelerar el brazo para fabricar el drop', 'La pelota debe botar antes del cuadro de saque'],
    progressionLevel: 1,
  },
  {
    id: 'solo_volleys_only',
    name: 'Voleas en solitario',
    category: 'technical',
    focus: ['volley', 'control', 'timing'],
    intensity: 'low',
    tags: ['volley', 'control', 'timing', 'solo', 'control_session', 'base', 'build', 'taper'],
    description: 'Volea sin dejar botar la pelota, manteniéndola frente a ti y por encima de la chapa. Encadena contactos limpios sin apurarte ni golpear fuerte.',
    intent: 'control',
    constraints: ['Contactar la pelota delante del cuerpo', 'Completar series de 20 contactos sin perder control'],
    progressionLevel: 1,
  },
  {
    id: 'volley_control_midcourt',
    name: 'Volea de control desde media cancha',
    category: 'technical',
    focus: ['volley', 'control', 'midcourt'],
    intensity: 'moderate',
    tags: ['volley', 'control', 'midcourt', 'base', 'build'],
    description: 'Desde media cancha, volea hacia una zona profunda sin dejar que la pelota caiga. La meta es tomarla temprano y mantenerte estable después del golpe.',
    progressionLevel: 1,
  },
  {
    id: 'volley_pressure_front_wall',
    name: 'Volea ofensiva desde media cancha',
    category: 'technical',
    focus: ['volley', 'pressure', 'attack'],
    intensity: 'moderate',
    tags: ['volley', 'pressure', 'attack', 'build', 'peak'],
    description: 'Desde media cancha o cerca del T, volea temprano hacia una esquina profunda o una pelota corta clara. El objetivo es quitarle tiempo al rival y dejarlo golpeando incómodo.',
    progressionLevel: 2,
  },
  {
    id: 'volley_t_recover',
    name: 'Volea y vuelta a la T',
    category: 'tactical',
    focus: ['volley', 't_control', 'recovery'],
    intensity: 'moderate',
    tags: ['volley', 't_control', 'build', 'peak'],
    description: 'Volea desde media cancha y vuelve a la T apenas termines el golpe. El ejercicio está bien hecho si llegas al centro antes de que salga la siguiente pelota.',
    intent: 'recovery',
    constraints: ['Recuperar a la T antes del siguiente golpe'],
    progressionLevel: 2,
  },
  {
    id: 't_control_long_short',
    name: 'Patrón largo-corto desde la T',
    category: 'tactical',
    focus: ['t_control', 'long_short', 'pressure'],
    intensity: 'moderate',
    tags: ['t_control', 'long_short', 'conditioned_game', 'build', 'peak'],
    description: 'Desde la T, alterna una pelota profunda al fondo y una pelota corta al frente. El objetivo es mover al rival hacia atrás y adelante sin perder tu posición central.',
    progressionLevel: 2,
  },
  {
    id: 'attack_from_t_first_ball',
    name: 'Atacar la primera pelota cómoda desde la T',
    category: 'tactical',
    focus: ['t_control', 'attack', 'initiative'],
    intensity: 'high',
    tags: ['t_control', 'attack', 'peak', 'initiative'],
    description: 'Desde la T, espera una pelota que llegue cómoda a media cancha y atácala hacia una esquina o un drop claro. La meta es reconocer la pelota atacable y jugarla antes de que baje demasiado.',
    progressionLevel: 3,
  },
  {
    id: 'pressure_back_corners',
    name: 'Presión a esquinas de fondo',
    category: 'tactical',
    focus: ['pressure', 'back_court', 'length'],
    intensity: 'moderate',
    tags: ['pressure', 'back_court', 'build', 'peak'],
    description: 'Juega pelotas profundas alternando las dos esquinas del fondo. El objetivo es que el rival golpee desde atrás del cuadro de saque y no pueda entrar cómodo a la T.',
    progressionLevel: 2,
  },
  {
    id: 'pressure_back_court',
    name: 'Juego condicionado solo al fondo (intenso)',
    category: 'tactical',
    focus: ['conditioned_game', 'pressure', 'back_court'],
    intensity: 'high',
    tags: ['conditioned_game', 'pressure', 'back_court', 'build', 'peak'],
    description: 'Juega puntos donde ambos deben mandar la mayoría de las pelotas al fondo. Mantén al rival detrás del cuadro de saque y espera una pelota corta para atacar.',
    intent: 'pressure',
    constraints: ['La pelota debe llegar detrás del cuadro de saque antes de atacar corto', 'Buscar que el rival golpee desde el fondo'],
    progressionLevel: 3,
  },
  {
    id: 'pressure_three_quarters_court',
    name: 'Ataque desde tres cuartos de cancha',
    category: 'tactical',
    focus: ['transition', 'pressure', 'mid_court'],
    intensity: 'high',
    tags: ['transition', 'pressure', 'mid_court', 'conditioned_game', 'build', 'peak'],
    description: 'Juega desde la zona entre media cancha y el fondo, tomando la pelota temprano antes de que se meta atrás. El objetivo es avanzar hacia el T y atacar la siguiente pelota en la mitad delantera.',
    intent: 'pressure',
    constraints: ['Tomar la pelota antes de que llegue a la esquina del fondo', 'Volver al T después de cada golpe'],
    progressionLevel: 3,
  },
  {
    id: 'conditioned_parallel_only',
    name: 'Juego condicionado solo paralelo',
    category: 'tactical',
    focus: ['conditioned_game', 'parallel', 'order'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'parallel', 'build', 'peak'],
    description: 'Juega puntos donde solo valen los tiros paralelos por la pared lateral del mismo lado. El objetivo es controlar dirección y profundidad sin regalar una pelota al centro.',
    progressionLevel: 1,
  },
  {
    id: 'conditioned_long_only',
    name: 'Juego condicionado solo al fondo',
    category: 'tactical',
    focus: ['conditioned_game', 'length', 'pressure'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'length', 'length_control', 'pressure', 'base', 'build'],
    description: 'Juega puntos sin pelotas cortas: cada golpe debe buscar una zona profunda. El objetivo es sostener paciencia y profundidad hasta que aparezca una pelota claramente atacable.',
    intent: 'control',
    constraints: ['Lograr 6 golpes profundos seguidos antes de cambiar el ritmo'],
    progressionLevel: 1,
  },
  {
    id: 'conditioned_no_two_bounces',
    name: 'Juego condicionado en media cancha',
    category: 'tactical',
    focus: ['conditioned_game', 'intensity', 'speed'],
    intensity: 'high',
    tags: ['conditioned_game', 'speed', 'peak', 'pressure'],
    description: 'Juega puntos donde la pelota no puede pasar detrás del cuadro de saque. El objetivo es reaccionar rápido, tomar la pelota temprano y sostener intercambios intensos en media cancha.',
    constraints: ['La pelota que pasa detrás del cuadro de saque pierde el punto'],
    progressionLevel: 3,
  },
  {
    id: 'conditioned_forbidden_zone',
    name: 'Juego condicionado con zona prohibida',
    category: 'tactical',
    focus: ['conditioned_game', 'targets', 'decision_making'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'targets', 'build', 'peak'],
    description: 'Marca una zona prohibida y juega puntos sin enviar la pelota ahí. El objetivo es elegir trayectorias alternativas que sigan moviendo al rival sin usar esa zona.',
    constraints: ['La pelota que cae en la zona prohibida pierde el punto'],
    progressionLevel: 2,
  },
  {
    id: 'conditioned_boast_start',
    name: 'Punto que inicia con pared lateral',
    category: 'tactical',
    focus: ['conditioned_game', 'boast', 'transition'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'boast', 'transition', 'build'],
    description: 'Cada punto empieza con una pelota jugada a la pared lateral para llevarla al frente. El objetivo es salir de esa primera situación, recuperar el T y jugar el punto ordenado.',
    progressionLevel: 2,
  },
  {
    id: 'front_back_transition',
    name: 'Transición frente-fondo con vuelta a la T',
    category: 'tactical',
    focus: ['transition', 'recovery', 'court_coverage'],
    intensity: 'moderate',
    tags: ['transition', 'court_coverage', 'build', 'peak'],
    description: 'Alterna una pelota corta al frente y una pelota profunda al fondo, volviendo a la T después de cada golpe. La meta es cubrir toda la cancha sin quedar detenido en una esquina.',
    progressionLevel: 2,
  },
  {
    id: 'ghosting_4_corners',
    name: 'Ghosting a cuatro esquinas',
    category: 'physical',
    focus: ['ghosting', 'movement', 'conditioning'],
    intensity: 'moderate',
    tags: ['ghosting', 'movement', 'base', 'build'],
    description: 'Muévete desde la T hacia las cuatro esquinas sin pelota, simulando el golpe en cada una. Llega equilibrado y vuelve a la T con el mismo ritmo.',
    intent: 'consistency',
    constraints: ['Llegar equilibrado a cada esquina', 'Volver a la T después de cada desplazamiento'],
    progressionLevel: 1,
  },
  {
    id: 'ghosting_6_points',
    name: 'Ghosting a seis puntos',
    category: 'physical',
    focus: ['ghosting', 'movement', 'speed'],
    intensity: 'high',
    tags: ['ghosting', 'movement', 'speed', 'build', 'peak'],
    description: 'Muévete sin pelota desde la T hacia seis zonas: frente, media cancha y fondo por ambos lados. Mantén pasos rápidos sin perder postura ni vuelta al centro.',
    progressionLevel: 2,
  },
  {
    id: 'split_step_t_recovery',
    name: 'Split-step y vuelta a la T',
    category: 'physical',
    focus: ['footwork', 't_control', 'reaction'],
    intensity: 'moderate',
    tags: ['footwork', 't_control', 'build', 'taper'],
    description: 'Haz un pequeño split-step de reacción, sal hacia una esquina indicada y vuelve a la T. Inicia el movimiento justo al leer la dirección y no te quedes parado después del golpe simulado.',
    intent: 'recovery',
    progressionLevel: 1,
  },
  {
    id: 'rsa_short_bursts',
    name: 'RSA – sprints repetidos de 10-15 segundos',
    category: 'physical',
    focus: ['rsa', 'conditioning', 'repeat_sprint'],
    intensity: 'high',
    tags: ['rsa', 'conditioning', 'peak', 'speed'],
    description: 'Bloques de 10 a 15 segundos moviéndote explosivo entre la T y las esquinas. El objetivo es repetir esfuerzos rápidos con técnica estable aunque la recuperación sea corta.',
    progressionLevel: 3,
  },
  {
    id: 'multiball_pressure_finishes',
    name: 'Multibola para presionar y cerrar',
    category: 'physical',
    focus: ['multiball', 'pressure', 'finish'],
    intensity: 'high',
    tags: ['multiball', 'pressure', 'peak', 'attack'],
    description: 'El alimentador entrega varias pelotas seguidas y debes jugar profundo hasta recibir una pelota atacable. El objetivo es cerrar con un drop, ángulo o pelota ganadora sin apurarte antes de tiempo.',
    intent: 'pressure',
    progressionLevel: 3,
  },
  {
    id: 'defensive_high_lob_recovery',
    name: 'Lob defensivo alto y recuperación',
    category: 'technical',
    focus: ['lob', 'recovery', 'back_court'],
    intensity: 'low',
    tags: ['lob', 'recovery_technical', 'base', 'build', 'taper', 'back_court'],
    description: 'Desde una posición incómoda, juega un lob alto hacia el fondo para ganar tiempo. Vuelve a la T antes de que el rival golpee.',
    intent: 'recovery',
    constraints: ['La pelota debe pasar alta y llegar al fondo', 'Recuperar a la T antes del siguiente golpe'],
    progressionLevel: 1,
  },
  {
    id: 'attacking_lob_change_of_pace',
    name: 'Lob ofensivo como cambio de ritmo',
    category: 'technical',
    focus: ['lob', 'attack', 'variation'],
    intensity: 'moderate',
    tags: ['lob', 'attack', 'build', 'peak', 'variation'],
    description: 'Desde media cancha o el frente, juega un lob alto hacia el fondo cuando el rival espera una pelota rápida. Sácalo de la T y prepara la siguiente pelota corta o profunda.',
    intent: 'control',
    constraints: ['Usar la misma preparación que para una pelota corta', 'Jugar la siguiente pelota hacia la zona que quede libre'],
    progressionLevel: 2,
  },
  {
    id: 'attacking_boast_from_mid_court',
    name: 'Boast ofensivo desde media cancha',
    category: 'technical',
    focus: ['boast', 'attack', 'mid_court'],
    intensity: 'moderate',
    tags: ['boast', 'attack', 'mid_court', 'build', 'peak', 'pressure'],
    description: 'Desde media cancha, juega un boast para que la pelota llegue baja al frente. Avanza y toma la siguiente pelota antes de que el rival se acomode.',
    intent: 'pressure',
    constraints: ['Después del golpe, recuperar hacia adelante', 'Intentar cerrar el punto dentro de los 3 golpes siguientes'],
    progressionLevel: 2,
  },
  {
    id: 'attacking_boast_from_back_court',
    name: 'Boast ofensivo desde el fondo',
    category: 'technical',
    focus: ['boast', 'attack', 'back_court'],
    intensity: 'high',
    tags: ['boast', 'attack', 'back_court', 'build', 'peak', 'pressure'],
    description: 'Desde el fondo, juega un boast con intención ofensiva para llevar la pelota al frente. Obliga al rival a correr hacia adelante y deja una respuesta atacable.',
    intent: 'pressure',
    constraints: ['La pelota debe salir cerca de la pared lateral', 'Prepararse para cortar temprano la siguiente pelota'],
    progressionLevel: 3,
  },
  {
    id: 'front_court_angle_finish',
    name: 'Definición con ángulo en zona delantera',
    category: 'technical',
    focus: ['angle', 'front_court', 'finish'],
    intensity: 'moderate',
    tags: ['angle', 'front_court', 'finish', 'build', 'peak'],
    description: 'Desde la zona delantera, juega una pelota con ángulo hacia la pared lateral o la esquina baja. La pelota debe alejarse del rival y cerrar el punto antes de que recupere posición.',
    intent: 'finishing',
    constraints: ['Mantener la preparación hasta el último momento', 'Intentar cerrar el punto dentro de 3 golpes'],
    progressionLevel: 2,
  },
  {
    id: 'nick_pressure_closure',
    name: 'Nick: cierre a la unión baja',
    category: 'technical',
    focus: ['nick', 'finish', 'precision'],
    intensity: 'moderate',
    tags: ['nick', 'angle', 'finish', 'build', 'peak', 'pressure'],
    description: 'Después de mover al rival, ataca el nick (unión entre pared lateral y frontal). La pelota debe salir baja o morir cerca de la esquina.',
    intent: 'finishing',
    constraints: ['Atacar solo cuando llegues equilibrado', 'Usar una marca visual cerca de la esquina baja'],
    progressionLevel: 3,
  },
  {
    id: 'continuous_squash_movement_base',
    name: 'Movimiento continuo de base aeróbica',
    category: 'physical',
    focus: ['movement', 'aerobic_base', 'conditioning'],
    intensity: 'low',
    tags: ['movement', 'conditioning', 'aerobic_base', 'base', 'build'],
    description: 'Muévete continuo desde la T hacia distintas zonas de la cancha sin acelerar al máximo. Sostén ritmo, postura y respiración estable durante todo el bloque.',
    intent: 'consistency',
    constraints: ['Mantener el mismo ritmo durante todo el intervalo', 'Volver a la T después de cada movimiento'],
    progressionLevel: 1,
  },
  {
    id: 'extensive_aerobic_movement_intervals',
    name: 'Intervalos aeróbicos en cancha',
    category: 'physical',
    focus: ['movement', 'aerobic_base', 'tempo'],
    intensity: 'moderate',
    tags: ['movement', 'conditioning', 'aerobic_base', 'base', 'build'],
    description: 'Intervalos largos moviéndote entre la T, el frente y el fondo a ritmo controlado. Termina cada bloque con la misma calidad de pasos con la que empezaste.',
    intent: 'control',
    constraints: ['Mantener el mismo ritmo del primer al último intervalo', 'Terminar cada bloque con postura limpia en la T'],
    progressionLevel: 2,
  },
  {
    id: 'technical_recovery_length',
    name: 'Largo controlado de baja carga',
    category: 'technical',
    focus: ['recovery_technical', 'length', 'rhythm'],
    intensity: 'low',
    tags: ['recovery_technical', 'length', 'length_control', 'control_session', 'taper', 'base'],
    description: 'Pelotea profundo a ritmo suave, priorizando altura, largo y contacto limpio. El objetivo es recuperar sensaciones sin convertir el bloque en una sesión intensa.',
    progressionLevel: 1,
  },
  {
    id: 'pre_match_activation_timing',
    name: 'Activación pre-partido de manos y pies',
    category: 'match',
    focus: ['activation', 'timing', 'confidence'],
    intensity: 'low',
    tags: ['pre_match', 'taper', 'timing', 'activation'],
    description: 'Antes de competir, combina voleas suaves, paralelas profundas y salidas cortas desde el T. El objetivo es sentir contacto limpio y piernas despiertas sin fatigarte.',
    progressionLevel: 1,
  },
  {
    id: 'match_sim_points_short_sets',
    name: 'Puntos de partido a 5 u 8',
    category: 'match',
    focus: ['match_play', 'decision_making', 'pressure'],
    intensity: 'high',
    tags: ['match_play', 'peak', 'pressure', 'competitive'],
    description: 'Juega puntos con marcador corto (a 5 u 8). Practica inicio de punto, cierre y concentración cuando cada intercambio pesa. Cuenta el marcador en voz alta para meter presión real.',
    progressionLevel: 3,
  },
  {
    id: 'practice_match_five_games',
    name: 'Partido de entrenamiento al mejor de 5 juegos',
    category: 'match',
    focus: ['match_play', 'decision_making', 'tactical_application'],
    intensity: 'high',
    tags: ['match_play', 'practice', 'build', 'peak'],
    description: 'Juega un partido de entrenamiento al mejor de 5 juegos con marcador normal. El objetivo es sostener tu plan de juego durante un formato largo y ajustar entre juegos.',
    progressionLevel: 2,
  },
  {
    id: 'practice_match_best_of_3',
    name: 'Partido de entrenamiento al mejor de 3 juegos',
    category: 'match',
    focus: ['match_play', 'pressure', 'competitive_rhythm'],
    intensity: 'moderate',
    tags: ['match_play', 'practice', 'build', 'peak', 'pressure'],
    description: 'Juega un partido al mejor de 3 juegos con marcador normal. El objetivo es competir con intensidad sin acumular la carga de un partido largo.',
    progressionLevel: 2,
  },
  {
    id: 'practice_match_short_points_attack',
    name: 'Partido con ataque temprano',
    category: 'match',
    focus: ['match_play', 'attack', 'first_ball'],
    intensity: 'high',
    tags: ['match_play', 'practice', 'peak', 'attack', 'pressure'],
    description: 'Juega un partido buscando atacar la primera pelota cómoda que quede en media cancha o adelante. El objetivo es cerrar intercambios cortos sin forzar ataques desde posiciones malas.',
    progressionLevel: 3,
  },
]

export function toSquashDrill(definition: SquashDrillDefinition, durationMin?: number, notes?: string): SquashDrill {
  return {
    name: definition.name,
    durationMin,
    notes: notes ?? definition.description,
    executionMode: resolveDrillExecutionMode(definition),
  }
}

export function normalizeSquashDrillKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const DRILL_TOKEN_ALIASES: Record<string, string> = {
  drives: 'drive',
  paralelo: 'parallel',
  paralelos: 'parallel',
  cruzado: 'crosscourt',
  cruzados: 'crosscourt',
  longitud: 'length',
  largo: 'length',
  largos: 'length',
  lobs: 'lob',
  angulo: 'angle',
  angulos: 'angle',
  nicks: 'nick',
  defensive: 'defensivo',
  recovery: 'recuperacion',
  attacking: 'ofensivo',
  finish: 'definicion',
  front: 'delantera',
  court: 'cancha',
}

const DRILL_NAME_ALIASES: Record<string, string> = {
  parallel_drives: 'drive_parallel_depth',
  defensive_lob_recovery: 'defensive_high_lob_recovery',
  drives_paralelos: 'drive_parallel_depth',
  drives_paralelos_a_profundidad: 'drive_parallel_depth',
  drives_cruzados_con_longitud: 'drive_crosscourt_length',
  cambio_de_drive_paralelo_a_cruzado: 'drive_switch_parallel_cross',
  boast_a_drive_de_salida: 'boast_to_straight_drive',
  drop_y_contra_drop_por_ambos_lados: 'drop_and_counter_drop',
  '100_drops_solo': 'solo_100_drops',
  '100_tiros_media_cancha': 'solo_100_mid_court_shots',
  '100_al_box_de_saque': 'solo_100_service_box',
  '100_paralelas_de_fondo': 'solo_100_parallels_back',
  drops_desde_media_cancha: 'mid_court_drops',
  volea_de_presion_a_pared_frontal: 'volley_pressure_front_wall',
  volea_con_recuperacion_al_t: 'volley_t_recover',
  control_del_t_con_patron_largo_corto: 't_control_long_short',
  ataque_desde_t_a_primera_bola: 'attack_from_t_first_ball',
  presion_a_esquinas_de_fondo: 'pressure_back_corners',
  presion_de_fondo: 'pressure_back_court',
  presion_a_3_4_de_cancha: 'pressure_three_quarters_court',
  juego_condicionado_solo_fondo: 'conditioned_long_only',
  juego_condicionado_sin_segundos_botes: 'conditioned_no_two_bounces',
  juego_condicionado_iniciando_en_boast: 'conditioned_boast_start',
  transicion_frente_fondo_con_recuperacion: 'front_back_transition',
  ghosting_4_esquinas: 'ghosting_4_corners',
  ghosting_6_puntos: 'ghosting_6_points',
  split_step_y_recuperacion_al_t: 'split_step_t_recovery',
  rsa_corto_10_15s: 'rsa_short_bursts',
  multiball_de_presion_y_cierre: 'multiball_pressure_finishes',
  lob_defensivo_alto_con_recuperacion: 'defensive_high_lob_recovery',
  lob_ofensivo_como_cambio_de_ritmo: 'attacking_lob_change_of_pace',
  boast_ofensivo_desde_media_cancha: 'attacking_boast_from_mid_court',
  boast_ofensivo_desde_el_fondo: 'attacking_boast_from_back_court',
  definicion_con_angulo_en_zona_delantera: 'front_court_angle_finish',
  cierre_al_nick_bajo_presion: 'nick_pressure_closure',
  base_continua_de_movimiento_especifico_de_squash: 'continuous_squash_movement_base',
  intervalos_extensivos_de_movimiento_aerobico: 'extensive_aerobic_movement_intervals',
  recuperacion_tecnica_con_largo_controlado: 'technical_recovery_length',
  activacion_pre_partido_de_timing: 'pre_match_activation_timing',
  puntos_de_partido_en_sets_cortos: 'match_sim_points_short_sets',
  partido_de_entrenamiento_libre_a_5_games: 'practice_match_five_games',
  partido_de_entrenamiento_al_mejor_de_3_games: 'practice_match_best_of_3',
  partido_con_foco_de_ataque_en_puntos_cortos: 'practice_match_short_points_attack',
}

function normalizeDrillTokens(value: string): string[] {
  return normalizeSquashDrillKey(value)
    .split('_')
    .filter(Boolean)
    .map((token) => DRILL_TOKEN_ALIASES[token] ?? token)
}

export function findSquashDrillByName(name: string): SquashDrillDefinition | undefined {
  const normalizedName = normalizeSquashDrillKey(name)
  if (!normalizedName) return undefined

  const aliasedId = DRILL_NAME_ALIASES[normalizedName]
  if (aliasedId) {
    return SQUASH_DRILL_LIBRARY.find((drill) => drill.id === aliasedId)
  }

  const exactMatch = SQUASH_DRILL_LIBRARY.find(
    drill => drill.id === normalizedName || normalizeSquashDrillKey(drill.name) === normalizedName,
  )
  if (exactMatch) return exactMatch

  const tokens = new Set(normalizeDrillTokens(name))
  let bestMatch: { drill: SquashDrillDefinition; score: number } | null = null

  for (const drill of SQUASH_DRILL_LIBRARY) {
    const drillKey = normalizeSquashDrillKey(drill.name)
    if (
      normalizedName.length >= 4 &&
      (drillKey.includes(normalizedName) || normalizedName.includes(drillKey))
    ) {
      return drill
    }

    const drillTokens = normalizeDrillTokens(drill.name)
    const overlap = drillTokens.filter((token) => tokens.has(token)).length
    if (overlap === 0) continue

    const score = overlap / Math.max(drillTokens.length, tokens.size || 1)
    if (score >= 0.5 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { drill, score }
    }
  }

  return bestMatch?.drill
}

export function getSuggestedTrainingFocus(category: DrillCategory, tags: string[]): SquashTrainingFocus {
  if (tags.includes('match_play')) return 'conditioned_games'
  if (tags.includes('conditioned_game')) return 'conditioned_games'
  if (category === 'tactical') return 'tactical'
  if (category === 'physical') return 'physical'
  return 'technical'
}

export function getSquashDrillFamily(drill: SquashDrillDefinition): string {
  if (drill.tags.includes('pre_match')) return 'pre_match_activation'
  if (drill.tags.includes('match_play')) return 'match_play_practice'
  if (drill.tags.includes('solo') || drill.tags.includes('volume_reps')) return 'solo_control_volume'
  if (drill.tags.includes('ghosting')) return 'ghosting'
  if (drill.tags.includes('footwork') || drill.focus.includes('footwork')) return 'footwork'
  if (drill.tags.includes('rsa')) return 'rsa'
  if (drill.tags.includes('multiball')) return 'multiball_pressure'
  if (
    drill.intent === 'finishing' ||
    drill.tags.includes('finish') ||
    drill.tags.includes('nick') ||
    drill.tags.includes('angle')
  ) {
    return 'finishing'
  }
  if (drill.tags.includes('conditioned_game')) {
    if (drill.tags.includes('parallel')) return 'conditioned_parallel'
    if (drill.tags.includes('length_control')) return 'conditioned_length'
    if (drill.tags.includes('boast')) return 'conditioned_boast'
    if (drill.tags.includes('targets')) return 'conditioned_targets'
    return 'conditioned_general'
  }
  if (drill.focus.includes('drive')) return 'drive_patterns'
  if (drill.focus.includes('volley')) return 'volley_patterns'
  if (drill.tags.includes('t_control')) return 't_control_patterns'
  if (drill.focus.includes('drop')) return 'front_court_touch'
  if (drill.tags.includes('recovery_technical')) return 'recovery_length'
  if (drill.tags.includes('transition')) return 'transition_patterns'
  if (drill.tags.includes('pressure')) return 'pressure_back_court'
  return `${drill.category}_general`
}
