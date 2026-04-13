import type { SquashDrill, SquashTrainingFocus } from '../../types'

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
}

export function isSquashMatchDrill(value: Pick<SquashDrillDefinition, 'category' | 'tags'>): boolean {
  return value.category === 'match' || value.tags.includes('match_play')
}

export function orderSquashDrillsForSession<T extends { name: string }>(
  drills: T[],
  resolveDefinition: (drill: T) => SquashDrillDefinition | undefined = (drill) => findSquashDrillByName(drill.name),
): T[] {
  const regular = drills.filter((drill) => !isSquashMatchDrill(resolveDefinition(drill) ?? { category: 'technical', tags: [] }))
  const matches = drills.filter((drill) => isSquashMatchDrill(resolveDefinition(drill) ?? { category: 'technical', tags: [] }))
  return [...regular, ...matches]
}

export const SQUASH_DRILL_LIBRARY: SquashDrillDefinition[] = [
  {
    id: 'drive_parallel_depth',
    name: 'Drives paralelos a profundidad',
    category: 'technical',
    focus: ['drive', 'length', 'control'],
    intensity: 'moderate',
    tags: ['parallel', 'drive', 'base', 'build', 'length', 'length_control'],
    description: 'Peloteo de drives paralelos buscando profundidad constante a la pared del fondo.',
    intent: 'consistency',
    constraints: ['Mantener la pelota por encima de la línea de saque'],
    progressionLevel: 1,
  },
  {
    id: 'drive_crosscourt_length',
    name: 'Drives cruzados con longitud',
    category: 'technical',
    focus: ['drive', 'crosscourt', 'length'],
    intensity: 'moderate',
    tags: ['crosscourt', 'drive', 'base', 'build', 'length', 'length_control'],
    description: 'Secuencias de drives cruzados manteniendo altura y largo para desplazar al rival.',
    intent: 'control',
    progressionLevel: 1,
  },
  {
    id: 'drive_switch_parallel_cross',
    name: 'Cambio de drive paralelo a cruzado',
    category: 'technical',
    focus: ['drive', 'transition', 'precision'],
    intensity: 'moderate',
    tags: ['parallel', 'crosscourt', 'drive', 'build', 'variation'],
    description: 'Alternar paralelo y cruzado sin perder longitud ni control del centro.',
    progressionLevel: 2,
  },
  {
    id: 'boast_to_straight_drive',
    name: 'Boast a drive de salida',
    category: 'technical',
    focus: ['boast', 'drive', 'recovery'],
    intensity: 'moderate',
    tags: ['boast', 'drive', 'build', 'recovery_technical'],
    description: 'Trabajar salida desde boast corto hacia drive limpio con recuperación al T.',
    progressionLevel: 2,
  },
  {
    id: 'drop_and_counter_drop',
    name: 'Drop y contra-drop por ambos lados',
    category: 'technical',
    focus: ['drop', 'touch', 'front_court'],
    intensity: 'low',
    tags: ['drop', 'front_court', 'taper', 'recovery_technical'],
    description: 'Series de drop y respuesta corta con foco en toque, altura y segunda acción.',
    progressionLevel: 1,
  },
  {
    id: 'volley_control_midcourt',
    name: 'Volea de control desde media cancha',
    category: 'technical',
    focus: ['volley', 'control', 'midcourt'],
    intensity: 'moderate',
    tags: ['volley', 'control', 'midcourt', 'base', 'build'],
    description: 'Voleas sostenidas desde media cancha buscando estabilidad y preparación temprana.',
    progressionLevel: 1,
  },
  {
    id: 'volley_pressure_front_wall',
    name: 'Volea de presión a pared frontal',
    category: 'technical',
    focus: ['volley', 'pressure', 'attack'],
    intensity: 'moderate',
    tags: ['volley', 'pressure', 'attack', 'build', 'peak'],
    description: 'Secuencias de volea ofensiva apretando tiempo y posición rival.',
    progressionLevel: 2,
  },
  {
    id: 'volley_t_recover',
    name: 'Volea con recuperación al T',
    category: 'tactical',
    focus: ['volley', 't_control', 'recovery'],
    intensity: 'moderate',
    tags: ['volley', 't_control', 'build', 'peak'],
    description: 'Volear y recuperar inmediatamente al T para sostener dominio del punto.',
    intent: 'recovery',
    constraints: ['Recuperar al T antes del siguiente golpe'],
    progressionLevel: 2,
  },
  {
    id: 't_control_long_short',
    name: 'Control del T con patrón largo-corto',
    category: 'tactical',
    focus: ['t_control', 'long_short', 'pressure'],
    intensity: 'moderate',
    tags: ['t_control', 'long_short', 'conditioned_game', 'build', 'peak'],
    description: 'Secuencias desde el T alternando profundidad y bola corta para abrir espacio.',
    progressionLevel: 2,
  },
  {
    id: 'attack_from_t_first_ball',
    name: 'Ataque desde T a primera bola',
    category: 'tactical',
    focus: ['t_control', 'attack', 'initiative'],
    intensity: 'high',
    tags: ['t_control', 'attack', 'peak', 'initiative'],
    description: 'Ejercicio de lectura y toma del T para atacar la primera pelota útil.',
    progressionLevel: 3,
  },
  {
    id: 'pressure_back_corners',
    name: 'Presión a esquinas de fondo',
    category: 'tactical',
    focus: ['pressure', 'back_court', 'length'],
    intensity: 'moderate',
    tags: ['pressure', 'back_court', 'build', 'peak'],
    description: 'Patrón de presión continua sobre esquinas del fondo para encerrar al rival.',
    progressionLevel: 2,
  },
  {
    id: 'conditioned_parallel_only',
    name: 'Juego condicionado solo paralelo',
    category: 'tactical',
    focus: ['conditioned_game', 'parallel', 'order'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'parallel', 'build', 'peak'],
    description: 'Punto condicionado donde solo se permite jugar paralelo para ordenar trayectorias.',
    progressionLevel: 1,
  },
  {
    id: 'conditioned_long_only',
    name: 'Juego condicionado solo fondo',
    category: 'tactical',
    focus: ['conditioned_game', 'length', 'pressure'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'length', 'length_control', 'pressure', 'base', 'build'],
    description: 'Punto condicionado sin juego corto, priorizando profundidad y paciencia táctica.',
    intent: 'control',
    constraints: ['Sustain depth for 6 consecutive shots before changing pace'],
    progressionLevel: 1,
  },
  {
    id: 'conditioned_no_two_bounces',
    name: 'Juego condicionado sin segundos botes',
    category: 'tactical',
    focus: ['conditioned_game', 'intensity', 'speed'],
    intensity: 'high',
    tags: ['conditioned_game', 'speed', 'peak', 'pressure'],
    description: 'Juego condicionado con obligación de llegar temprano, subiendo el ritmo del intercambio. Por ejemplo, la pelota no puede pasar atras del cuadrado de saque',
    progressionLevel: 3,
  },
  {
    id: 'conditioned_forbidden_zone',
    name: 'Juego condicionado con zona prohibida',
    category: 'tactical',
    focus: ['conditioned_game', 'targets', 'decision_making'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'targets', 'build', 'peak'],
    description: 'Se restringe una zona de cancha para forzar nuevas decisiones tácticas y ángulos.',
    progressionLevel: 2,
  },
  {
    id: 'conditioned_boast_start',
    name: 'Juego condicionado iniciando en boast',
    category: 'tactical',
    focus: ['conditioned_game', 'boast', 'transition'],
    intensity: 'moderate',
    tags: ['conditioned_game', 'boast', 'transition', 'build'],
    description: 'Cada punto inicia con boast para trabajar salidas, lectura y reorganización del T.',
    progressionLevel: 2,
  },
  {
    id: 'front_back_transition',
    name: 'Transición frente-fondo con recuperación',
    category: 'tactical',
    focus: ['transition', 'recovery', 'court_coverage'],
    intensity: 'moderate',
    tags: ['transition', 'court_coverage', 'build', 'peak'],
    description: 'Alternancia de bola corta y larga con recuperación disciplinada al centro.',
    progressionLevel: 2,
  },
  {
    id: 'ghosting_4_corners',
    name: 'Ghosting 4 esquinas',
    category: 'physical',
    focus: ['ghosting', 'movement', 'conditioning'],
    intensity: 'moderate',
    tags: ['ghosting', 'movement', 'base', 'build'],
    description: 'Ghosting clásico a cuatro esquinas con foco en patrón técnico y control corporal.',
    intent: 'consistency',
    constraints: ['Land balanced and recover with the same rhythm each rep'],
    progressionLevel: 1,
  },
  {
    id: 'ghosting_6_points',
    name: 'Ghosting 6 puntos',
    category: 'physical',
    focus: ['ghosting', 'movement', 'speed'],
    intensity: 'high',
    tags: ['ghosting', 'movement', 'speed', 'build', 'peak'],
    description: 'Ghosting a seis puntos con mayor frecuencia de apoyos y demanda cardiovascular.',
    progressionLevel: 2,
  },
  {
    id: 'split_step_t_recovery',
    name: 'Split step y recuperación al T',
    category: 'physical',
    focus: ['footwork', 't_control', 'reaction'],
    intensity: 'moderate',
    tags: ['footwork', 't_control', 'build', 'taper'],
    description: 'Bloques cortos de split step, salida y recuperación rápida al T.',
    intent: 'recovery',
    progressionLevel: 1,
  },
  {
    id: 'rsa_short_bursts',
    name: 'RSA corto 10-15s',
    category: 'physical',
    focus: ['rsa', 'conditioning', 'repeat_sprint'],
    intensity: 'high',
    tags: ['rsa', 'conditioning', 'peak', 'speed'],
    description: 'Repeticiones cortas de alta intensidad con recuperación incompleta para tolerancia al esfuerzo.',
    progressionLevel: 3,
  },
  {
    id: 'multiball_pressure_finishes',
    name: 'Multiball de presión y cierre',
    category: 'physical',
    focus: ['multiball', 'pressure', 'finish'],
    intensity: 'high',
    tags: ['multiball', 'pressure', 'peak', 'attack'],
    description: 'Multiball intenso para presión continua y definición de la jugada.',
    intent: 'pressure',
    progressionLevel: 3,
  },
  {
    id: 'defensive_high_lob_recovery',
    name: 'Lob defensivo alto con recuperación',
    category: 'technical',
    focus: ['lob', 'recovery', 'back_court'],
    intensity: 'low',
    tags: ['lob', 'recovery_technical', 'base', 'build', 'taper', 'back_court'],
    description: 'Lob defensivo alto desde situaciones de presión para recuperar tiempo, orden y volver al rally con control.',
    intent: 'recovery',
    constraints: ['Mantener la pelota por encima de la línea de saque', 'Recuperar al T antes del siguiente golpe'],
    progressionLevel: 1,
  },
  {
    id: 'attacking_lob_change_of_pace',
    name: 'Lob ofensivo como cambio de ritmo',
    category: 'technical',
    focus: ['lob', 'attack', 'variation'],
    intensity: 'moderate',
    tags: ['lob', 'attack', 'build', 'peak', 'variation'],
    description: 'Usar el lob ofensivo como cambio de ritmo para llevar al rival al fondo y reabrir el juego en la parte delantera.',
    intent: 'control',
    constraints: ['Disfrazar la preparación antes del lift', 'Enviar el segundo golpe hacia cancha abierta'],
    progressionLevel: 2,
  },
  {
    id: 'attacking_boast_from_mid_court',
    name: 'Boast ofensivo desde media cancha',
    category: 'technical',
    focus: ['boast', 'attack', 'mid_court'],
    intensity: 'moderate',
    tags: ['boast', 'attack', 'mid_court', 'build', 'peak', 'pressure'],
    description: 'Atacar desde media cancha con un boast temprano para romper el ritmo y avanzar sobre la siguiente pelota.',
    intent: 'pressure',
    constraints: ['Recuperar hacia adelante después del boast en vez de retroceder', 'Cerrar el punto dentro de 3 golpes'],
    progressionLevel: 2,
  },
  {
    id: 'attacking_boast_from_back_court',
    name: 'Boast ofensivo desde el fondo',
    category: 'technical',
    focus: ['boast', 'attack', 'back_court'],
    intensity: 'high',
    tags: ['boast', 'attack', 'back_court', 'build', 'peak', 'pressure'],
    description: 'Generar ataque desde el fondo con un boast intencional que fuerce una respuesta débil en la zona delantera.',
    intent: 'pressure',
    constraints: ['Mantener el boast pegado a la pared lateral', 'Recuperar para cortar temprano la siguiente pelota'],
    progressionLevel: 3,
  },
  {
    id: 'front_court_angle_finish',
    name: 'Definición con ángulo en zona delantera',
    category: 'technical',
    focus: ['angle', 'front_court', 'finish'],
    intensity: 'moderate',
    tags: ['angle', 'front_court', 'finish', 'build', 'peak'],
    description: 'Patrón ofensivo en la parte delantera enfocado en crear ángulo y cerrar el rally antes de que el rival se reorganice.',
    intent: 'finishing',
    constraints: ['Sostener la preparación de la raqueta hasta el último momento', 'Cerrar el punto dentro de 3 golpes'],
    progressionLevel: 2,
  },
  {
    id: 'nick_pressure_closure',
    name: 'Cierre al nick bajo presión',
    category: 'technical',
    focus: ['nick', 'finish', 'precision'],
    intensity: 'moderate',
    tags: ['nick', 'angle', 'finish', 'build', 'peak', 'pressure'],
    description: 'Drill de definición precisa orientado a encontrar el nick bajo presión después de construir el rally.',
    intent: 'finishing',
    constraints: ['Atacar el nick solo desde una pelota de armado equilibrada', 'Usar un objetivo visual claro por lado'],
    progressionLevel: 3,
  },
  {
    id: 'continuous_squash_movement_base',
    name: 'Base continua de movimiento específico de squash',
    category: 'physical',
    focus: ['movement', 'aerobic_base', 'conditioning'],
    intensity: 'low',
    tags: ['movement', 'conditioning', 'aerobic_base', 'base', 'build'],
    description: 'Movimiento continuo en cancha con ritmo técnico, pensado para desarrollar base aeróbica específica sin exigir sprints.',
    intent: 'consistency',
    constraints: ['Sostener un tempo parejo durante todo el intervalo', 'Mantener hombros relajados entre esquinas'],
    progressionLevel: 1,
  },
  {
    id: 'extensive_aerobic_movement_intervals',
    name: 'Intervalos extensivos de movimiento aeróbico',
    category: 'physical',
    focus: ['movement', 'aerobic_base', 'tempo'],
    intensity: 'moderate',
    tags: ['movement', 'conditioning', 'aerobic_base', 'base', 'build'],
    description: 'Intervalos aeróbicos extensivos con movimiento controlado en cancha, priorizando trabajo base repetible sobre ghosting explosivo.',
    intent: 'control',
    constraints: ['Mantener el mismo ritmo del primer al último intervalo', 'Terminar cada bloque con postura limpia en el T'],
    progressionLevel: 2,
  },
  {
    id: 'technical_recovery_length',
    name: 'Recuperación técnica con largo controlado',
    category: 'technical',
    focus: ['recovery_technical', 'length', 'rhythm'],
    intensity: 'low',
    tags: ['recovery_technical', 'length', 'length_control', 'taper', 'base'],
    description: 'Peloteo largo de baja fatiga para recuperar sensaciones y timing.',
    progressionLevel: 1,
  },
  {
    id: 'pre_match_activation_timing',
    name: 'Activación pre-partido de timing',
    category: 'match',
    focus: ['activation', 'timing', 'confidence'],
    intensity: 'low',
    tags: ['pre_match', 'taper', 'timing', 'activation'],
    description: 'Secuencia breve de activación de manos, pies y percepción antes de competir.',
    progressionLevel: 1,
  },
  {
    id: 'match_sim_points_short_sets',
    name: 'Puntos de partido en sets cortos',
    category: 'match',
    focus: ['match_play', 'decision_making', 'pressure'],
    intensity: 'high',
    tags: ['match_play', 'peak', 'pressure', 'competitive'],
    description: 'Jugar puntos o sets cortos con scoring reducido para simular estrés competitivo.',
    progressionLevel: 3,
  },
  {
    id: 'practice_match_five_games',
    name: 'Partido de entrenamiento libre a 5 games',
    category: 'match',
    focus: ['match_play', 'decision_making', 'tactical_application'],
    intensity: 'high',
    tags: ['match_play', 'practice', 'build', 'peak'],
    description: 'Partido de entrenamiento completo a cinco games para aplicar táctica, ritmo y toma de decisiones con rival real.',
    progressionLevel: 2,
  },
  {
    id: 'practice_match_best_of_3',
    name: 'Partido de entrenamiento al mejor de 3 games',
    category: 'match',
    focus: ['match_play', 'pressure', 'competitive_rhythm'],
    intensity: 'moderate',
    tags: ['match_play', 'practice', 'build', 'peak', 'pressure'],
    description: 'Cierre de entrenamiento con match-play corto al mejor de tres games para trabajar presión sin carga completa de partido largo.',
    progressionLevel: 2,
  },
  {
    id: 'practice_match_short_points_attack',
    name: 'Partido con foco de ataque en puntos cortos',
    category: 'match',
    focus: ['match_play', 'attack', 'first_ball'],
    intensity: 'high',
    tags: ['match_play', 'practice', 'peak', 'attack', 'pressure'],
    description: 'Partido de entrenamiento orientado a imponer ataque temprano, primera pelota util y definición de puntos cortos.',
    progressionLevel: 3,
  },
]

export function toSquashDrill(definition: SquashDrillDefinition, durationMin?: number, notes?: string): SquashDrill {
  return {
    name: definition.name,
    durationMin,
    notes: notes ?? definition.description,
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

function normalizeDrillTokens(value: string): string[] {
  return normalizeSquashDrillKey(value)
    .split('_')
    .filter(Boolean)
    .map((token) => DRILL_TOKEN_ALIASES[token] ?? token)
}

export function findSquashDrillByName(name: string): SquashDrillDefinition | undefined {
  const normalizedName = normalizeSquashDrillKey(name)
  const exactMatch = SQUASH_DRILL_LIBRARY.find(
    drill => drill.id === normalizedName || normalizeSquashDrillKey(drill.name) === normalizedName,
  )
  if (exactMatch) return exactMatch

  const tokens = new Set(normalizeDrillTokens(name))
  let bestMatch: { drill: SquashDrillDefinition; score: number } | null = null

  for (const drill of SQUASH_DRILL_LIBRARY) {
    const drillKey = normalizeSquashDrillKey(drill.name)
    if (drillKey.includes(normalizedName) || normalizedName.includes(drillKey)) {
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
