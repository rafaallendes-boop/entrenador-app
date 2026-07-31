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
export type DrillPhase = 'base' | 'build' | 'peak' | 'taper' | 'transition' | 'race'

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
  phaseAppropriate?: DrillPhase[]
  partnerRequired?: boolean
  /** Nombres canónicos anteriores, para datos históricos y búsqueda del catálogo. */
  aliases?: string[]
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

const RAW_SQUASH_DRILL_LIBRARY: SquashDrillDefinition[] = [
  {
    id: 'drive_parallel_depth',
    name: 'Drives paralelos profundos',
    aliases: ['Tiros paralelos profundos'],
    category: 'technical',
    focus: ['drive', 'length', 'control'],
    intensity: 'moderate',
    tags: ['parallel', 'drive', 'base', 'build', 'length', 'length_control'],
    description: 'Juega drives paralelos desde el fondo hacia la esquina profunda del mismo lado. Objetivo: que la pelota viaje larga, pegada a la pared lateral, y obligue al rival a golpear desde atrás. Clave: no busques potencia; busca altura, largo y repetir el mismo contacto.',
    intent: 'consistency',
    constraints: ['La pelota debe pasar alta por la pared frontal y llegar detrás del cuadro de saque'],
    progressionLevel: 1,
  },
  {
    id: 'drive_crosscourt_length',
    name: 'Drives cruzados profundos',
    aliases: ['Tiros cruzados profundos'],
    category: 'technical',
    focus: ['drive', 'crosscourt', 'length'],
    intensity: 'moderate',
    tags: ['crosscourt', 'drive', 'base', 'build', 'length', 'length_control'],
    description: 'Juega drives cruzados hacia la esquina profunda contraria. Objetivo: cambiar de lado sin regalar una pelota corta en media cancha. Clave: apunta alto en la pared frontal y termina el golpe hacia la esquina de fondo, no hacia el centro.',
    intent: 'control',
    progressionLevel: 1,
  },
  {
    id: 'drive_switch_parallel_cross',
    name: 'Alternar drive paralelo y cruzado',
    aliases: ['Cambio de paralelo a cruzado'],
    category: 'technical',
    focus: ['drive', 'transition', 'precision'],
    intensity: 'moderate',
    tags: ['parallel', 'crosscourt', 'drive', 'build', 'variation'],
    description: 'Alterna un drive paralelo y uno cruzado desde el fondo o media cancha. Objetivo: cambiar de dirección manteniendo profundidad y control de la T. Clave: prepara igual ambos golpes para que el rival no lea demasiado pronto hacia dónde vas a jugar.',
    progressionLevel: 2,
  },
  {
    id: 'boast_to_straight_drive',
    name: 'Boast y salida con drive paralelo',
    aliases: ['Boast y drive paralelo de salida'],
    category: 'technical',
    focus: ['boast', 'drive', 'recovery'],
    intensity: 'moderate',
    tags: ['boast', 'drive', 'build', 'recovery_technical'],
    description: 'Juega un boast —el golpe que va primero a la pared lateral— y después sal con un drive paralelo profundo. Objetivo: practicar cómo salir del rincón sin quedar atrapado. Clave: después del boast recupera rápido a la T y juega la paralela con largo antes de pensar en atacar.',
    progressionLevel: 2,
  },
  {
    id: 'drop_and_counter_drop',
    name: 'Drop y contra-drop por ambos lados',
    category: 'technical',
    focus: ['drop', 'touch', 'front_court'],
    intensity: 'low',
    tags: ['drop', 'front_court', 'taper', 'recovery_technical', 'control_session'],
    description: 'Desde la zona delantera, juega un drop —pelota corta y suave a la pared frontal— y responde con otro drop del mismo lado o cruzado. Objetivo: mejorar toque, control de altura y paciencia cerca de la pared frontal. Clave: mano suave, pelota baja y segundo bote antes del cuadro de saque.',
    progressionLevel: 1,
  },
  {
    id: 'solo_100_drops',
    name: 'Drops en solitario — 100 (50 por lado)',
    aliases: ['100 drops en solitario (50 por lado)'],
    category: 'technical',
    focus: ['drop', 'touch', 'front_court'],
    intensity: 'low',
    tags: ['drop', 'front_court', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper', 'recovery_technical'],
    description: 'Sin rival: completa 100 drops —pelotas cortas y suaves a la pared frontal— desde la zona delantera, 50 por lado. Objetivo: construir sensación de mano y control fino sin fatiga alta. Clave: cuenta solo los drops que quedan bajos y mueren antes del cuadro de saque; si empiezas a apurar el brazo, baja el ritmo.',
    intent: 'control',
    constraints: ['50 repeticiones por lado', 'La segunda bote debe quedar antes del cuadro de saque'],
    progressionLevel: 1,
  },
  {
    id: 'solo_100_mid_court_shots',
    name: 'Drives desde media cancha — 100',
    aliases: ['100 drives desde media cancha'],
    category: 'technical',
    focus: ['midcourt', 'length', 'precision'],
    intensity: 'low',
    tags: ['midcourt', 'length', 'precision', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper'],
    description: 'Desde media cancha, golpea 100 drives alternando paralelo y cruzado. Objetivo: aprender a transformar una pelota cómoda en largo profundo. Clave: contacta delante del pie delantero y no sigas si la pelota empieza a quedar en el centro.',
    intent: 'control',
    constraints: ['Alternar paralelo y cruzado cada 10 golpes', 'Contactar la pelota delante del pie delantero'],
    progressionLevel: 1,
  },
  {
    id: 'solo_100_service_box',
    name: 'Drives al cuadro de saque — 100',
    aliases: ['100 drives al cuadro de saque'],
    category: 'technical',
    focus: ['target', 'length', 'precision'],
    intensity: 'low',
    tags: ['target', 'length', 'precision', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper'],
    description: 'Juega 100 drives hacia un objetivo visible dentro del cuadro de saque. Objetivo: darle una referencia concreta a tu profundidad. Clave: marca una zona con cono/cinta y cuenta como buena solo la pelota que cae o pasa por ahí; 50 repeticiones por lado.',
    intent: 'control',
    constraints: ['Marcar un objetivo visible dentro del cuadro de saque', '50 repeticiones por lado'],
    progressionLevel: 1,
  },
  {
    id: 'solo_100_parallels_back',
    name: 'Drives paralelos desde el fondo — 100',
    aliases: ['100 drives paralelos desde el fondo'],
    category: 'technical',
    focus: ['drive', 'parallel', 'length'],
    intensity: 'moderate',
    tags: ['drive', 'parallel', 'length', 'solo', 'volume_reps', 'control_session', 'base', 'build', 'taper'],
    description: 'Desde el fondo, juega 100 drives paralelos pegados a la pared lateral. Objetivo: que tu paralela sea una pelota segura, profunda y difícil de atacar. Clave: cuenta como buena solo la pelota que llega atrás y se mantiene a menos de una raqueta de la pared lateral.',
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
    description: 'Desde media cancha, juega drops —pelotas cortas y suaves a la pared frontal— hacia la esquina delantera del mismo lado. Objetivo: convertir una pelota cómoda en presión al frente sin avisar. Clave: misma preparación que un drive, menos velocidad al impacto y pelota baja después del bote.',
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
    description: 'Volea sin dejar botar la pelota, manteniéndola frente a ti y por encima del tin (la placa metálica inferior). Objetivo: ganar timing y confianza tomando la pelota temprano. Clave: contactos limpios, cortos y controlados; no conviertas el ejercicio en pegar fuerte.',
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
    description: 'Desde media cancha, volea hacia una zona profunda sin dejar que la pelota bote. Objetivo: quitarle tiempo al rival sin perder estabilidad. Clave: golpe corto, contacto delante del cuerpo y recuperación inmediata a una base equilibrada.',
    progressionLevel: 1,
  },
  {
    id: 'volley_pressure_front_wall',
    name: 'Volea ofensiva desde media cancha',
    category: 'technical',
    focus: ['volley', 'pressure', 'attack'],
    intensity: 'moderate',
    tags: ['volley', 'pressure', 'attack', 'build', 'peak'],
    description: 'Desde media cancha o cerca de la T, volea temprano hacia una esquina profunda o una pelota corta clara. Objetivo: usar la volea como presión, no solo como devolución. Clave: decide antes del contacto y juega a una zona, no al medio de la cancha.',
    progressionLevel: 2,
  },
  {
    id: 'volley_t_recover',
    name: 'Volea y vuelta a la T',
    category: 'tactical',
    focus: ['volley', 't_control', 'recovery'],
    intensity: 'moderate',
    tags: ['volley', 't_control', 'build', 'peak'],
    description: 'Volea desde media cancha y vuelve a la T apenas termina el golpe. Objetivo: unir ataque temprano con recuperación real. Clave: la repetición cuenta si llegas al centro antes de la siguiente pelota, no solo si la volea entra.',
    intent: 'recovery',
    constraints: ['Recuperación a la T antes del siguiente golpe'],
    progressionLevel: 2,
  },
  {
    id: 't_control_long_short',
    name: 'Patrón largo-corto desde la T',
    category: 'tactical',
    focus: ['t_control', 'long_short', 'pressure'],
    intensity: 'moderate',
    tags: ['t_control', 'long_short', 'conditioned_game', 'build', 'peak'],
    description: 'Desde la T, alterna una pelota profunda al fondo y una pelota corta al frente. Objetivo: mover al rival largo-corto sin abandonar tu posición central. Clave: después de cada golpe vuelve a la T; si persigues tu propia pelota, perdiste el control del patrón.',
    progressionLevel: 2,
  },
  {
    id: 'attack_from_t_first_ball',
    name: 'Atacar la primera pelota cómoda desde la T',
    category: 'tactical',
    focus: ['t_control', 'attack', 'initiative'],
    intensity: 'high',
    tags: ['t_control', 'attack', 'peak', 'initiative'],
    description: 'Desde la T, espera una pelota cómoda en media cancha y atácala hacia una esquina o con un drop claro —pelota corta y suave a la pared frontal—. Objetivo: reconocer cuándo la pelota sí merece ataque. Clave: ataca equilibrado y temprano; si llegas forzado, juega profundo y reconstruye el punto.',
    progressionLevel: 3,
  },
  {
    id: 'pressure_back_corners',
    name: 'Presión a esquinas de fondo',
    category: 'tactical',
    focus: ['pressure', 'back_court', 'length'],
    intensity: 'moderate',
    tags: ['pressure', 'back_court', 'build', 'peak'],
    description: 'Juega profundo alternando las dos esquinas del fondo. Objetivo: mantener al rival detrás del cuadro de saque y negarle la T. Clave: no cambies corto demasiado pronto; primero consigue que golpee incómodo desde atrás.',
    progressionLevel: 2,
  },
  {
    id: 'pressure_back_court',
    name: 'Juego condicionado solo al fondo (intenso)',
    category: 'tactical',
    focus: ['conditioned_game', 'pressure', 'back_court'],
    intensity: 'high',
    tags: ['conditioned_game', 'pressure', 'back_court', 'build', 'peak'],
    description: 'Juega puntos donde ambos deben mandar la mayoría de las pelotas al fondo. Objetivo: sostener presión con largo antes de buscar el ganador. Clave: ataca corto solo cuando la pelota rival queda claramente corta o alta; no fuerces el cierre desde mala posición.',
    intent: 'pressure',
    constraints: ['La pelota debe llegar detrás del cuadro de saque antes de atacar corto', 'Buscar que el rival golpee desde el fondo'],
    progressionLevel: 3,
  },
  {
    id: 'pressure_three_quarters_court',
    name: 'Ataque temprano antes del fondo',
    aliases: ['Ataque desde tres cuartos de cancha'],
    category: 'tactical',
    focus: ['transition', 'pressure', 'mid_court'],
    intensity: 'high',
    tags: ['transition', 'pressure', 'mid_court', 'conditioned_game', 'build', 'peak'],
    description: 'Juega desde la zona entre media cancha y el fondo, tomando la pelota antes de que se meta atrás. Objetivo: avanzar hacia la T y convertir una pelota neutral en presión. Clave: contacta temprano, recupera hacia adelante y prepara el ataque siguiente.',
    intent: 'pressure',
    constraints: ['Tomar la pelota antes de que llegue a la esquina del fondo', 'Volver a la T después de cada golpe'],
    progressionLevel: 3,
  },
  {
    id: 'conditioned_parallel_only',
    name: 'Juego condicionado solo paralelo',
    category: 'tactical',
    focus: ['conditioned_game', 'parallel', 'order'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'parallel', 'build', 'peak'],
    description: 'Juega puntos donde solo valen los tiros paralelos por la pared lateral del mismo lado. Objetivo: ordenar el punto y mejorar precisión bajo presión. Clave: la pelota no debe despegarse hacia el centro; si se abre demasiado, el rival entra cómodo.',
    progressionLevel: 1,
  },
  {
    id: 'conditioned_long_only',
    name: 'Juego condicionado solo al fondo',
    category: 'tactical',
    focus: ['conditioned_game', 'length', 'pressure'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'length', 'length_control', 'pressure', 'base', 'build'],
    description: 'Juega puntos sin pelotas cortas: cada golpe debe buscar una zona profunda. Objetivo: entrenar paciencia, largo y selección de ataque. Clave: gana el punto construyendo, no inventando; espera una pelota claramente atacable antes de cambiar ritmo.',
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
    description: 'Juega puntos donde la pelota no puede pasar detrás del cuadro de saque. Objetivo: mejorar reacción, volea y toma temprana en media cancha. Clave: mantén postura baja y golpes compactos; si preparas grande, llegarás tarde.',
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
    description: 'Marca una zona prohibida y juega puntos sin enviar la pelota ahí. Objetivo: obligarte a decidir mejor cuando tu opción favorita no está disponible. Clave: antes de golpear, mira qué espacio queda libre y juega con intención, no por reflejo.',
    constraints: ['La pelota que cae en la zona prohibida pierde el punto'],
    progressionLevel: 2,
  },
  {
    id: 'conditioned_boast_start',
    name: 'Juego condicionado: el punto abre con boast',
    aliases: ['Punto que inicia con pared lateral'],
    category: 'tactical',
    focus: ['conditioned_game', 'boast', 'transition'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'boast', 'transition', 'build'],
    description: 'Cada punto empieza con un boast, el golpe que va primero a la pared lateral. Objetivo: practicar cómo resolver una pelota que abre la cancha y después ordenar el punto. Clave: no admires el boast; sal, recupera a la T y prepárate para la respuesta corta o cruzada.',
    progressionLevel: 2,
  },
  {
    id: 'front_back_transition',
    name: 'Transición frente-fondo con vuelta a la T',
    category: 'tactical',
    focus: ['transition', 'recovery', 'court_coverage'],
    intensity: 'moderate',
    tags: ['transition', 'court_coverage', 'build', 'peak'],
    description: 'Alterna una pelota corta al frente y una pelota profunda al fondo, volviendo a la T después de cada golpe. Objetivo: cubrir toda la cancha con ritmo y control. Clave: llega estable a cada esquina y vuelve al centro antes de acelerar otra vez.',
    progressionLevel: 2,
  },
  {
    id: 'ghosting_4_corners',
    name: 'Ghosting a cuatro esquinas',
    category: 'physical',
    focus: ['ghosting', 'movement', 'conditioning'],
    intensity: 'moderate',
    tags: ['ghosting', 'movement', 'base', 'build'],
    description: 'Ghosting, es decir desplazamientos sin pelota: muévete desde la T hacia las cuatro esquinas simulando un golpe real en cada llegada. Objetivo: grabar rutas limpias de movimiento sin depender de la pelota. Clave: llega equilibrado, golpea imaginario y vuelve a la T con el mismo ritmo.',
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
    description: 'Ghosting, es decir desplazamientos sin pelota: muévete desde la T hacia seis zonas —frente, media cancha y fondo por ambos lados—. Objetivo: mejorar cobertura completa y cambios de dirección. Clave: rápido no significa desordenado; mantén postura baja y vuelve al centro en cada repetición.',
    progressionLevel: 2,
  },
  {
    id: 'split_step_t_recovery',
    name: 'Split-step y vuelta a la T',
    category: 'physical',
    focus: ['footwork', 't_control', 'reaction'],
    intensity: 'moderate',
    tags: ['footwork', 't_control', 'build', 'taper'],
    description: 'Haz un split-step —el pequeño salto de ajuste justo antes de que el rival golpee—, sal hacia la esquina indicada y vuelve a la T. Objetivo: entrenar el primer paso después de leer la dirección. Clave: el split-step es pequeño y reactivo; no saltes alto ni te quedes clavado después del golpe simulado.',
    intent: 'recovery',
    progressionLevel: 1,
  },
  {
    id: 'rsa_short_bursts',
    name: 'Series cortas de velocidad en cancha (10-15 s)',
    aliases: ['RSA – sprints repetidos de 10-15 segundos'],
    category: 'physical',
    focus: ['rsa', 'conditioning', 'repeat_sprint'],
    intensity: 'high',
    tags: ['rsa', 'conditioning', 'peak', 'speed'],
    description: 'Haz bloques de 10 a 15 segundos moviéndote explosivo entre la T y las esquinas, con pausa completa entre bloques. Objetivo: repetir esfuerzos cortos e intensos como en los rallies más exigentes. Clave: si la técnica se rompe, corta el bloque; la calidad de pies importa más que sufrir por sufrir.',
    progressionLevel: 3,
  },
  {
    id: 'multiball_pressure_finishes',
    name: 'Multibola para presionar y cerrar',
    category: 'physical',
    focus: ['multiball', 'pressure', 'finish'],
    intensity: 'high',
    tags: ['multiball', 'pressure', 'peak', 'attack'],
    description: 'El alimentador entrega varias pelotas seguidas y tú juegas profundo hasta recibir una pelota atacable. Objetivo: sostener presión y elegir bien el momento de cerrar. Clave: no mates la primera pelota difícil; construye hasta que el cierre sea claro.',
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
    description: 'Desde una posición incómoda, juega un lob —pelota alta y profunda— hacia el fondo para ganar tiempo. Objetivo: salir de defensa sin regalar una pelota fácil. Clave: altura primero, profundidad después; vuelve a la T antes de que el rival golpee.',
    intent: 'recovery',
    constraints: ['La pelota debe pasar alta y llegar al fondo', 'Recuperación a la T antes del siguiente golpe'],
    progressionLevel: 1,
  },
  {
    id: 'attacking_lob_change_of_pace',
    name: 'Lob ofensivo como cambio de ritmo',
    category: 'technical',
    focus: ['lob', 'attack', 'variation'],
    intensity: 'moderate',
    tags: ['lob', 'attack', 'build', 'peak', 'variation'],
    description: 'Desde media cancha o el frente, juega un lob —pelota alta y profunda— cuando el rival espera una pelota rápida. Objetivo: cambiar el ritmo y sacarlo de la T. Clave: usa la misma preparación que para una pelota corta y prepárate para atacar la respuesta.',
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
    description: 'Desde media cancha, juega un boast —el golpe que va primero a la pared lateral— para que la pelota llegue baja al frente. Objetivo: abrir la cancha y obligar al rival a correr hacia adelante. Clave: después del golpe avanza; la ventaja está en tomar temprano la siguiente pelota.',
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
    description: 'Desde el fondo, juega un boast —el golpe que va primero a la pared lateral— con intención ofensiva para llevar la pelota al frente. Objetivo: transformar una defensa larga en una oportunidad de ataque. Clave: úsalo solo si llegas con espacio suficiente; si estás muy tarde, mejor lob alto y recupera.',
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
    description: 'Desde la zona delantera, juega una pelota con ángulo hacia la pared lateral o la esquina baja. Objetivo: cerrar el punto cuando el rival llega tarde o queda lejos. Clave: mantén preparación tranquila y busca que la pelota se aleje, no que salga fuerte.',
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
    description: 'Después de mover al rival, ataca el nick: la unión baja entre pared lateral y frontal. Objetivo: cerrar con una pelota que salga baja o muera cerca de la esquina. Clave: intenta el nick solo equilibrado; si llegas forzado, juega una pelota segura.',
    intent: 'finishing',
    constraints: ['Atacar solo cuando llegues equilibrado', 'Usar una marca visual cerca de la esquina baja'],
    progressionLevel: 3,
  },
  {
    id: 'continuous_squash_movement_base',
    name: 'Movimiento continuo en cancha a ritmo sostenido',
    aliases: ['Movimiento continuo de base aeróbica'],
    category: 'physical',
    focus: ['movement', 'aerobic_base', 'conditioning'],
    intensity: 'low',
    tags: ['movement', 'conditioning', 'aerobic_base', 'base', 'build'],
    description: 'Muévete de forma continua desde la T hacia distintas zonas de la cancha, sin acelerar al máximo en ningún momento. Objetivo: sostener movimiento específico de squash durante mucho tiempo sin convertirlo en sprint. Clave: respiración estable, postura limpia y vuelta a la T en cada movimiento.',
    intent: 'consistency',
    constraints: ['Mantener el mismo ritmo durante todo el intervalo', 'Volver a la T después de cada movimiento'],
    progressionLevel: 1,
  },
  {
    id: 'extensive_aerobic_movement_intervals',
    name: 'Intervalos largos de movimiento en cancha',
    aliases: ['Intervalos aeróbicos en cancha'],
    category: 'physical',
    focus: ['movement', 'aerobic_base', 'tempo'],
    intensity: 'moderate',
    tags: ['movement', 'conditioning', 'aerobic_base', 'base', 'build'],
    description: 'Haz intervalos largos moviéndote entre la T, el frente y el fondo a ritmo controlado. Objetivo: sostener movimiento específico durante más tiempo sin perder técnica. Clave: termina cada bloque con la misma calidad de pasos con la que empezaste.',
    intent: 'control',
    constraints: ['Mantener el mismo ritmo del primer al último intervalo', 'Terminar cada bloque con postura limpia en la T'],
    progressionLevel: 2,
  },
  {
    id: 'technical_recovery_length',
    name: 'Peloteo profundo suave de recuperación',
    aliases: ['Largo controlado de baja carga'],
    category: 'technical',
    focus: ['recovery_technical', 'length', 'rhythm'],
    intensity: 'low',
    tags: ['recovery_technical', 'length', 'length_control', 'control_session', 'taper', 'base'],
    description: 'Pelotea profundo a ritmo suave, priorizando altura, largo y contacto limpio. Objetivo: recuperar sensaciones y soltar el cuerpo sin sumar fatiga. Clave: si sube la intensidad o empiezas a competir el punto, vuelve a bajar el ritmo.',
    progressionLevel: 1,
  },
  {
    id: 'pre_match_activation_timing',
    name: 'Activación pre-partido de manos y pies',
    category: 'match',
    focus: ['activation', 'timing', 'confidence'],
    intensity: 'low',
    tags: ['pre_match', 'taper', 'timing', 'activation'],
    description: 'Antes de competir, combina voleas suaves, paralelas profundas y salidas cortas desde la T. Objetivo: llegar con manos finas y piernas despiertas, no cansado. Clave: termina con ganas de jugar más; si quedas pesado, fue demasiado.',
    progressionLevel: 1,
  },
  {
    id: 'match_sim_points_short_sets',
    name: 'Game a 11 con marcador real',
    category: 'match',
    focus: ['match_play', 'decision_making', 'pressure'],
    intensity: 'high',
    tags: ['match_play', 'peak', 'pressure', 'competitive'],
    description: 'Disputa un juego a 11 puntos con diferencia de 2, marcador real y servicio como en competencia. Objetivo: sentir presión real en formato corto. Clave: usa tu rutina entre puntos, juega el primer tiro con intención y observa cómo cierras cuando el marcador pesa.',
    progressionLevel: 3,
  },
  {
    id: 'practice_match_five_games',
    name: 'Partido de entrenamiento al mejor de 5 juegos',
    category: 'match',
    focus: ['match_play', 'decision_making', 'tactical_application'],
    intensity: 'high',
    tags: ['match_play', 'practice', 'build', 'peak'],
    description: 'Juega un partido de entrenamiento al mejor de 5 juegos con marcador normal. Objetivo: sostener tu plan de juego durante un formato largo. Clave: después de cada juego, define una corrección simple antes de volver a entrar.',
    progressionLevel: 2,
  },
  {
    id: 'practice_match_best_of_3',
    name: 'Partido de entrenamiento al mejor de 3 juegos',
    category: 'match',
    focus: ['match_play', 'pressure', 'competitive_rhythm'],
    intensity: 'moderate',
    tags: ['match_play', 'practice', 'build', 'peak', 'pressure'],
    description: 'Juega un partido al mejor de 3 juegos con marcador normal. Objetivo: competir con intensidad sin acumular la carga de un mejor de 5. Clave: trata cada inicio de juego como competencia real y revisa si mantienes tu plan bajo presión.',
    progressionLevel: 2,
  },
]

function inferDrillPhaseAppropriate(drill: SquashDrillDefinition): DrillPhase[] {
  if (drill.phaseAppropriate) return drill.phaseAppropriate
  if (drill.category === 'match') {
    return drill.tags.includes('pre_match') ? ['taper', 'race'] : ['build', 'peak', 'race']
  }
  if (drill.tags.includes('pre_match')) return ['taper', 'race']
  if (drill.tags.includes('recovery_technical')) return ['base', 'taper', 'transition', 'race']
  if (drill.category === 'physical') return ['base', 'build', 'peak']
  if (drill.category === 'tactical' || drill.intent === 'pressure' || drill.tags.includes('pressure')) return ['build', 'peak']
  if (drill.category === 'technical' || drill.tags.includes('control_session')) return ['base', 'build', 'peak', 'taper']
  return ['base', 'build']
}

function inferPartnerRequired(drill: SquashDrillDefinition): boolean {
  if (drill.partnerRequired != null) return drill.partnerRequired
  if (drill.category === 'match') return true
  if (drill.tags.includes('solo') || drill.tags.includes('ghosting') || drill.tags.includes('footwork')) return false
  if (drill.tags.includes('practice') || drill.tags.includes('match_play') || drill.tags.includes('multiball')) return true
  if (drill.tags.includes('conditioned_game')) return true
  return false
}

function withDrillPhase2Metadata(drill: SquashDrillDefinition): SquashDrillDefinition {
  return {
    ...drill,
    phaseAppropriate: inferDrillPhaseAppropriate(drill),
    partnerRequired: inferPartnerRequired(drill),
  }
}

export const SQUASH_DRILL_LIBRARY: SquashDrillDefinition[] = RAW_SQUASH_DRILL_LIBRARY.map(withDrillPhase2Metadata)

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
  volea_con_vuelta_al_t: 'volley_t_recover',
  ghosting_4_esquinas: 'ghosting_4_corners',
  ghosting_6_puntos: 'ghosting_6_points',
  split_step_y_recuperacion_al_t: 'split_step_t_recovery',
  split_step_y_vuelta_a_la_t: 'split_step_t_recovery',
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
  puntos_de_partido_a_5_u_8: 'match_sim_points_short_sets',
  game_a_11_con_marcador_real: 'match_sim_points_short_sets',
  partido_de_entrenamiento_libre_a_5_games: 'practice_match_five_games',
  partido_de_entrenamiento_al_mejor_de_3_games: 'practice_match_best_of_3',
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

  const aliasMatch = SQUASH_DRILL_LIBRARY.find((drill) =>
    (drill.aliases ?? []).some((alias) => normalizeSquashDrillKey(alias) === normalizedName),
  )
  if (aliasMatch) return aliasMatch

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
