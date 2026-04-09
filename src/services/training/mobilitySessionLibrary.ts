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
  {
    id: 'hip_full_range',
    name: 'Movilidad de cadera completa',
    focus: ['hip'],
    category: 'active',
    tags: ['hip', 'flexors', 'rotators', 'functional', 'base', 'build'],
    description: 'Trabajo completo de cadera: flexores, rotadores externos, aductores y extensores. Base para todos los deportes.',
    typicalDuration: '25-35 min',
    suitableSportContext: ['squash', 'running', 'cycling', 'strength', 'general'],
    typicalStructure: 'CARs de cadera 2x5/l + Couch stretch 2min/l + 90/90 hip rotation 2min/l + figura 4 activa 90s/l + hip flexor dinamico 10rep/l.',
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
    typicalStructure: 'Couch stretch 3min/l + Hip flexor dinamico 3x10/l + Kneeling lunge activo 2min/l + 90/90 posterior 2min/l.',
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
    typicalStructure: 'Movilizacion de tobillo en pared 3x10/l + Dorsiflexion con banda 2min/l + Excentrico de gemelo 3x10/l + Arch circles 10 rep/l.',
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
    typicalStructure: 'CARs de hombro 2x5/l + Rotacion toracica en cuadrupedia 3x10/l + Apertura con foam roller 5min + Remo en suelo 3x10.',
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
    typicalStructure: 'Foam roller extension toracica 3x8 + Rotaciones en cuadrupedia 3x10/l + Thread the needle 2x10/l + Cat-cow 2x10.',
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
    typicalStructure: 'Worlds greatest stretch 4/l + squat prying 90s + thoracic opener 8/l + ankle rocks 10/l + shoulder opener 8/l.',
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
    typicalStructure: 'Worlds greatest stretch 5/l + Hip 90/90 flow 2min/l + Thoracic rotation 10/l + CARs hombro 5/l + Ankle circles + Childs pose 3min.',
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
    typicalStructure: 'Piriforme supino 3min/l + Hip flexor pasivo 3min/l + Aductor en suelo 3min/l + Pecho abierto con foam roller 5min + Cervical suave.',
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
    typicalStructure: 'Gemelo excentrico 3x10/l + Piriforme supino 3min/l + Hip flexor 2min/l + Isquio sentado 3min/l + Tobillo movilizacion 2min/l.',
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
    typicalStructure: 'CARs hombro pasivo 5/l + Rotacion toracica 10/l + 90/90 hip 2min/l + Flexor cadera 2min/l + Dorsiflexion tobillo 1min/l.',
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
    typicalStructure: 'Couch stretch 3min/l + Extension toracica foam roller 5min + Cat-cow 2x10 + Cervical suave 2min + Rotacion toracica 3x10/l + Hip flexor kneeling 2min/l.',
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
    typicalStructure: 'Breathing squat hold 90s + Hip flexor opener 2min/l + Thoracic opener 8/l + Wall slide 10 + Adductor rockback 10/l.',
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
    typicalStructure: 'Leg swings 10/l + Hip circles 10/l + Arm circles 10/l + Inchworm 5 + Lunge con rotacion 5/l + Squat profundo 10.',
  },
]

export function findMobilitySessionById(id: string): MobilitySessionDefinition | undefined {
  return MOBILITY_SESSION_LIBRARY.find((s) => s.id === id)
}

export function getMobilitySessionsForSport(sport: MobilitySportContext): MobilitySessionDefinition[] {
  return MOBILITY_SESSION_LIBRARY.filter((s) => s.suitableSportContext.includes(sport))
}
