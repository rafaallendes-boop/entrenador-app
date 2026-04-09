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

export const MOBILITY_SESSION_LIBRARY: MobilitySessionDefinition[] = [
  // ─── hip ──────────────────────────────────────────────────────────────────────
  {
    id: 'hip_full_range',
    name: 'Movilidad de cadera completa',
    focus: ['hip'],
    category: 'active',
    tags: ['hip', 'flexors', 'rotators', 'functional', 'base', 'build'],
    description: 'Trabajo completo de cadera: flexores, rotadores externos, aductores y extensores. Base para todos los deportes.',
    typicalDuration: '25-35 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    typicalStructure: 'CARs de cadera 2×5c/l + Couch stretch 2min/l + 90/90 hip rotation 2min/l + figura 4 activa 90s/l + hip flexor dinámico 10rep/l.',
  },
  {
    id: 'hip_flexor_release',
    name: 'Liberación de flexores de cadera',
    focus: ['hip'],
    category: 'passive',
    tags: ['hip', 'flexors', 'psoas', 'cycling', 'running', 'tightness'],
    description: 'Sesión específica para psoas e ilíaco: músculos que se acortan en ciclismo, running y trabajo de escritorio.',
    typicalDuration: '15-25 min',
    suitableSportContext: ['cycling', 'running', 'strength'],
    typicalStructure: 'Couch stretch 3min/l + Hip flexor dinámico 3×10/l + Kneeling lunge activo 2min/l + 90/90 posterior 2min/l.',
  },

  // ─── ankle_foot ──────────────────────────────────────────────────────────────
  {
    id: 'ankle_dorsiflexion',
    name: 'Movilidad de tobillo y dorsiflexión',
    focus: ['ankle_foot'],
    category: 'active',
    tags: ['ankle', 'dorsiflexion', 'squash', 'running', 'squat', 'lunge'],
    description: 'Trabajo de dorsiflexión de tobillo: limitante clave en lunge de squash, sentadilla y recepción en running.',
    typicalDuration: '15-20 min',
    suitableSportContext: ['squash', 'running', 'strength'],
    typicalStructure: 'Movilización de tobillo en pared 3×10/l + Dorsiflexión con banda 2min/l + Excéntrico de gemelo 3×10/l + Arch circles 10 rep/l.',
  },

  // ─── shoulder_thoracic ───────────────────────────────────────────────────────
  {
    id: 'shoulder_cars',
    name: 'CARs de hombro y apertura torácica',
    focus: ['shoulder_thoracic'],
    category: 'active',
    tags: ['shoulder', 'thoracic', 'squash', 'strength', 'rotation', 'CARs'],
    description: 'CARs de hombro para rango activo controlado en toda la circunferencia glenohumeral. Crítico en squash.',
    typicalDuration: '20-25 min',
    suitableSportContext: ['squash', 'strength'],
    typicalStructure: 'CARs de hombro 2×5c/l + Rotación torácica en cuadrupedia 3×10/l + Apertura con foam roller 5min + Remo en suelo 3×10.',
  },
  {
    id: 'thoracic_mobility',
    name: 'Movilidad torácica y rotación',
    focus: ['shoulder_thoracic'],
    category: 'active',
    tags: ['thoracic', 'rotation', 'squash', 'cycling', 'posture', 'extension'],
    description: 'Rotación y extensión torácica: limitante en todos los deportes de rotación y antídoto a postura ciclista.',
    typicalDuration: '20-25 min',
    suitableSportContext: ['squash', 'cycling', 'strength', 'general'],
    typicalStructure: 'Foam roller extensión torácica 3×8 + Rotaciones en cuadrupedia 3×10/l + Thread the needle 2×10/l + Cat-cow 2×10.',
  },

  // ─── full_body ────────────────────────────────────────────────────────────────
  {
    id: 'full_body_flow',
    name: 'Flujo de movilidad global',
    focus: ['full_body'],
    category: 'dynamic',
    tags: ['full_body', 'flow', 'general', 'recovery', 'transition', 'beginner_friendly'],
    description: 'Rutina de movilidad global de baja intensidad. Ideal como sesión de recuperación o transición entre bloques.',
    typicalDuration: '30-40 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    typicalStructure: 'World\'s greatest stretch 5/l + Hip 90/90 flow 2min/l + Thoracic rotation 10/l + CARs hombro 5/l + Ankle circles + Child\'s pose 3min.',
  },
  {
    id: 'recovery_mobility',
    name: 'Movilidad de recuperación activa',
    focus: ['full_body'],
    category: 'passive',
    tags: ['recovery', 'passive', 'low_load', 'transition', 'taper', 'beginner_friendly'],
    description: 'Sesión de movilidad pasiva para recuperación sin carga. RPE 2-3. Apta para día de descanso activo.',
    typicalDuration: '30-45 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    suitablePhases: ['taper', 'transition', 'race'],
    typicalStructure: 'Piriforme supino 3min/l + Hip flexor pasivo 3min/l + Aductor en suelo 3min/l + Pecho abierto con foam roller 5min + Cervical suave.',
  },

  // ─── sport_specific ──────────────────────────────────────────────────────────
  {
    id: 'post_run_mobility',
    name: 'Movilidad post-running',
    focus: ['sport_specific', 'hip', 'ankle_foot'],
    category: 'passive',
    tags: ['running', 'post_session', 'hip', 'calf', 'hamstring', 'recovery'],
    description: 'Rutina post-running para cadera, gemelo, isquio y tobillo. Reduce rigidez y acelera recuperación.',
    typicalDuration: '20-30 min',
    suitableSportContext: ['running'],
    typicalStructure: 'Gemelo excéntrico 3×10/l + Piriforme supino 3min/l + Hip flexor 2min/l + Isquio sentado 3min/l + Tobillo movilización 2min/l.',
  },
  {
    id: 'post_squash_mobility',
    name: 'Movilidad post-squash',
    focus: ['sport_specific', 'hip', 'shoulder_thoracic'],
    category: 'active',
    tags: ['squash', 'post_session', 'hip', 'shoulder', 'thoracic', 'recovery'],
    description: 'Rutina post-squash para cadera, hombro y torácica. Restaura rango tras el patrón específico del squash.',
    typicalDuration: '20-25 min',
    suitableSportContext: ['squash'],
    typicalStructure: 'CARs hombro pasivo 5/l + Rotación torácica 10/l + 90/90 hip 2min/l + Flexor cadera 2min/l + Dorsiflexión tobillo 1min/l.',
  },
  {
    id: 'post_cycling_mobility',
    name: 'Movilidad post-ciclismo',
    focus: ['sport_specific', 'hip'],
    category: 'passive',
    tags: ['cycling', 'post_session', 'hip_flexor', 'low_back', 'neck', 'recovery'],
    description: 'Rutina post-bici para psoas, low back, cervical y torácica. Contrarresta postura en flexión del ciclismo.',
    typicalDuration: '20-30 min',
    suitableSportContext: ['cycling'],
    typicalStructure: 'Couch stretch 3min/l + Extensión torácica foam roller 5min + Cat-cow 2×10 + Cervical suave 2min + Rotación torácica 3×10/l + Hip flexor kneeling 2min/l.',
  },

  // ─── activation ──────────────────────────────────────────────────────────────
  {
    id: 'pre_training_activation',
    name: 'Activación pre-entrenamiento',
    focus: ['activation'],
    category: 'activation',
    tags: ['activation', 'dynamic', 'pre_session', 'warmup', 'beginner_friendly'],
    description: 'Activación dinámica pre-entrenamiento. Moviliza las articulaciones clave sin fatigarse. No estática pasiva.',
    typicalDuration: '10-15 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    suitablePhases: ['base', 'build', 'peak', 'taper', 'race'],
    typicalStructure: 'Leg swings 10/l + Hip circles 10/l + Arm circles 10/l + Inchworm 5 + Lunge con rotación 5/l + Squat profundo 10.',
  },
]

export function findMobilitySessionById(id: string): MobilitySessionDefinition | undefined {
  return MOBILITY_SESSION_LIBRARY.find(s => s.id === id)
}

export function getMobilitySessionsForSport(sport: MobilitySportContext): MobilitySessionDefinition[] {
  return MOBILITY_SESSION_LIBRARY.filter(s => s.suitableSportContext.includes(sport))
}
