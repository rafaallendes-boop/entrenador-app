import { RUNNING_PRESCRIPTIONS } from './runningPrescriptions'
import type { RunningTemplatePrescription } from '../../types/runningTemplate'
import type { RunningType } from '../../types'

export type RunningSessionCategory =
  | 'easy'
  | 'long_run'
  | 'tempo'
  | 'threshold'
  | 'intervals'
  | 'speed'
  | 'recovery'
  | 'race_specific'
  | 'hill'

export type RunningIntensity = 'low' | 'moderate' | 'moderate-high' | 'high'

export type RunningPrimaryGoal =
  | 'base'
  | '5k'
  | '10k'
  | 'half_marathon'
  | 'marathon'
  | 'general_fitness'
  | 'return_to_run'

export type RunningSessionFamily =
  | 'easy_aerobic'
  | 'long_run'
  | 'tempo_threshold'
  | 'intervals_vo2'
  | 'speed_economy'
  | 'hill'
  | 'race_specific'
  | 'recovery'

export interface RunningSessionDefinition {
  version: number
  prescription: RunningTemplatePrescription
  id: string
  name: string
  category: RunningSessionCategory
  family: RunningSessionFamily
  focus: string[]
  intensity: RunningIntensity
  tags: string[]
  description: string
  progressionLevel?: 1 | 2 | 3
  suitableGoals?: RunningPrimaryGoal[]
  typicalStructure: string
  runningType: RunningType
}

