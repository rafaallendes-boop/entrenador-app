import type { ExerciseGroup } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'

export type ExerciseCategory = 'lower' | 'upper' | 'core' | 'full_body'
export type MovementPattern = 'squat' | 'hinge' | 'push' | 'pull' | 'rotation' | 'carry' | 'locomotion'
export type IntensityType = 'strength' | 'power' | 'hypertrophy' | 'stability' | 'recovery'
export type EquipmentType =
  | 'barbell'
  | 'dumbbell'
  | 'bodyweight'
  | 'machine'
  | 'cable'
  | 'kettlebell'
  | 'medball'
  | 'bands'
  | 'trap_bar'
  | 'trx'
  | 'box'
  | 'ladder'
  | 'plate'
  | 'stability_ball'
  | 'assault_bike'
  | 'air_treadmill'
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'
export type ExerciseRiskLevel = 'low' | 'medium' | 'high'
export type ExerciseFatigueCost = 'low' | 'medium' | 'high'
export type ExercisePhase = 'base' | 'build' | 'peak' | 'taper' | 'transition' | 'race'
export type ExerciseRotationGroup = 'A' | 'B' | 'C'
export type Exercise1RMReference = 'squat' | 'deadlift' | 'benchPress' | 'overheadPress'

export interface StrengthLoadReference {
  /** Levantamiento del perfil contra el que se calcula la carga. */
  lift: Exercise1RMReference
  /** Multiplicador de la carga derivada. Ausente significa sin peso derivado. */
  factor?: number
  /** Permite que el selector puntúe y asigne porcentaje usando esta referencia. */
  selectorEligible: boolean
}

export type StrengthExerciseMatchKind = 'ref' | 'exact' | 'alias' | 'substring' | 'ambiguous'

/**
 * Procedencia de una resolución de ejercicio.
 *
 * `ambiguous` no entrega `definition`: prescribir carga sobre un fragmento que
 * empata entre varios ejercicios es adivinar. Sí entrega `candidates`, porque
 * clasificar el bloque de la sesión no es fail-closed (spec §2) y descartarlos
 * mandaba nombres perfectamente reconocibles a `other`.
 */
export type StrengthExerciseResolution =
  | {
    definition: ExerciseDefinition
    matchKind: Exclude<StrengthExerciseMatchKind, 'ambiguous'>
    candidates: ExerciseDefinition[]
  }
  | {
    definition?: undefined
    matchKind: 'ambiguous'
    candidates: ExerciseDefinition[]
  }

export interface ExerciseDefinition {
  id: string
  name: string
  category: ExerciseCategory
  movement: MovementPattern
  intensityType: IntensityType
  equipment: EquipmentType[]
  unilateral?: boolean
  tags: string[]
  description: string
  aliases?: string[]
  difficulty?: ExperienceLevel
  sportsTransfer?: string[]
  squashTransfer?: string[]
  riskLevel?: ExerciseRiskLevel
  fatigueCost?: ExerciseFatigueCost
  loadReference?: StrengthLoadReference
  /** Cómo se prescribe el volumen. Ausente equivale a repeticiones. */
  prescriptionUnit?: 'reps' | 'seconds'
  appropriateForPhases?: ExercisePhase[]
  blockRotationGroup?: ExerciseRotationGroup
}

export type StrengthExerciseRole = 'main_lift' | 'accessory' | 'trunk' | 'power'

