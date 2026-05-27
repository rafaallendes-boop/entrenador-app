export type MobilityFocus =
  | 'hip'
  | 'ankle_foot'
  | 'shoulder_thoracic'
  | 'full_body'
  | 'sport_specific'
  | 'activation'

export type MobilityCategory =
  | 'passive'
  | 'active'
  | 'dynamic'
  | 'activation'

export type MobilitySportContext = 'squash' | 'running' | 'cycling' | 'strength' | 'general'

export const MOBILITY_FOCUS_LABELS: Record<MobilityFocus | string, string> = {
  hip: 'Cadera',
  ankle_foot: 'Tobillo y pie',
  shoulder_thoracic: 'Hombro y columna toracica',
  full_body: 'Cuerpo completo',
  sport_specific: 'Especifica del deporte',
  activation: 'Activacion',
}

export interface MobilitySessionDefinition {
  id: string
  name: string
  focus: MobilityFocus[]
  category: MobilityCategory
  tags: string[]
  description: string
  typicalDuration: string
  suitableSportContext: MobilitySportContext[]
  suitablePhases?: string[]
  typicalStructure: string
}

const MOBILITY_TERM_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bworld'?s greatest stretch\b/gi, 'Estocada larga con rotacion'],
  [/\bhip 90\/90 flow\b/gi, 'Flujo 90/90 de cadera'],
  [/\b90\/90 hip rotation\b/gi, 'Rotacion 90/90 de cadera'],
  [/\b90\/90 hip\b/gi, '90/90 de cadera'],
  [/\b90\/90 posterior\b/gi, '90/90 posterior de cadera'],
  [/\bthoracic rotation\b/gi, 'Rotacion toracica'],
  [/\bthoracic opener\b/gi, 'Apertura toracica'],
  [/\bcars hombro\b/gi, 'CARs de hombro'],
  [/\bcars de hombro\b/gi, 'CARs de hombro'],
  [/\bthread the needle\b/gi, 'Rotacion toracica tipo enhebrar aguja'],
  [/\bcouch stretch\b/gi, 'Estiramiento de flexor de cadera en banco'],
  [/\bkneeling lunge activo\b/gi, 'Estocada arrodillada activa'],
  [/\bhip flexor dinamico\b/gi, 'Flexor de cadera dinamico'],
  [/\bhip flexor kneeling\b/gi, 'Flexor de cadera arrodillado'],
  [/\bhip flexor opener\b/gi, 'Apertura de flexor de cadera'],
  [/\bhip circles\b/gi, 'Circulos de cadera'],
  [/\bankle circles\b/gi, 'Circulos de tobillo'],
  [/\bankle rocks\b/gi, 'Balanceos de tobillo en pared'],
  [/\barch circles\b/gi, 'Circulos de arco del pie'],
  [/\bchild'?s pose\b/gi, 'Postura del nino'],
  [/\bsquat prying\b/gi, 'Sentadilla profunda con apertura de cadera'],
  [/\bbreathing squat hold\b/gi, 'Sentadilla profunda con respiracion'],
  [/\badductor rockback\b/gi, 'Rockback de aductores'],
  [/\bwall slide\b/gi, 'Deslizamiento de hombros en pared'],
  [/\bleg swings\b/gi, 'Balanceos de pierna'],
  [/\barm circles\b/gi, 'Circulos de brazos'],
  [/\binchworm\b/gi, 'Caminata de manos'],
  [/\bcat-cow\b/gi, 'Gato-camello'],
  [/\bfoam roller\b/gi, 'rodillo de espuma'],
  [/\bopener\b/gi, 'apertura'],
  [/\bflow\b/gi, 'flujo'],
]

export function normalizeMobilityTargetStructure(structure: string): string {
  const translated = MOBILITY_TERM_TRANSLATIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    structure,
  )

  return translated
    .replace(/\b(\d+)\s*rep\/l\b/gi, '$1/lado')
    .replace(/\b(\d+)\s*\/l\b/gi, '$1/lado')
    .replace(/\b(\d+)\s*min\/l\b/gi, '$1 min/lado')
    .replace(/\b(\d+)\s*min\b/gi, '$1 min')
    .replace(/\b(\d+)s\/l\b/gi, '$1s/lado')
    .replace(/\b(\d+)s\s*\/\s*lado\b/gi, '$1s/lado')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeMobilityDetails<T extends { targetStructure: string; executionNotes?: string }>(details: T): T {
  return {
    ...details,
    targetStructure: normalizeMobilityTargetStructure(details.targetStructure),
    executionNotes: details.executionNotes ? normalizeMobilityTargetStructure(details.executionNotes) : details.executionNotes,
  }
}

export function formatMobilityFocusAreas(focusAreas: readonly string[] | undefined): string {
  if (!focusAreas || focusAreas.length === 0) return ''
  return focusAreas.map((focus) => MOBILITY_FOCUS_LABELS[focus] ?? focus).join(', ')
}