const RUNNING_DEFINITIONS: Omit<RunningSessionDefinition, 'version' | 'prescription'>[] = [
  // ─── easy_aerobic ────────────────────────────────────────────────────────────
  {
    id: 'easy_z2_base',
    name: 'Easy Z2 base',
    category: 'easy',
    family: 'easy_aerobic',
    focus: ['z2', 'aerobic_base', 'steady'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'base', 'recovery_active', 'beginner_friendly'],
    description: 'Carrera suave en zona 2. Ritmo conversacional, frecuencia cardíaca baja y controlada.',
    progressionLevel: 1,
    suitableGoals: ['base', 'general_fitness', 'marathon', 'return_to_run'],
    typicalStructure: '30-50 min a ritmo Z2 constante. Nariz cerrada o conversación cómoda como referencia de intensidad.',
    runningType: 'z2',
  },
  {
    id: 'easy_z2_strides',
    name: 'Easy Z2 + strides',
    category: 'easy',
    family: 'easy_aerobic',
    focus: ['z2', 'neuromuscular', 'economy'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'strides', 'economy', 'base', 'build'],
    description: 'Carrera fácil Z2 con 4-6 aceleraciones cortas al final para activación neuromuscular.',
    progressionLevel: 2,
    suitableGoals: ['base', '5k', '10k', 'general_fitness'],
    typicalStructure: '25-40 min Z2 fácil + 4-6 strides de 20-25s a ritmo de 1K con recuperación completa.',
    runningType: 'z2',
  },
  {
    id: 'aerobic_steady',
    name: 'Aerobic steady run',
    category: 'easy',
    family: 'easy_aerobic',
    focus: ['aerobic', 'steady', 'z2_high'],
    intensity: 'moderate',
    tags: ['aerobic_base', 'steady', 'build', 'base'],
    description: 'Carrera aeróbica sostenida en la parte alta de Z2 o borde inferior de Z3. Cómoda pero constante.',
    progressionLevel: 2,
    suitableGoals: ['base', '10k', 'half_marathon', 'marathon'],
    typicalStructure: '35-50 min a ritmo aeróbico sostenido. Esfuerzo perceptible pero sin superar umbral de confort.',
    runningType: 'z2',
  },
  {
    id: 'easy_longer',
    name: 'Easy aerobic longer block',
    category: 'easy',
    family: 'easy_aerobic',
    focus: ['z2', 'duration', 'aerobic_endurance'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'duration', 'base', 'marathon'],
    description: 'Bloque aeróbico fácil de mayor duración. Buen estímulo de fondo sin acumular fatiga de calidad.',
    progressionLevel: 2,
    suitableGoals: ['base', 'marathon', 'half_marathon'],
    typicalStructure: '55-70 min a ritmo Z2 fácil constante. Sin acelerar al final.',
    runningType: 'z2',
  },

  // ─── long_run ─────────────────────────────────────────────────────────────────
  {
    id: 'long_easy',
    name: 'Long run fácil',
    category: 'long_run',
    family: 'long_run',
    focus: ['endurance', 'z2', 'aerobic_endurance'],
    intensity: 'low',
    tags: ['long_run', 'aerobic_base', 'base', 'marathon', 'half_marathon', 'fondo'],
    description: 'Long run clásico a ritmo Z2 suave. Foco en tiempo en piernas y adaptación aeróbica.',
    progressionLevel: 1,
    suitableGoals: ['base', 'marathon', 'half_marathon', 'general_fitness'],
    typicalStructure: '60-90 min a ritmo Z2 fácil constante. Hidratación en ruta si supera 60 min.',
    runningType: 'long',
  },
  {
    id: 'progressive_long',
    name: 'Progressive long run',
    category: 'long_run',
    family: 'long_run',
    focus: ['endurance', 'progression', 'aerobic_strength'],
    intensity: 'moderate',
    tags: ['long_run', 'progression', 'build', 'marathon', 'half_marathon', 'fondo'],
    description: 'Long run con progresión de ritmo: comienza fácil y termina en Z3 o ritmo de maratón.',
    progressionLevel: 2,
    suitableGoals: ['marathon', 'half_marathon', '10k'],
    typicalStructure: 'Primeros 50% del tiempo a ritmo fácil Z2. Últimos 30-40% con progresión gradual hasta maratón-pace o ritmo Z3.',
    runningType: 'long',
  },
  {
    id: 'long_fast_finish',
    name: 'Long run con cierre rápido',
    category: 'long_run',
    family: 'long_run',
    focus: ['endurance', 'fast_finish', 'race_prep'],
    intensity: 'moderate-high',
    tags: ['long_run', 'fast_finish', 'build', 'peak', 'marathon', 'half_marathon'],
    description: 'Long run con últimos 15-20 min a ritmo de media maratón o umbral para entrenar en fatiga.',
    progressionLevel: 3,
    suitableGoals: ['marathon', 'half_marathon'],
    typicalStructure: '60-80 min total. Primeros 50-60 min fácil Z2 + últimos 15-20 min a ritmo de carrera (HM-pace o MP).',
    runningType: 'long',
  },

  // ─── tempo_threshold ─────────────────────────────────────────────────────────
  {
    id: 'tempo_continuo',
    name: 'Tempo continuo',
    category: 'tempo',
    family: 'tempo_threshold',
    focus: ['threshold', 'lactate', 'sustained_effort'],
    intensity: 'moderate-high',
    tags: ['threshold', 'tempo', 'build', 'peak', 'half_marathon', '10k'],
    description: 'Tempo continuo a ritmo de umbral. Esfuerzo sostenido y controlado durante 20-35 min sin pausa.',
    progressionLevel: 2,
    suitableGoals: ['10k', 'half_marathon', 'marathon'],
    typicalStructure: '10 min calentamiento fácil + 20-35 min a ritmo umbral sostenido + 10 min enfriamiento Z2.',
    runningType: 'tempo',
  },
  {
    id: 'cruise_intervals',
    name: 'Cruise intervals',
    category: 'threshold',
    family: 'tempo_threshold',
    focus: ['threshold', 'lactate_clearance', 'quality'],
    intensity: 'moderate-high',
    tags: ['threshold', 'tempo', 'build', 'peak', '10k', 'half_marathon'],
    description: 'Bloques de umbral con recuperación corta. Permite mayor volumen de calidad que el tempo continuo.',
    progressionLevel: 2,
    suitableGoals: ['10k', 'half_marathon', 'marathon'],
    typicalStructure: '10 min Z2 + 4 × 6-8 min a ritmo umbral con 2 min trote suave entre bloques + 10 min Z2.',
    runningType: 'tempo',
  },
  {
    id: 'threshold_blocks',
    name: 'Threshold blocks',
    category: 'threshold',
    family: 'tempo_threshold',
    focus: ['threshold', 'quality', 'lactate'],
    intensity: 'moderate-high',
    tags: ['threshold', 'tempo', 'build', '10k', 'half_marathon', 'beginner_friendly'],
    description: 'Bloques cortos de umbral ideal para introducir calidad o en semanas con más fatiga.',
    progressionLevel: 1,
    suitableGoals: ['10k', 'half_marathon', 'general_fitness'],
    typicalStructure: '10 min Z2 + 5-6 × 4 min a ritmo umbral con 2-3 min recuperación activa + 10 min Z2.',
    runningType: 'tempo',
  },
  {
    id: 'lactate_clearance',
    name: 'Lactate clearance run',
    category: 'tempo',
    family: 'tempo_threshold',
    focus: ['lactate', 'steady', 'comfortably_hard'],
    intensity: 'moderate',
    tags: ['threshold', 'build', 'aerobic_strength', 'half_marathon', 'marathon'],
    description: 'Carrera a esfuerzo sostenido, comfortably hard: entre Z3 y Z4. Desarrolla capacidad de clearance de lactato.',
    progressionLevel: 2,
    suitableGoals: ['marathon', 'half_marathon', '10k'],
    typicalStructure: '10 min Z2 + 25-35 min a esfuerzo comfortably hard (RPE 6.5-7.5) + 10 min Z2.',
    runningType: 'tempo',
  },

  // ─── intervals_vo2 ───────────────────────────────────────────────────────────
  {
    id: 'repeats_400',
    name: 'Repeticiones 400m',
    category: 'intervals',
    family: 'intervals_vo2',
    focus: ['vo2max', 'speed', 'quality'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'speed', 'build', 'peak', '5k', '10k'],
    description: 'Series cortas de 400m a ritmo 5K para desarrollar VO2max y velocidad básica.',
    progressionLevel: 2,
    suitableGoals: ['5k', '10k'],
    typicalStructure: '10 min Z2 + 8-12 × 400m a ritmo 5K con 90s-2min recuperación trotando + 10 min Z2.',
    runningType: 'intervals',
  },
  {
    id: 'repeats_800',
    name: 'Repeticiones 800m',
    category: 'intervals',
    family: 'intervals_vo2',
    focus: ['vo2max', 'quality', 'race_prep'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'build', 'peak', '5k', '10k'],
    description: 'Series de 800m en el rango 5K-10K. Balance entre intensidad y duración del estímulo.',
    progressionLevel: 2,
    suitableGoals: ['5k', '10k'],
    typicalStructure: '10 min Z2 + 4-6 × 800m a ritmo 5K-10K con 2-3 min recuperación trotando + 10 min Z2.',
    runningType: 'intervals',
  },
  {
    id: 'repeats_1k',
    name: 'Repeticiones 1K',
    category: 'intervals',
    family: 'intervals_vo2',
    focus: ['vo2max', 'race_specificity', 'quality'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'build', 'peak', '10k', 'half_marathon'],
    description: 'Series de 1K a ritmo 10K. Estímulo de VO2max de mayor duración con alta especificidad.',
    progressionLevel: 3,
    suitableGoals: ['10k', 'half_marathon'],
    typicalStructure: '10 min Z2 + 4-5 × 1K a ritmo 10K con 2-3 min recuperación trotando + 10 min Z2.',
    runningType: 'intervals',
  },
  {
    id: 'fartlek_controlado',
    name: 'Fartlek controlado',
    category: 'intervals',
    family: 'intervals_vo2',
    focus: ['vo2max', 'varied_intensity', 'fun'],
    intensity: 'moderate-high',
    tags: ['vo2', 'intervals', 'fartlek', 'build', 'base', 'beginner_friendly'],
    description: 'Fartlek con cambios de ritmo estructurados. Menos rígido que series pero con intención de calidad.',
    progressionLevel: 1,
    suitableGoals: ['5k', '10k', 'general_fitness'],
    typicalStructure: '10 min Z2 + 20-25 min alternando 2 min rápido (ritmo 5-10K) y 2 min suave (Z2) + 10 min Z2.',
    runningType: 'intervals',
  },

  // ─── speed_economy ───────────────────────────────────────────────────────────
  {
    id: 'strides_session',
    name: 'Strides session',
    category: 'speed',
    family: 'speed_economy',
    focus: ['economy', 'neuromuscular', 'form'],
    intensity: 'low',
    tags: ['strides', 'economy', 'neuromuscular', 'base', 'build', 'taper', 'beginner_friendly'],
    description: 'Carrera fácil con strides: aceleraciones controladas de 20-25s para activar el sistema neuromuscular sin fatiga.',
    progressionLevel: 1,
    suitableGoals: ['base', '5k', '10k', 'half_marathon', 'general_fitness'],
    typicalStructure: '20-30 min Z2 fácil + 5-8 strides de 20-25s a ritmo fluido (RPE 8 percibido sin forzar) con recuperación completa.',
    runningType: 'z2',
  },
  {
    id: 'short_hill_sprints',
    name: 'Short hill sprints',
    category: 'speed',
    family: 'speed_economy',
    focus: ['power', 'economy', 'neuromuscular', 'hill'],
    intensity: 'high',
    tags: ['hill', 'power', 'economy', 'neuromuscular', 'build', 'peak'],
    description: 'Sprints cortos en cuesta (8-10s) para mejorar potencia, economía y activación sin fatiga metabólica.',
    progressionLevel: 2,
    suitableGoals: ['5k', '10k', 'general_fitness'],
    typicalStructure: '15 min Z2 fácil + 6-10 × 8-10s sprint en cuesta empinada con recuperación completa caminando + 10 min Z2.',
    runningType: 'intervals',
  },
  {
    id: 'speed_support',
    name: 'Speed support session',
    category: 'speed',
    family: 'speed_economy',
    focus: ['economy', 'form', 'light_quality'],
    intensity: 'low',
    tags: ['economy', 'form', 'base', 'taper', 'beginner_friendly', 'aerobic_base'],
    description: 'Sesión de apoyo para economía de carrera: carrera fácil + drills + strides. Carga mínima, calidad técnica.',
    progressionLevel: 1,
    suitableGoals: ['base', 'general_fitness', 'return_to_run'],
    typicalStructure: '20 min Z2 + drills de técnica (A, B, skipping) + 4 strides de 20s + 10 min Z2.',
    runningType: 'z2',
  },

  // ─── hill ─────────────────────────────────────────────────────────────────────
  {
    id: 'hill_repeats',
    name: 'Hill repeats',
    category: 'hill',
    family: 'hill',
    focus: ['strength', 'aerobic_power', 'hill'],
    intensity: 'high',
    tags: ['hill', 'strength', 'vo2', 'build', 'peak', '10k', 'half_marathon'],
    description: 'Repeticiones de cuesta de 1-2 min al esfuerzo para desarrollar fuerza específica y potencia aeróbica.',
    progressionLevel: 2,
    suitableGoals: ['10k', 'half_marathon', 'marathon'],
    typicalStructure: '10 min Z2 + 6-10 × 60-90s en cuesta moderada a máximo esfuerzo con trote de bajada como recuperación + 10 min Z2.',
    runningType: 'intervals',
  },
  {
    id: 'uphill_tempo',
    name: 'Uphill tempo blocks',
    category: 'hill',
    family: 'hill',
    focus: ['strength', 'threshold', 'hill', 'aerobic_strength'],
    intensity: 'moderate-high',
    tags: ['hill', 'threshold', 'build', 'strength', 'half_marathon'],
    description: 'Bloques de tempo en subida: menor impacto que el tempo en llano con mayor demanda muscular.',
    progressionLevel: 2,
    suitableGoals: ['10k', 'half_marathon', 'marathon'],
    typicalStructure: '10 min Z2 + 3-4 × 4-5 min a ritmo umbral en cuesta suave-moderada con 3 min recuperación + 10 min Z2.',
    runningType: 'tempo',
  },

  // ─── race_specific ────────────────────────────────────────────────────────────
  {
    id: 'hm_pace_blocks',
    name: 'Half marathon pace blocks',
    category: 'race_specific',
    family: 'race_specific',
    focus: ['race_pace', 'hm', 'specificity'],
    intensity: 'moderate-high',
    tags: ['race_pace', 'hm', 'half_marathon', 'peak', 'build'],
    description: 'Bloques al ritmo objetivo de media maratón para mecanizar el esfuerzo y consolidar la especificidad.',
    progressionLevel: 3,
    suitableGoals: ['half_marathon'],
    typicalStructure: '10 min Z2 + 3 × 10-12 min a ritmo HM con 3-4 min recuperación activa + 10 min Z2.',
    runningType: 'tempo',
  },
  {
    id: 'pace_10k_reps',
    name: '10K pace reps',
    category: 'race_specific',
    family: 'race_specific',
    focus: ['race_pace', '10k', 'quality'],
    intensity: 'high',
    tags: ['race_pace', '10k', 'peak', 'build', 'vo2'],
    description: 'Repeticiones al ritmo objetivo de 10K para afianzar especificidad y confianza en el ritmo de carrera.',
    progressionLevel: 3,
    suitableGoals: ['10k'],
    typicalStructure: '10 min Z2 + 4-5 × 1 milla o 6-8 × 800m a ritmo 10K con 2-3 min recuperación + 10 min Z2.',
    runningType: 'intervals',
  },
  {
    id: 'marathon_pace_steady',
    name: 'Marathon pace steady block',
    category: 'race_specific',
    family: 'race_specific',
    focus: ['race_pace', 'marathon', 'economy'],
    intensity: 'moderate',
    tags: ['race_pace', 'marathon', 'build', 'peak'],
    description: 'Bloque continuo a ritmo objetivo de maratón para acostumbrar el cuerpo al esfuerzo específico.',
    progressionLevel: 2,
    suitableGoals: ['marathon'],
    typicalStructure: '10 min Z2 + 20-30 min a ritmo de maratón + 10 min Z2. Sin acelerar ni frenar.',
    runningType: 'tempo',
  },
  {
    id: 'race_activation',
    name: 'Race day activation',
    category: 'race_specific',
    family: 'race_specific',
    focus: ['activation', 'race_prep', 'feeling'],
    intensity: 'low',
    tags: ['race_pace', 'activation', 'taper', 'strides', 'beginner_friendly'],
    description: 'Activación previa a carrera: carrera muy suave + strides + sensaciones. Sin fatiga residual.',
    progressionLevel: 1,
    suitableGoals: ['5k', '10k', 'half_marathon', 'marathon'],
    typicalStructure: '15-20 min muy suave Z2 + 4-6 strides de 20s a ritmo de carrera + drills opcionales. Total 20-30 min.',
    runningType: 'z2',
  },

  // ─── recovery ─────────────────────────────────────────────────────────────────
  {
    id: 'recovery_jog',
    name: 'Recovery jog',
    category: 'recovery',
    family: 'recovery',
    focus: ['recovery', 'circulation', 'low_load'],
    intensity: 'low',
    tags: ['recovery', 'low_impact', 'z2', 'beginner_friendly', 'aerobic_base'],
    description: 'Trote muy suave de recuperación activa. RPE 3-4. Objetivo: circulación y regeneración, no entrenamiento.',
    progressionLevel: 1,
    suitableGoals: ['base', 'general_fitness', 'return_to_run'],
    typicalStructure: '20-35 min muy suave. Ritmo de conversación fácil. Si hay dolor, caminar.',
    runningType: 'z2',
  },
  {
    id: 'run_walk_return',
    name: 'Run-walk return',
    category: 'recovery',
    family: 'recovery',
    focus: ['return_to_run', 'low_load', 'gradual'],
    intensity: 'low',
    tags: ['return_to_run', 'low_impact', 'beginner_friendly', 'recovery'],
    description: 'Protocolo run-walk para volver al running tras un parón. Alterna trote suave con caminata.',
    progressionLevel: 1,
    suitableGoals: ['return_to_run', 'base'],
    typicalStructure: '20-30 min total alternando 2-3 min trote suave con 1-2 min caminata. Sin acelerar en ningún bloque.',
    runningType: 'z2',
  },
  {
    id: 'low_impact_return',
    name: 'Low impact return session',
    category: 'recovery',
    family: 'recovery',
    focus: ['return_to_run', 'low_impact', 'gradual'],
    intensity: 'low',
    tags: ['return_to_run', 'low_impact', 'beginner_friendly', 'recovery', 'base'],
    description: 'Sesión de muy bajo impacto para volver al running o para días con carga máxima de otro deporte.',
    progressionLevel: 1,
    suitableGoals: ['return_to_run', 'base', 'general_fitness'],
    typicalStructure: '15-25 min muy suave. Puede incluir caminata si se necesita. Solo seguir moviéndose sin presión.',
    runningType: 'z2',
  },
  { id: 'easy_fractionated_support', name: 'Z2 fraccionado de apoyo', category: 'easy', family: 'easy_aerobic',
    focus: ['aerobic_base'], intensity: 'low', tags: ['aerobic_base', 'support'], progressionLevel: 1,
    description: 'Bloques fáciles de cinco minutos separados por un minuto suave; sostener conversación.', typicalStructure: '5 min fácil / 1 min suave', runningType: 'z2' },
  { id: 'short_support_tempo', name: 'Umbral breve fraccionado de apoyo', category: 'threshold', family: 'tempo_threshold', focus: ['threshold'], intensity: 'moderate', tags: ['support'], progressionLevel: 1, description: 'Pocos bloques de dos minutos a umbral controlado con pausa fácil de dos minutos; calidad acotada al presupuesto.', typicalStructure: '2 min umbral / 2 min suave', runningType: 'tempo' },
  { id: 'short_support_fartlek', name: 'Fartlek corto de apoyo', category: 'speed', family: 'speed_economy',
    focus: ['economy'], intensity: 'moderate', tags: ['support', 'economy'], progressionLevel: 1,
    description: 'Cambios controlados de un minuto con dos minutos suaves; sin esfuerzo máximo.', typicalStructure: '1 min sostenido / 2 min suave', runningType: 'intervals' },
  { id: 'squash_activation_run', name: 'Activación breve para squash', category: 'speed', family: 'speed_economy',
    focus: ['economy'], intensity: 'low', tags: ['support', 'pre_match'], progressionLevel: 1,
    description: 'Aceleraciones fluidas de quince segundos con recuperación completa; detenerse antes de perder frescura.', typicalStructure: '15 s fluido / 60 s suave', runningType: 'z2' },
]

export const RUNNING_SESSION_LIBRARY: RunningSessionDefinition[] = RUNNING_DEFINITIONS.map(definition => {
  const prescription = RUNNING_PRESCRIPTIONS[definition.id]
  if (!prescription) throw new Error(`Falta prescripción de ${definition.id}`)
  return { ...definition, version: 1, prescription }
})

export function getRunningSessionFamily(session: RunningSessionDefinition): RunningSessionFamily {
  return session.family
}

export function normalizeRunningSessionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function findRunningSessionById(id: string): RunningSessionDefinition | undefined {
  return RUNNING_SESSION_LIBRARY.find(s => s.id === id)
}