const RAW_STRENGTH_EXERCISE_LIBRARY: ExerciseDefinition[] = [
  {
    id: 'back_squat',
    name: 'Sentadilla trasera con barra',
    category: 'lower',
    movement: 'squat',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['lower_strength', 'gym', 'compound', 'advanced', 'athletic_transfer', 'squash_specific'],
    description: 'Sentadilla bilateral con barra en la espalda. Patrón principal de fuerza de tren inferior y producción de fuerza.',
    aliases: ['Back squat', 'Sentadilla', 'Barbell back squat'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running', 'cycling'],
    squashTransfer: ['force_production', 'deceleration'],
    riskLevel: 'medium',
    fatigueCost: 'high',
  },
  {
    id: 'front_squat',
    name: 'Sentadilla frontal',
    category: 'lower',
    movement: 'squat',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['lower_strength', 'gym', 'compound', 'athletic_transfer', 'squash_specific'],
    description: 'Sentadilla con barra apoyada en los hombros delante del cuello. Más demanda de tronco y énfasis en cuádriceps.',
    aliases: ['Sentadilla frontal', 'Barbell front squat'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['force_production', 'trunk_stiffness'],
    riskLevel: 'medium',
    fatigueCost: 'high',
  },
  {
    id: 'goblet_squat',
    name: 'Sentadilla goblet',
    category: 'lower',
    movement: 'squat',
    intensityType: 'hypertrophy',
    equipment: ['dumbbell', 'kettlebell'],
    tags: ['lower_strength', 'beginner_friendly', 'home_gym', 'general_fitness'],
    description: 'Sostén una mancuerna o kettlebell frente al pecho y realiza la sentadilla con el tronco estable. Es una opción accesible para practicar técnica o sumar volumen.',
    aliases: ['Goblet squat'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Sentadilla búlgara',
    category: 'lower',
    movement: 'squat',
    intensityType: 'hypertrophy',
    equipment: ['dumbbell', 'barbell', 'bodyweight'],
    unilateral: true,
    tags: ['lower_strength', 'unilateral', 'athletic_transfer', 'gym', 'home_gym', 'squash_specific', 'lateral_strength'],
    description: 'Sentadilla a una pierna con el pie de atrás elevado. Fuerza unilateral, equilibrio y control de tronco.',
    aliases: ['Bulgarian split squat', 'Sentadilla bulgara', 'Búlgaras con mancuernas'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['single_leg_strength', 'deceleration'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'walking_lunge',
    name: 'Zancadas caminando',
    category: 'lower',
    movement: 'locomotion',
    intensityType: 'hypertrophy',
    equipment: ['dumbbell', 'barbell', 'bodyweight'],
    unilateral: true,
    tags: ['lower_strength', 'unilateral', 'athletic_transfer', 'general_fitness', 'squash_specific'],
    description: 'Caminata dando zancadas alternas con mancuernas o barra. Trabajo unilateral con demanda de coordinación y estabilidad.',
    aliases: ['Walking lunge', 'Zancadas', 'Lunges'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['court_lunge_capacity', 'single_leg_strength'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'romanian_deadlift',
    name: 'Peso muerto rumano',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'strength',
    equipment: ['barbell', 'dumbbell'],
    tags: ['lower_strength', 'hinge', 'gym', 'athletic_transfer', 'squash_specific'],
    description: 'Bisagra de cadera con piernas semi-extendidas y barra cercana al cuerpo. Énfasis en isquios, glúteos y rigidez de tronco.',
    aliases: ['Romanian deadlift', 'RDL'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'running', 'cycling', 'squash'],
    squashTransfer: ['posterior_chain', 'deceleration'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'deadlift',
    name: 'Peso muerto',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['lower_strength', 'gym', 'compound', 'advanced'],
    description: 'Bisagra bilateral pesada con barra desde el piso. Fuerza máxima y fuerza global.',
    aliases: ['Deadlift'],
    difficulty: 'advanced',
    sportsTransfer: ['strength'],
  },
  {
    id: 'sumo_deadlift',
    name: 'Peso muerto sumo',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['lower_strength', 'gym', 'compound', 'posterior_chain'],
    description: 'Realiza el peso muerto con una separación amplia de pies y el agarre por dentro de las piernas. La variante aumenta la participación de aductores sin dejar de ser una bisagra pesada.',
    aliases: ['Sumo deadlift', 'Peso muerto estilo sumo'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['force_production', 'posterior_chain'],
    riskLevel: 'medium',
    fatigueCost: 'high',
  },
  {
    id: 'trap_bar_deadlift',
    name: 'Peso muerto con trap bar',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'strength',
    equipment: ['trap_bar', 'barbell'],
    tags: ['lower_strength', 'gym', 'athletic_transfer', 'general_fitness', 'squash_specific'],
    description: 'Bisagra con barra hexagonal, técnicamente más simple que el peso muerto convencional. Buena alternativa cuando el peso muerto clásico carga mucho la zona lumbar.',
    aliases: ['Trap bar deadlift', 'Trap bar DL', 'Hex bar deadlift'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running', 'cycling'],
    squashTransfer: ['force_production', 'posterior_chain'],
    riskLevel: 'medium',
    fatigueCost: 'high',
  },
  {
    id: 'hip_thrust',
    name: 'Empuje de cadera',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'hypertrophy',
    equipment: ['barbell', 'dumbbell', 'bodyweight'],
    tags: ['lower_strength', 'glute_focus', 'gym', 'home_gym', 'athletic_transfer', 'squash_specific'],
    description: 'Apoya la espalda en un banco y extiende la cadera con la barra sobre la pelvis. Entrena fuerza de glúteos con transferencia a aceleraciones y saltos.',
    aliases: ['Hip thrust'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash', 'running', 'cycling'],
    squashTransfer: ['hip_extension', 'acceleration'],
    riskLevel: 'low',
    fatigueCost: 'medium',
  },
  {
    id: 'step_up',
    name: 'Subida al cajón',
    category: 'lower',
    movement: 'locomotion',
    intensityType: 'hypertrophy',
    equipment: ['dumbbell', 'bodyweight'],
    unilateral: true,
    tags: ['lower_strength', 'unilateral', 'beginner_friendly', 'home_gym', 'athletic_transfer', 'squash_specific'],
    description: 'Subida unilateral a un cajón con mancuernas o peso corporal. Transferencia clara a escaleras, carrera y movimiento en cancha.',
    aliases: ['Step up', 'Step-up', 'Subida al cajon'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'running', 'squash'],
    squashTransfer: ['single_leg_strength', 'court_lunge_capacity'],
    riskLevel: 'low',
    fatigueCost: 'medium',
  },
  {
    id: 'bench_press',
    name: 'Press banca',
    category: 'upper',
    movement: 'push',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['upper_strength', 'gym', 'compound'],
    description: 'Press horizontal con barra. Patrón principal de empuje superior.',
    aliases: ['Bench press'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['upper_body_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'incline_bench_press',
    name: 'Press inclinado con barra',
    category: 'upper',
    movement: 'push',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['upper_strength', 'gym', 'compound'],
    description: 'Press inclinado con barra a 30-45 grados. Variante pesada de empuje con sesgo en pectoral superior y hombro anterior.',
    aliases: ['Incline bench press', 'Press banca inclinado', 'Press inclinado'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['upper_body_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'close_grip_bench_press',
    name: 'Press banca agarre cerrado',
    category: 'upper',
    movement: 'push',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['upper_strength', 'gym', 'compound', 'triceps'],
    description: 'Haz press banca con un agarre más cerrado que el habitual. Mantiene el patrón de empuje y aumenta el trabajo de tríceps sin cambiar el levantamiento principal.',
    aliases: ['Close grip bench press', 'Press cerrado'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['upper_body_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'incline_dumbbell_press',
    name: 'Press inclinado con mancuernas',
    category: 'upper',
    movement: 'push',
    intensityType: 'hypertrophy',
    equipment: ['dumbbell'],
    tags: ['upper_strength', 'hypertrophy', 'gym', 'home_gym'],
    description: 'Press inclinado a 30-45° con mancuernas. Más amigable con el hombro y sesgo de hipertrofia moderado.',
    aliases: ['Incline dumbbell press'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'overhead_press',
    name: 'Press vertical',
    category: 'upper',
    movement: 'push',
    intensityType: 'strength',
    equipment: ['barbell', 'dumbbell'],
    tags: ['upper_strength', 'gym', 'compound', 'athletic_transfer', 'squash_specific'],
    description: 'Empuja la barra o las mancuernas en vertical hasta extender los brazos por encima de la cabeza. Mantén el tronco firme y controla la posición de los hombros.',
    aliases: ['Overhead press', 'Press hombro', 'Press militar', 'Press sobre cabeza'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['trunk_stiffness', 'shoulder_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'push_press',
    name: 'Push press',
    category: 'upper',
    movement: 'push',
    intensityType: 'power',
    equipment: ['barbell', 'dumbbell'],
    tags: ['upper_strength', 'power', 'gym', 'advanced', 'athletic_transfer'],
    description: 'Inicia el press con una flexión corta de piernas y transmite ese impulso a la barra o las mancuernas. Busca velocidad y una recepción estable por encima de la cabeza.',
    aliases: ['Push press', 'Push press con impulso'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
  },
  {
    id: 'landmine_press',
    name: 'Press con barra en landmine',
    category: 'upper',
    movement: 'push',
    intensityType: 'strength',
    equipment: ['barbell'],
    tags: ['upper_strength', 'gym', 'athletic_transfer', 'shoulder_friendly', 'squash_specific'],
    description: 'Empuja la barra en diagonal desde el hombro usando el anclaje landmine. Permite entrenar un press fuerte con menor demanda vertical y buen control del tronco.',
    aliases: ['Press landmine', 'Landmine shoulder press', 'Landmine press'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['trunk_stiffness', 'shoulder_resilience'],
    riskLevel: 'low',
    fatigueCost: 'medium',
  },
  {
    id: 'pull_up',
    name: 'Dominada',
    category: 'upper',
    movement: 'pull',
    intensityType: 'strength',
    equipment: ['bodyweight'],
    tags: ['upper_strength', 'compound', 'gym', 'home_gym', 'squash_specific'],
    description: 'Dominada con peso corporal, agarre supinado o prono. Patrón principal de tirón vertical.',
    aliases: ['Pull up', 'Pull-up', 'Dominadas'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['shoulder_resilience', 'upper_back_strength'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'assisted_pull_up',
    name: 'Dominada asistida',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['machine', 'bands'],
    tags: ['upper_strength', 'beginner_friendly', 'gym', 'home_gym'],
    description: 'Dominada con asistencia de máquina o banda. Permite construir volumen de tirón cuando aún no salen libres.',
    aliases: ['Assisted pull up', 'Assisted pull-up'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'bent_over_row',
    name: 'Remo inclinado',
    category: 'upper',
    movement: 'pull',
    intensityType: 'strength',
    equipment: ['barbell', 'dumbbell'],
    tags: ['upper_strength', 'gym', 'compound'],
    description: 'Remo horizontal con barra y tronco inclinado. Demanda fuerza de espalda alta y de tronco.',
    aliases: ['Bent over row'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
  },
  {
    id: 'chest_supported_row',
    name: 'Remo con pecho apoyado',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['dumbbell', 'machine'],
    tags: ['upper_strength', 'hypertrophy', 'gym', 'beginner_friendly'],
    description: 'Remo con pecho apoyado en banco inclinado. Reduce la fatiga lumbar y aísla la espalda alta.',
    aliases: ['Chest supported row'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'lat_pulldown',
    name: 'Jalón al pecho',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['machine', 'cable'],
    tags: ['upper_strength', 'hypertrophy', 'gym', 'beginner_friendly'],
    description: 'Tirón vertical en polea hacia el pecho. Opción controlada para volumen y trabajo amigable con el hombro.',
    aliases: ['Lat pulldown'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'pallof_press',
    name: 'Press Pallof',
    category: 'core',
    movement: 'rotation',
    intensityType: 'stability',
    equipment: ['cable', 'bands'],
    tags: ['core', 'stability', 'athletic_transfer', 'gym', 'home_gym', 'squash_specific', 'anti_rotation'],
    description: 'Con una polea o banda tirando desde un costado, extiende los brazos al frente sin dejar que el tronco gire. Mantén tensión abdominal durante toda la repetición.',
    aliases: ['Pallof press', 'Anti-rotation press'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash', 'running', 'cycling'],
    squashTransfer: ['anti_rotation', 'trunk_stiffness'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'dead_bug',
    name: 'Dead bug — control de tronco',
    category: 'core',
    movement: 'rotation',
    intensityType: 'stability',
    equipment: ['bodyweight'],
    tags: ['core', 'stability', 'beginner_friendly', 'home_gym', 'anti_extension'],
    description: 'Acuéstate boca arriba y extiende de forma alternada un brazo y la pierna contraria sin perder la posición de la pelvis. Coordina la respiración con el control del tronco.',
    aliases: ['Dead bug', 'Bicho muerto', 'Control de tronco dead bug'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness', 'squash'],
    squashTransfer: ['pelvic_control', 'trunk_stiffness'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'plank',
    name: 'Plancha frontal',
    category: 'core',
    movement: 'carry',
    intensityType: 'stability',
    equipment: ['bodyweight'],
    tags: ['core', 'stability', 'beginner_friendly', 'home_gym'],
    description: 'Plancha isométrica de tronco con dosificación simple. Glúteos y abdomen apretados.',
    aliases: ['Plank'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'side_plank',
    name: 'Plancha lateral',
    category: 'core',
    movement: 'carry',
    intensityType: 'stability',
    equipment: ['bodyweight'],
    tags: ['core', 'stability', 'unilateral', 'home_gym', 'squash_specific', 'lateral_stability'],
    description: 'Plancha lateral en antebrazo para estabilidad lateral del tronco. Útil para corredores y deportes de raqueta.',
    aliases: ['Side plank'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'running', 'squash'],
    squashTransfer: ['lateral_stability', 'anti_lateral_flexion'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'med_ball_rotational_throw',
    name: 'Lanzamiento rotacional con balón medicinal contra pared',
    category: 'core',
    movement: 'rotation',
    intensityType: 'power',
    equipment: ['medball'],
    tags: ['core', 'power', 'athletic_transfer', 'gym'],
    description: 'Lanzamiento rotacional explosivo con balón medicinal contra una pared. Potencia rotacional con fuerte transferencia a deportes de raqueta.',
    aliases: ['Med ball rotational throw'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
  },
  {
    id: 'cable_chop',
    name: 'Corte diagonal en polea',
    category: 'core',
    movement: 'rotation',
    intensityType: 'stability',
    equipment: ['cable', 'bands'],
    tags: ['core', 'rotation', 'athletic_transfer', 'gym', 'home_gym'],
    description: 'Corte diagonal en polea de arriba hacia abajo. Transferencia rotacional controlada entre caderas y hombros.',
    aliases: ['Cable chop'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash', 'running'],
  },
  {
    id: 'farmer_carry',
    name: 'Caminata del granjero',
    category: 'core',
    movement: 'carry',
    intensityType: 'stability',
    equipment: ['dumbbell', 'kettlebell'],
    tags: ['core', 'carry', 'athletic_transfer', 'gym', 'home_gym'],
    description: 'Camina sosteniendo una mancuerna o kettlebell en cada mano. Mantén el tronco firme, los hombros estables y una marcha natural durante todo el recorrido.',
    aliases: ['Farmer carry'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'running', 'squash', 'cycling'],
  },
  {
    id: 'box_jump',
    name: 'Salto al cajón',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['bodyweight', 'box'],
    tags: ['power', 'athletic_transfer', 'gym', 'squash_specific', 'jump_power'],
    description: 'Salto vertical sobre un cajón con intención explosiva. Aterriza suave en cuclillas; bajar caminando, no saltando.',
    aliases: ['Box jump', 'Salto al cajon'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'running', 'squash'],
    squashTransfer: ['vertical_power', 'landing_quality'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'jump_squat',
    name: 'Sentadilla con salto',
    category: 'full_body',
    movement: 'squat',
    intensityType: 'power',
    equipment: ['bodyweight', 'dumbbell'],
    tags: ['power', 'athletic_transfer', 'gym', 'home_gym'],
    description: 'Sentadilla explosiva terminando en salto. Énfasis en velocidad de producción de fuerza.',
    aliases: ['Jump squat'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'running', 'squash'],
  },
  {
    id: 'med_ball_slam',
    name: 'Golpe al suelo con balón medicinal',
    category: 'full_body',
    movement: 'rotation',
    intensityType: 'power',
    equipment: ['medball'],
    tags: ['power', 'athletic_transfer', 'gym'],
    description: 'Lanzar el balón medicinal contra el suelo con fuerza desde arriba. Patrón explosivo de cuerpo entero con bajo costo excéntrico.',
    aliases: ['Med ball slam'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'rotational_med_ball_throw',
    name: 'Lanzamiento rotacional con balón medicinal',
    category: 'full_body',
    movement: 'rotation',
    intensityType: 'power',
    equipment: ['medball'],
    tags: ['power', 'athletic_transfer', 'gym'],
    description: 'Lanzamiento rotacional explosivo con balón medicinal contra la pared. Intención de transferencia deportiva.',
    aliases: ['Rotational med ball throw'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
  },
  {
    id: 'kettlebell_swing',
    name: 'Swing con kettlebell',
    category: 'full_body',
    movement: 'hinge',
    intensityType: 'power',
    equipment: ['kettlebell'],
    tags: ['power', 'athletic_transfer', 'home_gym', 'gym'],
    description: 'Lleva la kettlebell hasta la altura del pecho mediante una extensión explosiva de cadera. El impulso nace de la bisagra, no de levantar el peso con los brazos.',
    aliases: ['Kettlebell swing'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'running', 'squash'],
  },
  {
    id: 'clean',
    name: 'Cargada',
    category: 'full_body',
    movement: 'hinge',
    intensityType: 'power',
    equipment: ['barbell'],
    tags: ['power', 'olympic_power', 'advanced', 'high_skill', 'athletic_transfer', 'squash_specific'],
    description: 'Lleva la barra desde el piso hasta los hombros mediante un tirón explosivo y una recepción estable. Es un movimiento avanzado: aprende la técnica antes de aumentar la carga.',
    aliases: ['Clean', 'Power clean'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['rate_of_force_development', 'explosive_start'],
    riskLevel: 'high',
    fatigueCost: 'high',
  },
  {
    id: 'clean_high_pull',
    name: 'Tirón alto de cargada',
    category: 'full_body',
    movement: 'hinge',
    intensityType: 'power',
    equipment: ['barbell'],
    tags: ['power', 'olympic_power', 'advanced', 'high_skill', 'athletic_transfer', 'squash_specific'],
    description: 'Extiende cadera, rodillas y tobillos para realizar un tirón alto explosivo, sin recibir la barra en los hombros. Desarrolla potencia mientras se aprende la cargada completa.',
    aliases: ['Clean high pull', 'High pull', 'Clean pull alto'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['rate_of_force_development', 'posterior_chain_power'],
    riskLevel: 'high',
    fatigueCost: 'medium',
  },
  {
    id: 'split_jerk',
    name: 'Envión en tijera',
    category: 'full_body',
    movement: 'push',
    intensityType: 'power',
    equipment: ['barbell'],
    tags: ['power', 'olympic_power', 'advanced', 'high_skill', 'athletic_transfer', 'squash_specific'],
    description: 'Envión olímpico explosivo con caída en tijera. Alta coordinación y estabilidad de hombro. Movimiento avanzado que requiere progresión técnica.',
    aliases: ['Split jerk', 'Jerk split', 'Envion split'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['split_stance_power', 'trunk_stiffness', 'shoulder_resilience'],
    riskLevel: 'high',
    fatigueCost: 'high',
  },
  {
    id: 'barbell_jump_squat',
    name: 'Sentadilla con salto y barra',
    category: 'full_body',
    movement: 'squat',
    intensityType: 'power',
    equipment: ['barbell'],
    tags: ['power', 'jump_power', 'advanced', 'athletic_transfer', 'squash_specific'],
    description: 'Haz una sentadilla con barra y termina cada repetición con un salto. Usa una carga ligera —como máximo 30% de tu sentadilla trasera— y aterriza con control.',
    aliases: ['Barbell jump squat', 'Jump squat con barra', 'BB jump squat'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['vertical_power', 'rate_of_force_development'],
    riskLevel: 'high',
    fatigueCost: 'high',
  },
  {
    id: 'bb_reverse_lunge',
    name: 'Zancada inversa con barra',
    category: 'lower',
    movement: 'locomotion',
    intensityType: 'hypertrophy',
    equipment: ['barbell'],
    unilateral: true,
    tags: ['lower_strength', 'unilateral', 'athletic_transfer', 'squash_specific', 'court_lunge'],
    description: 'Da una zancada hacia atrás con la barra en posición alta. Entrena desaceleración, control de cadera y fuerza en posiciones amplias de cancha.',
    aliases: ['Barbell reverse lunge', 'Reverse lunge con barra', 'Zancada atras con barra'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['court_lunge_capacity', 'deceleration', 'single_leg_strength'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'bb_side_lunge',
    name: 'Zancada lateral con barra',
    category: 'lower',
    movement: 'locomotion',
    intensityType: 'hypertrophy',
    equipment: ['barbell'],
    unilateral: true,
    tags: ['lower_strength', 'unilateral', 'athletic_transfer', 'squash_specific', 'lateral_strength', 'court_lunge'],
    description: 'Zancada lateral con barra. Fuerza en plano frontal y posiciones de pelota ancha en cancha de squash.',
    aliases: ['BB side lunges', 'Barbell side lunge', 'Lateral lunge con barra', 'Zancada lateral con barra'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['lateral_strength', 'court_lunge_capacity', 'deceleration'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'single_leg_hip_thrust',
    name: 'Empuje de cadera a una pierna',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'hypertrophy',
    equipment: ['bodyweight', 'dumbbell', 'barbell'],
    unilateral: true,
    tags: ['lower_strength', 'glute_focus', 'unilateral', 'athletic_transfer', 'squash_specific'],
    description: 'Empuje de cadera unilateral con espalda en banco. Fuerza de glúteos con menor costo lumbar que el bilateral.',
    aliases: ['Single leg hip thrust', 'SL hip thrust', 'Hip thrust una pierna'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['hip_extension', 'single_leg_strength'],
    riskLevel: 'low',
    fatigueCost: 'medium',
  },
  {
    id: 'z_press',
    name: 'Press Z',
    category: 'upper',
    movement: 'push',
    intensityType: 'strength',
    equipment: ['barbell', 'dumbbell'],
    tags: ['upper_strength', 'trunk_stability', 'gym', 'athletic_transfer', 'squash_specific'],
    description: 'Sentado en el piso con las piernas extendidas, empuja la barra o las mancuernas en vertical. Mantén el tronco erguido para exponer y entrenar el control de hombros y zona media.',
    aliases: ['Z Press', 'Z press'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['trunk_stiffness', 'shoulder_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'mixed_grip_pull_up',
    name: 'Dominada con agarre mixto',
    category: 'upper',
    movement: 'pull',
    intensityType: 'strength',
    equipment: ['bodyweight'],
    tags: ['upper_strength', 'compound', 'gym', 'squash_specific'],
    description: 'Dominada con una mano supinada y otra prona. Reta agarre y control de hombro de forma asimétrica. Alterna el agarre entre series.',
    aliases: ['Mixed grip pull up', 'Mixed grip pull-up', 'Dominada agarre mixto'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['grip_strength', 'shoulder_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'weighted_pull_up',
    name: 'Dominada lastrada',
    category: 'upper',
    movement: 'pull',
    intensityType: 'strength',
    equipment: ['bodyweight', 'plate', 'dumbbell'],
    tags: ['upper_strength', 'compound', 'gym', 'advanced', 'squash_specific'],
    description: 'Dominada con lastre (cinturón o chaleco). Fuerza máxima de tirón vertical.',
    aliases: ['Weighted pull up', 'Weighted pull-up'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['grip_strength', 'upper_back_strength'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'trx_inverted_row',
    name: 'Remo invertido en TRX',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['trx', 'bodyweight'],
    tags: ['upper_strength', 'beginner_friendly', 'home_gym', 'squash_specific'],
    description: 'Remo en suspensión con TRX. Dificultad escalable según ángulo del cuerpo. El cuerpo va recto como una tabla durante todo el movimiento.',
    aliases: ['TRX inverted row', 'TRX row', 'Remo invertido TRX'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['upper_back_strength', 'shoulder_resilience'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'half_kneeling_row',
    name: 'Remo en media rodilla',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['cable', 'bands', 'dumbbell'],
    tags: ['upper_strength', 'anti_rotation', 'athletic_transfer', 'squash_specific'],
    description: 'Desde media rodilla, tira de la polea, banda o mancuerna hacia el cuerpo. Mantén la pelvis estable y evita girar la cadera durante el remo.',
    aliases: ['Half kneeling row', '1:2 Kneeling Row', '1/2 Kneeling Row', 'Half-kneeling row', 'Remo medio arrodillado'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['anti_rotation', 'upper_back_strength'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'barbell_single_leg_inverted_row',
    name: 'Remo invertido con barra a una pierna',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['barbell', 'bodyweight'],
    unilateral: true,
    tags: ['upper_strength', 'core', 'athletic_transfer', 'squash_specific'],
    description: 'Remo invertido bajo una barra apoyando solo un pie. Suma demanda de cadena posterior y control de tronco.',
    aliases: ['Barbell single leg inverted row', 'BB single leg inverted row', 'Single leg inverted row'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['upper_back_strength', 'trunk_stiffness'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'broad_jump',
    name: 'Salto horizontal',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['bodyweight'],
    tags: ['power', 'jump_power', 'athletic_transfer', 'squash_specific'],
    description: 'Salto horizontal a máxima distancia con dos pies. Intención de aceleración y calidad de aterrizaje. Aterriza suave en cuclillas.',
    aliases: ['Broad jump'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['horizontal_power', 'landing_quality'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'single_leg_broad_jump',
    name: 'Salto horizontal a una pierna',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['bodyweight'],
    unilateral: true,
    tags: ['power', 'jump_power', 'unilateral', 'advanced', 'squash_specific'],
    description: 'Salto horizontal unilateral con aterrizaje controlado en una pierna. Potencia unilateral con alta demanda de estabilidad en la recepción.',
    aliases: ['Single leg broad jump', 'SL broad jump', 'Salto horizontal una pierna'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['single_leg_power', 'landing_quality'],
    riskLevel: 'high',
    fatigueCost: 'medium',
  },
  {
    id: 'drop_jump',
    name: 'Salto reactivo desde cajón',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['box', 'bodyweight'],
    tags: ['power', 'reactive_stiffness', 'advanced', 'high_impact', 'squash_specific'],
    description: 'Caer desde un cajón bajo y rebotar inmediatamente hacia arriba. Énfasis en rigidez reactiva y contacto con el piso menor a 0.25 s. Cajón bajo (20-30 cm).',
    aliases: ['Drop jump', 'Salto reactivo desde cajon'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['reactive_stiffness', 'split_step_quality'],
    riskLevel: 'high',
    fatigueCost: 'medium',
  },
  {
    id: 'depth_jump',
    name: 'Salto profundo',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['box', 'bodyweight'],
    tags: ['power', 'reactive_stiffness', 'advanced', 'high_impact', 'squash_specific'],
    description: 'Déjate caer desde un cajón y enlaza el aterrizaje con un salto vertical alto. Es una pliometría avanzada de alta intensidad: usa muy pocas repeticiones y prioriza la calidad.',
    aliases: ['Depth jump'],
    difficulty: 'advanced',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['reactive_stiffness', 'explosive_reacceleration'],
    riskLevel: 'high',
    fatigueCost: 'high',
  },
  {
    id: 'half_kneeling_lateral_jump',
    name: 'Salto lateral desde media rodilla',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['bodyweight'],
    unilateral: true,
    tags: ['power', 'lateral_power', 'athletic_transfer', 'squash_specific'],
    description: 'Desde media rodilla, impulsa la cadera y salta lateralmente hasta una recepción estable. Entrena potencia en el plano frontal desde una posición baja.',
    aliases: ['Half kneeling lateral jump', 'Half-kneeling lateral jump', 'Salto lateral medio arrodillado'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['lateral_power', 'court_reacceleration'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'lateral_skater_jumps',
    name: 'Saltos laterales de patinador',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['bodyweight'],
    unilateral: true,
    tags: ['power', 'lateral_power', 'athletic_transfer', 'squash_specific'],
    description: 'Saltos laterales alternando de pie en pie. Potencia lateral, desaceleración y reaceleración. Aterriza absorbiendo y empuja para el siguiente salto.',
    aliases: ['Lateral skater jumps', 'Skater jumps', 'Saltos patinador'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['lateral_power', 'deceleration'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'alternating_step_up_jump',
    name: 'Subida al cajón con salto alternado',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['box', 'bodyweight'],
    unilateral: true,
    tags: ['power', 'jump_power', 'athletic_transfer', 'squash_specific'],
    description: 'Sube de forma explosiva al cajón y cambia de pierna en el aire antes de aterrizar. Entrena potencia unilateral y ritmo; prioriza una recepción estable.',
    aliases: ['Alternating step up jump', 'Step up jump alternado'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['single_leg_power', 'court_reacceleration'],
    riskLevel: 'medium',
    fatigueCost: 'medium',
  },
  {
    id: 'pogo_jumps',
    name: 'Saltos pogo',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['bodyweight'],
    tags: ['power', 'reactive_stiffness', 'athletic_transfer', 'squash_specific'],
    description: 'Encadena saltos verticales bajos usando principalmente los tobillos. Mantén poco tiempo de contacto con el suelo y una flexión mínima de rodillas para mejorar la respuesta del split-step.',
    aliases: ['Pogo jumps', 'Pogos'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['reactive_stiffness', 'split_step_quality'],
    riskLevel: 'medium',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_bipodal_front_1',
    name: 'Escalera frontal – dos pies por cuadro',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'squash_specific', 'beginner_friendly'],
    description: 'Avanza por la escalera entrando ambos pies dentro de cada cuadro antes de pasar al siguiente. Mantén ritmo constante y postura erguida.',
    aliases: ['Escalera bipodal frente 1', 'Ladder bipodal front 1'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'split_step_quality'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_bipodal_front_2',
    name: 'Escalera frontal – dentro-dentro-fuera-fuera',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'squash_specific', 'beginner_friendly'],
    description: 'Entra con ambos pies en un cuadro y sácalos a los lados del siguiente antes de volver a entrar. Repite la secuencia dentro-dentro-fuera-fuera con ritmo y precisión.',
    aliases: ['Escalera bipodal frente 2', 'Ladder bipodal front 2', 'Escalera frontal – in-in-out-out'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'split_step_quality'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_bipodal_front_3',
    name: 'Escalera frontal – salto bipodal por cuadro',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'squash_specific', 'beginner_friendly'],
    description: 'Salta con los dos pies juntos cuadro por cuadro avanzando hacia adelante. Aterriza suave y rebota al siguiente cuadro. Foco en elasticidad de tobillo, no en altura.',
    aliases: ['Escalera bipodal frente 3', 'Ladder bipodal front 3'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'split_step_quality'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_coordinativo_front_2',
    name: 'Escalera frontal – un pie por cuadro',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'squash_specific', 'beginner_friendly'],
    description: 'Avanza por la escalera apoyando un solo pie por cuadro, alternando pie derecho e izquierdo. Foco en rapidez y precisión de apoyo.',
    aliases: ['Escalera coordinativo frente 2', 'Ladder coordination front 2'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'court_reacceleration'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_coordinativo_front_4',
    name: 'Escalera frontal – Icky shuffle',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'squash_specific', 'beginner_friendly'],
    description: 'Ejecuta el patrón Icky shuffle: dos apoyos dentro y uno fuera mientras avanzas en diagonal. Aumenta la velocidad solo cuando puedas conservar la precisión.',
    aliases: ['Escalera coordinativo frente 4', 'Ladder coordination front 4'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'court_reacceleration'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_bipodal_lateral_1',
    name: 'Escalera lateral – dos pies por cuadro',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'lateral_power', 'squash_specific', 'beginner_friendly'],
    description: 'Avanza de costado entrando los dos pies en cada cuadro antes de pasar al siguiente. Hombros al frente, cadera baja. Repite en ambas direcciones para no generar asimetría.',
    aliases: ['Escalera bipodal lateralizacion 1', 'Ladder bipodal lateral 1'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'lateral_movement'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'ladder_bipodal_lateral_3',
    name: 'Escalera lateral – dentro-dentro-fuera',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['ladder', 'bodyweight'],
    tags: ['court_footwork', 'coordination', 'lateral_power', 'squash_specific', 'beginner_friendly'],
    description: 'Avanza de costado entrando ambos pies en el cuadro y sacando uno antes del siguiente paso. Mantén la cadera baja y un ritmo lateral preciso.',
    aliases: ['Escalera bipodal lateralizacion 3', 'Ladder bipodal lateral 3', 'Escalera lateral – shuffle in-in-out'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['footwork_rhythm', 'lateral_movement'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'assault_bike_30_30',
    name: 'Bici de asalto 30/30',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['assault_bike', 'machine'],
    tags: ['cardio_specific', 'court_conditioning', 'repeat_sprint', 'squash_specific'],
    description: 'Completa 4 minutos en bici de asalto alternando 30 segundos fuertes y 30 segundos suaves. Mantén potencia alta y una postura estable durante cada esfuerzo.',
    aliases: ['Bici de asalto', 'Assault bike', 'Air bike', 'Bicicleta de asalto', 'Bici assault 30/30'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['repeat_sprint_capacity', 'short_point_recovery'],
    riskLevel: 'low',
    fatigueCost: 'high',
  },
  {
    id: 'air_treadmill_20_20',
    name: 'Trotadora curva 20/20',
    category: 'full_body',
    movement: 'locomotion',
    intensityType: 'power',
    equipment: ['air_treadmill', 'machine'],
    tags: ['cardio_specific', 'court_conditioning', 'repeat_sprint', 'squash_specific'],
    description: 'Completa 4 minutos en una trotadora curva alternando 20 segundos fuertes y 20 segundos suaves. Busca aceleraciones cortas y una técnica rápida sin prolongar el esfuerzo.',
    aliases: ['Trotadora de aire', 'Air runner', 'Curved treadmill', 'Trotadora curva', 'Cinta curva', 'Air treadmill', 'Trotadora de aire 20/20'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['repeat_sprint_capacity', 'short_point_recovery', 'acceleration'],
    riskLevel: 'medium',
    fatigueCost: 'high',
  },
  {
    id: 'copenhagen_side_plank',
    name: 'Plancha Copenhagen',
    category: 'core',
    movement: 'carry',
    intensityType: 'stability',
    equipment: ['bodyweight', 'box'],
    unilateral: true,
    tags: ['core', 'stability', 'lateral_stability', 'adductor_strength', 'squash_specific'],
    description: 'Mantén una plancha lateral con la pierna superior apoyada en un banco. Entrena aductores y estabilidad lateral; comienza con apoyo de rodilla antes de progresar al tobillo.',
    aliases: ['Copenhagen side plank', 'Copenhagen plank', 'Plancha Copenhagen', 'Plancha lateral Copenhagen'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['adductor_strength', 'lateral_stability'],
    riskLevel: 'medium',
    fatigueCost: 'low',
  },
  {
    id: 'side_plank_plate_press',
    name: 'Plancha lateral con press de disco',
    category: 'core',
    movement: 'carry',
    intensityType: 'stability',
    equipment: ['plate', 'bodyweight'],
    unilateral: true,
    tags: ['core', 'stability', 'lateral_stability', 'anti_rotation', 'squash_specific'],
    description: 'Plancha lateral sosteniendo y empujando un disco hacia arriba. Reta estabilidad lateral y control anti-rotacional. El disco va recto al techo; la cadera no cae.',
    aliases: ['Side plank + plate press', 'Side plank plate press'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['lateral_stability', 'anti_rotation'],
    riskLevel: 'medium',
    fatigueCost: 'low',
  },
  {
    id: 'stability_ball_front_plank',
    name: 'Plancha frontal en fitball',
    category: 'core',
    movement: 'carry',
    intensityType: 'stability',
    equipment: ['stability_ball', 'bodyweight'],
    tags: ['core', 'stability', 'anti_extension', 'squash_specific'],
    description: 'Apoya los antebrazos sobre un fitball y mantén una plancha frontal estable. Controla la relación entre hombros y tronco; agrega círculos pequeños para aumentar la dificultad.',
    aliases: ['Stability ball front plank', 'Swiss ball plank', 'Plancha frontal fitball'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['trunk_stiffness', 'shoulder_resilience'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'lateral_band_walk',
    name: 'Caminata lateral con banda',
    category: 'lower',
    movement: 'locomotion',
    intensityType: 'stability',
    equipment: ['bands'],
    tags: ['lower_strength', 'stability', 'lateral_strength', 'beginner_friendly', 'squash_specific'],
    description: 'Da pasos laterales cortos con una banda en las rodillas o los tobillos. Mantén el tronco quieto y las rodillas alineadas con los pies.',
    aliases: ['Lateral band walk', 'Monster walk lateral'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash', 'running'],
    squashTransfer: ['lateral_stability', 'hip_control'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'bird_dog_renegade_row',
    name: 'Remo renegado bird dog',
    category: 'core',
    movement: 'pull',
    intensityType: 'stability',
    equipment: ['dumbbell'],
    unilateral: true,
    tags: ['core', 'upper_strength', 'anti_rotation', 'squash_specific'],
    description: 'Remo en posición de plancha con mancuernas elevando la mancuerna y la pierna contralateral. Anti-rotación y control de hombro. La cadera no rota al tirar.',
    aliases: ['Bird dog renegade row', 'Bird-dog renegade row'],
    difficulty: 'intermediate',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['anti_rotation', 'shoulder_resilience'],
    riskLevel: 'medium',
    fatigueCost: 'low',
  },
  {
    id: 'half_kneeling_diagonal_plate_chop',
    name: 'Corte diagonal con disco en media rodilla',
    category: 'core',
    movement: 'rotation',
    intensityType: 'stability',
    equipment: ['plate'],
    tags: ['core', 'rotation', 'anti_rotation', 'athletic_transfer', 'squash_specific'],
    description: 'Desde media rodilla, mueve un disco en diagonal sin perder la posición de la pelvis. Mantén caderas y pies estables para que el control nazca del tronco.',
    aliases: ['Half kneeling diagonal plate chop', 'Half-kneeling plate chop', 'Corte diagonal con disco medio arrodillado'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'squash'],
    squashTransfer: ['anti_rotation', 'controlled_rotation'],
    riskLevel: 'low',
    fatigueCost: 'low',
  },
  {
    id: 'bodyweight_squat',
    name: 'Sentadilla con peso corporal',
    category: 'lower',
    movement: 'squat',
    intensityType: 'recovery',
    equipment: ['bodyweight'],
    tags: ['beginner_friendly', 'home_gym', 'general_fitness', 'recovery'],
    description: 'Sentadilla sin carga externa. Buena opción para preparación de tejidos, recuperación o nivel inicial.',
    aliases: ['Bodyweight squat'],
    difficulty: 'beginner',
    sportsTransfer: ['general_fitness'],
  },
  {
    id: 'push_up',
    name: 'Flexión de brazos',
    category: 'upper',
    movement: 'push',
    intensityType: 'hypertrophy',
    equipment: ['bodyweight'],
    tags: ['upper_strength', 'beginner_friendly', 'home_gym', 'general_fitness'],
    description: 'Flexión con peso corporal. Empuje horizontal accesible para fuerza y volumen.',
    aliases: ['Push up', 'Push-up'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'glute_bridge',
    name: 'Puente de glúteo',
    category: 'lower',
    movement: 'hinge',
    intensityType: 'recovery',
    equipment: ['bodyweight', 'bands', 'dumbbell'],
    tags: ['beginner_friendly', 'home_gym', 'recovery', 'athletic_transfer'],
    description: 'Puente de glúteo en suelo con peso corporal, banda o mancuerna. Activación y recuperación. Termina con cadera bien extendida sin sobreextender la lumbar.',
    aliases: ['Glute bridge'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'running', 'squash'],
  },
  {
    id: 'band_row',
    name: 'Remo con banda',
    category: 'upper',
    movement: 'pull',
    intensityType: 'recovery',
    equipment: ['bands'],
    tags: ['upper_strength', 'beginner_friendly', 'home_gym', 'recovery'],
    description: 'Remo horizontal con banda elástica. Opción simple de tirón para recuperación o casa.',
    aliases: ['Band row'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
  {
    id: 'split_squat',
    name: 'Zancada estática',
    category: 'lower',
    movement: 'squat',
    intensityType: 'hypertrophy',
    equipment: ['bodyweight', 'dumbbell'],
    unilateral: true,
    tags: ['lower_strength', 'unilateral', 'beginner_friendly', 'home_gym'],
    description: 'Desde una zancada fija, baja y sube sin mover los pies de su posición inicial. Es un patrón unilateral accesible para aprender control y sumar volumen.',
    aliases: ['Split squat', 'Sentadilla en zancada'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'running', 'squash'],
  },
  {
    id: 'inverted_row',
    name: 'Remo invertido',
    category: 'upper',
    movement: 'pull',
    intensityType: 'hypertrophy',
    equipment: ['bodyweight'],
    tags: ['upper_strength', 'beginner_friendly', 'home_gym', 'general_fitness'],
    description: 'Tirón horizontal con peso corporal bajo una barra. Dificultad escalable según ángulo del cuerpo.',
    aliases: ['Inverted row'],
    difficulty: 'beginner',
    sportsTransfer: ['strength', 'general_fitness'],
  },
]

const EXERCISE_LOAD_REFERENCES: Partial<Record<string, StrengthLoadReference>> = {
  back_squat: { lift: 'squat', factor: 1, selectorEligible: true },
  front_squat: { lift: 'squat', factor: 0.85, selectorEligible: true },
  goblet_squat: { lift: 'squat', factor: 0.3, selectorEligible: true },
  bulgarian_split_squat: { lift: 'squat', factor: 0.35, selectorEligible: false },
  walking_lunge: { lift: 'squat', factor: 0.4, selectorEligible: false },
  hip_thrust: { lift: 'squat', factor: 1.2, selectorEligible: false },
  deadlift: { lift: 'deadlift', factor: 1, selectorEligible: true },
  sumo_deadlift: { lift: 'deadlift', factor: 0.95, selectorEligible: true },
  romanian_deadlift: { lift: 'deadlift', factor: 0.8, selectorEligible: true },
  trap_bar_deadlift: { lift: 'deadlift', factor: 0.95, selectorEligible: true },
  bench_press: { lift: 'benchPress', factor: 1, selectorEligible: true },
  incline_bench_press: { lift: 'benchPress', factor: 0.85, selectorEligible: true },
  close_grip_bench_press: { lift: 'benchPress', factor: 0.9, selectorEligible: true },
  incline_dumbbell_press: { lift: 'benchPress', factor: 0.85, selectorEligible: true },
  overhead_press: { lift: 'overheadPress', factor: 1, selectorEligible: true },
  landmine_press: { lift: 'overheadPress', selectorEligible: true },
  push_press: { lift: 'overheadPress', factor: 1.15, selectorEligible: true },
  barbell_jump_squat: { lift: 'squat', factor: 1, selectorEligible: false },
  bb_reverse_lunge: { lift: 'squat', factor: 0.4, selectorEligible: false },
  bb_side_lunge: { lift: 'squat', factor: 0.4, selectorEligible: false },
  single_leg_hip_thrust: { lift: 'squat', factor: 1.2, selectorEligible: false },
  z_press: { lift: 'overheadPress', factor: 0.65, selectorEligible: true },
  half_kneeling_row: { lift: 'benchPress', factor: 0.35, selectorEligible: false },
  jump_squat: { lift: 'squat', factor: 1, selectorEligible: false },
  split_squat: { lift: 'squat', factor: 0.4, selectorEligible: false },
}

const EXERCISE_PRESCRIPTION_UNITS: Partial<Record<string, 'reps' | 'seconds'>> = {
  plank: 'seconds',
  side_plank: 'seconds',
  copenhagen_side_plank: 'seconds',
  side_plank_plate_press: 'seconds',
  stability_ball_front_plank: 'seconds',
}

const EXERCISE_ROTATION_GROUPS: Partial<Record<string, ExerciseRotationGroup>> = {
  back_squat: 'A',
  deadlift: 'A',
  bench_press: 'A',
  overhead_press: 'A',
  pull_up: 'A',
  front_squat: 'B',
  romanian_deadlift: 'B',
  sumo_deadlift: 'B',
  incline_dumbbell_press: 'B',
  incline_bench_press: 'B',
  push_press: 'B',
  bent_over_row: 'B',
  bulgarian_split_squat: 'C',
  hip_thrust: 'C',
  close_grip_bench_press: 'C',
  landmine_press: 'C',
  z_press: 'C',
  chin_up: 'C',
  trx_inverted_row: 'C',
}

function inferAppropriateForPhases(exercise: ExerciseDefinition): ExercisePhase[] {
  if (exercise.intensityType === 'strength') return ['base', 'build', 'peak']
  if (exercise.intensityType === 'power') return ['build', 'peak']
  if (exercise.intensityType === 'hypertrophy') return ['base', 'build']
  if (exercise.intensityType === 'stability') return ['base', 'build', 'peak', 'taper', 'race']
  if (exercise.intensityType === 'recovery') return ['base', 'taper', 'transition', 'race']
  return ['base', 'build']
}

function withExercisePhase2Metadata(exercise: ExerciseDefinition): ExerciseDefinition {
  return {
    ...exercise,
    loadReference: exercise.loadReference ?? EXERCISE_LOAD_REFERENCES[exercise.id],
    prescriptionUnit: exercise.prescriptionUnit ?? EXERCISE_PRESCRIPTION_UNITS[exercise.id],
    appropriateForPhases: exercise.appropriateForPhases ?? inferAppropriateForPhases(exercise),
    blockRotationGroup: exercise.blockRotationGroup ?? EXERCISE_ROTATION_GROUPS[exercise.id],
  }
}

export const STRENGTH_EXERCISE_LIBRARY: ExerciseDefinition[] = RAW_STRENGTH_EXERCISE_LIBRARY.map(withExercisePhase2Metadata)
export const EXERCISE_LIBRARY = STRENGTH_EXERCISE_LIBRARY

/**
 * `id` que existieron y se retiraron del catálogo. Nunca se reutilizan para
 * otro ejercicio: un `libraryRef` guardado apunta a este `id` para siempre.
 * Al retirar un ejercicio, mover su `id` acá en el mismo cambio.
 */
export const RETIRED_STRENGTH_EXERCISE_IDS: readonly string[] = []

export function getExerciseById(id: string): ExerciseDefinition | undefined {
  return STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === id)
}

/**
 * Identidad de un ejercicio de fuerza para productores deterministas
 * (estructura de sesión, fallback del Week Creator): nombre vigente del
 * catálogo + `libraryRef`. El throw es deliberado — todos los call sites usan
 * ids de código, y el gate de permanencia (`strengthCatalogIdPermanence.test.ts`)
 * impide que un id desaparezca en silencio.
 */
export function getStrengthExerciseIdentityById(id: string): {
  name: string
  libraryRef: ExerciseLibraryRef
} {
  const definition = getExerciseById(id)
  if (!definition) throw new Error(`Ejercicio de fuerza inexistente: ${id}`)
  return {
    name: definition.name,
    libraryRef: { source: 'strength_exercise', id: definition.id },
  }
}

export function getStrengthExerciseRole(definition: ExerciseDefinition, index = 0): StrengthExerciseRole {
  if (definition.category === 'core') return 'trunk'
  if (definition.intensityType === 'power') return 'power'
  return index === 0 ? 'main_lift' : 'accessory'
}

export function normalizeStrengthExerciseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveByNameLadder(name: string): StrengthExerciseResolution | undefined {
  const normalized = normalizeStrengthExerciseKey(name)

  const exact = STRENGTH_EXERCISE_LIBRARY.find((exercise) =>
    normalizeStrengthExerciseKey(exercise.name) === normalized ||
    normalizeStrengthExerciseKey(exercise.id) === normalized,
  )
  if (exact) return { definition: exact, matchKind: 'exact', candidates: [exact] }

  const aliasExact = STRENGTH_EXERCISE_LIBRARY.find((exercise) =>
    exercise.aliases?.some((alias) => normalizeStrengthExerciseKey(alias) === normalized),
  )
  if (aliasExact) return { definition: aliasExact, matchKind: 'alias', candidates: [aliasExact] }

  const aliasMap: Record<string, string> = {
    sentadilla: 'back_squat',
    sentadilla_frontal: 'front_squat',
    press_banca: 'bench_press',
    press_de_banca: 'bench_press',
    press_z: 'z_press',
    press_hombro: 'overhead_press',
    press_de_hombros: 'overhead_press',
    press_militar: 'overhead_press',
    remo_con_barra: 'bent_over_row',
    dominadas: 'pull_up',
    dominada_lastrada: 'weighted_pull_up',
    dominada_agarre_mixto: 'mixed_grip_pull_up',
    dominadas_asistidas: 'assisted_pull_up',
    peso_muerto: 'deadlift',
    peso_muerto_trap_bar: 'trap_bar_deadlift',
    peso_muerto_rumano: 'romanian_deadlift',
    rdl: 'romanian_deadlift',
    zancadas: 'walking_lunge',
    zancada_lateral_con_barra: 'bb_side_lunge',
    zancada_atras_con_barra: 'bb_reverse_lunge',
    core_rotacional: 'cable_chop',
    plancha: 'plank',
    plancha_lateral: 'side_plank',
    plancha_copenhagen: 'copenhagen_side_plank',
    puente_gluteo: 'glute_bridge',
    salto_al_cajon: 'box_jump',
    salto_horizontal: 'broad_jump',
    saltos_pogo: 'pogo_jumps',
  }

  const aliasId = aliasMap[normalized]
  if (aliasId) {
    const definition = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === aliasId)
    return definition ? { definition, matchKind: 'alias', candidates: [definition] } : undefined
  }

  const substringCandidates = STRENGTH_EXERCISE_LIBRARY.filter((exercise) =>
    normalized.includes(normalizeStrengthExerciseKey(exercise.name)) ||
    normalizeStrengthExerciseKey(exercise.name).includes(normalized) ||
    exercise.aliases?.some((alias) =>
      normalized.includes(normalizeStrengthExerciseKey(alias)) ||
      normalizeStrengthExerciseKey(alias).includes(normalized),
    ),
  )

  // Varios ejercicios igual de plausibles significa que el fragmento no
  // discrimina. Se prefiere no resolver: adivinar mal prescribe carga sobre el
  // ejercicio equivocado, y además el resultado dependía del orden de
  // declaración del catálogo.
  //
  // Los candidatos viajan igual, ordenados por `id` para no reintroducir esa
  // dependencia de orden. Quien clasifica puede usarlos; quien prescribe carga
  // solo mira `definition`, que acá queda ausente a propósito.
  const candidates = [...substringCandidates].sort((left, right) => left.id.localeCompare(right.id))
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return { definition: candidates[0]!, matchKind: 'substring', candidates }
  return { matchKind: 'ambiguous', candidates }
}

function resolveFromLibraryRef(ref: ExerciseLibraryRef | undefined): ExerciseDefinition | undefined {
  if (!ref || ref.source !== 'strength_exercise') return undefined
  return STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === ref.id)
}

export function resolveStrengthExercise(
  exercise: { name: string; libraryRef?: ExerciseLibraryRef },
): StrengthExerciseResolution | undefined {
  const fromRef = resolveFromLibraryRef(exercise.libraryRef)
  if (fromRef) return { definition: fromRef, matchKind: 'ref', candidates: [fromRef] }
  return resolveByNameLadder(exercise.name)
}

export function resolveStrengthExerciseName(name: string): StrengthExerciseResolution | undefined {
  return resolveStrengthExercise({ name })
}

export function findStrengthExerciseByName(name: string): ExerciseDefinition | undefined {
  return resolveStrengthExerciseName(name)?.definition
}

export function getExerciseGroupForDefinition(exercise: ExerciseDefinition): ExerciseGroup {
  if (
    exercise.equipment.includes('ladder') ||
    exercise.equipment.includes('assault_bike') ||
    exercise.equipment.includes('air_treadmill') ||
    exercise.tags.includes('court_footwork') ||
    exercise.tags.includes('court_conditioning') ||
    exercise.tags.includes('cardio_specific')
  ) return 'cardio'
  if (exercise.tags.includes('olympic_power')) return 'olympic'
  if (exercise.category === 'core') return 'core'
  if (exercise.movement === 'push') return 'push'
  if (exercise.movement === 'pull') return 'pull'
  return 'legs'
}