export const MOBILITY_SESSION_LIBRARY: MobilitySessionDefinition[] = [
  {
    id: 'hip_full_range',
    name: 'Movilidad de cadera completa',
    focus: ['hip'],
    category: 'active',
    tags: ['hip', 'flexors', 'rotators', 'functional', 'base', 'build'],
    description: 'Trabajo completo de cadera: flexores, rotadores externos, aductores y extensores. Base para todos los deportes.',
    typicalDuration: '25-35 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    typicalStructure: 'CARs de cadera 2x5/lado + Estiramiento de flexor de cadera en banco 2 min/lado + Rotacion 90/90 de cadera 2 min/lado + Figura 4 activa 90s/lado + Flexor de cadera dinamico 10/lado.',
  },
  {
    id: 'hip_flexor_release',
    name: 'Liberacion de flexores de cadera',
    focus: ['hip'],
    category: 'passive',
    tags: ['hip', 'flexors', 'psoas', 'cycling', 'running', 'tightness'],
    description: 'Sesion especifica para psoas e iliaco, musculos que se acortan en ciclismo, running y trabajo de escritorio.',
    typicalDuration: '15-25 min',
    suitableSportContext: ['cycling', 'running', 'strength'],
    typicalStructure: 'Estiramiento de flexor de cadera en banco 3 min/lado + Flexor de cadera dinamico 3x10/lado + Estocada arrodillada activa 2 min/lado + 90/90 posterior de cadera 2 min/lado.',
  },
  {
    id: 'ankle_dorsiflexion',
    name: 'Movilidad de tobillo y dorsiflexion',
    focus: ['ankle_foot'],
    category: 'active',
    tags: ['ankle', 'dorsiflexion', 'squash', 'running', 'squat', 'lunge'],
    description: 'Trabajo de dorsiflexion de tobillo, limitante clave en lunge de squash, sentadilla y recepcion en running.',
    typicalDuration: '15-20 min',
    suitableSportContext: ['squash', 'running', 'strength'],
    typicalStructure: 'Movilizacion de tobillo en pared 3x10/lado + Dorsiflexion con banda 2 min/lado + Excentrico de gemelo 3x10/lado + Circulos de arco del pie 10/lado.',
  },
  {
    id: 'shoulder_cars',
    name: 'CARs de hombro y apertura toracica',
    focus: ['shoulder_thoracic'],
    category: 'active',
    tags: ['shoulder', 'thoracic', 'squash', 'strength', 'rotation', 'CARs'],
    description: 'CARs de hombro para rango activo controlado en toda la circunferencia glenohumeral. Critico en squash.',
    typicalDuration: '20-25 min',
    suitableSportContext: ['squash', 'strength'],
    typicalStructure: 'CARs de hombro 2x5/lado + Rotacion toracica en cuadrupedia 3x10/lado + Apertura toracica con rodillo de espuma 5 min + Remo en suelo 3x10.',
  },
  {
    id: 'thoracic_mobility',
    name: 'Movilidad toracica y rotacion',
    focus: ['shoulder_thoracic'],
    category: 'active',
    tags: ['thoracic', 'rotation', 'squash', 'cycling', 'posture', 'extension'],
    description: 'Rotacion y extension toracica, limitante en deportes de rotacion y antidoto a postura ciclista.',
    typicalDuration: '20-25 min',
    suitableSportContext: ['squash', 'cycling', 'strength', 'general'],
    typicalStructure: 'Extension toracica con rodillo de espuma 3x8 + Rotaciones en cuadrupedia 3x10/lado + Rotacion toracica tipo enhebrar aguja 2x10/lado + Gato-camello 2x10.',
  },
  {
    id: 'range_maintenance_reset',
    name: 'Mantenimiento de rango global',
    focus: ['full_body'],
    category: 'dynamic',
    tags: ['full_body', 'maintenance', 'reset', 'base', 'build'],
    description: 'Flujo global para mantener rango util de movimiento sin convertir la sesion en trabajo pasivo largo.',
    typicalDuration: '18-25 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    typicalStructure: 'Estocada larga con rotacion 4/lado + Sentadilla profunda con apertura de cadera 90s + Apertura toracica 8/lado + Balanceos de tobillo en pared 10/lado + Apertura de hombros 8/lado.',
  },
  {
    id: 'full_body_flow',
    name: 'Flujo de movilidad global',
    focus: ['full_body'],
    category: 'dynamic',
    tags: ['full_body', 'flow', 'general', 'recovery', 'transition', 'beginner_friendly'],
    description: 'Rutina de movilidad global de baja intensidad. Ideal como sesion de recuperacion o transicion entre bloques.',
    typicalDuration: '30-40 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    typicalStructure: 'Estocada larga con rotacion 5/lado + Flujo 90/90 de cadera 2 min/lado + Rotacion toracica 10/lado + CARs de hombro 5/lado + Circulos de tobillo 10/lado + Postura del nino 3 min.',
  },
  {
    id: 'recovery_mobility',
    name: 'Movilidad de recuperacion activa',
    focus: ['full_body'],
    category: 'passive',
    tags: ['recovery', 'passive', 'low_load', 'transition', 'taper', 'beginner_friendly'],
    description: 'Sesion de movilidad pasiva para recuperacion sin carga. RPE 2-3. Apta para dia de descanso activo.',
    typicalDuration: '30-45 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    suitablePhases: ['taper', 'transition', 'race'],
    typicalStructure: 'Piriforme supino 3 min/lado + Flexor de cadera pasivo 3 min/lado + Aductor en suelo 3 min/lado + Pecho abierto con rodillo de espuma 5 min + Cervical suave.',
  },
  {
    id: 'post_run_mobility',
    name: 'Movilidad post-running',
    focus: ['sport_specific', 'hip', 'ankle_foot'],
    category: 'passive',
    tags: ['running', 'post_session', 'hip', 'calf', 'hamstring', 'recovery'],
    description: 'Rutina post-running para cadera, gemelo, isquio y tobillo. Reduce rigidez y acelera recuperacion.',
    typicalDuration: '20-30 min',
    suitableSportContext: ['running'],
    typicalStructure: 'Gemelo excentrico 3x10/lado + Piriforme supino 3 min/lado + Flexor de cadera 2 min/lado + Isquio sentado 3 min/lado + Movilizacion de tobillo 2 min/lado.',
  },
  {
    id: 'post_squash_mobility',
    name: 'Movilidad post-squash',
    focus: ['sport_specific', 'hip', 'shoulder_thoracic'],
    category: 'active',
    tags: ['squash', 'post_session', 'hip', 'shoulder', 'thoracic', 'recovery'],
    description: 'Rutina post-squash para cadera, hombro y toracica. Restaura rango tras el patron especifico del squash.',
    typicalDuration: '20-25 min',
    suitableSportContext: ['squash'],
    typicalStructure: 'CARs de hombro pasivo 5/lado + Rotacion toracica 10/lado + 90/90 de cadera 2 min/lado + Flexor de cadera 2 min/lado + Dorsiflexion de tobillo 1 min/lado.',
  },
  {
    id: 'post_cycling_mobility',
    name: 'Movilidad post-ciclismo',
    focus: ['sport_specific', 'hip', 'shoulder_thoracic'],
    category: 'passive',
    tags: ['cycling', 'post_session', 'hip_flexor', 'low_back', 'neck', 'recovery'],
    description: 'Rutina post-bici para psoas, low back, cervical y toracica. Contrarresta postura en flexion del ciclismo.',
    typicalDuration: '20-30 min',
    suitableSportContext: ['cycling'],
    typicalStructure: 'Estiramiento de flexor de cadera en banco 3 min/lado + Extension toracica con rodillo de espuma 5 min + Gato-camello 2x10 + Cervical suave 2 min + Rotacion toracica 3x10/lado + Flexor de cadera arrodillado 2 min/lado.',
  },
  {
    id: 'post_strength_reset',
    name: 'Reset post-fuerza',
    focus: ['sport_specific', 'hip', 'shoulder_thoracic'],
    category: 'active',
    tags: ['strength', 'post_session', 'reset', 'hips', 'upper_back'],
    description: 'Reset post-fuerza para recuperar rango util despues de bisagra, sentadilla, preses y remos pesados.',
    typicalDuration: '18-25 min',
    suitableSportContext: ['strength'],
    typicalStructure: 'Sentadilla profunda con respiracion 90s + Apertura de flexor de cadera 2 min/lado + Apertura toracica 8/lado + Deslizamiento de hombros en pared 10 + Rockback de aductores 10/lado.',
  },
  {
    id: 'pre_training_activation',
    name: 'Activacion pre-entrenamiento',
    focus: ['activation'],
    category: 'activation',
    tags: ['activation', 'dynamic', 'pre_session', 'warmup', 'beginner_friendly'],
    description: 'Activacion dinamica pre-entrenamiento. Moviliza las articulaciones clave sin fatigarse.',
    typicalDuration: '10-15 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    suitablePhases: ['base', 'build', 'peak', 'taper', 'race'],
    typicalStructure: 'Balanceos de pierna 10/lado + Circulos de cadera 10/lado + Circulos de brazos 10/lado + Caminata de manos 5 + Estocada con rotacion 5/lado + Sentadilla profunda 10.',
  },
]

export function findMobilitySessionById(id: string): MobilitySessionDefinition | undefined {
  return MOBILITY_SESSION_LIBRARY.find((s) => s.id === id)
}

export function getMobilitySessionsForSport(sport: MobilitySportContext): MobilitySessionDefinition[] {
  return MOBILITY_SESSION_LIBRARY.filter((s) => s.suitableSportContext.includes(sport))
}
