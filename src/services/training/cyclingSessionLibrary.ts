export type CyclingSessionCategory =
  | 'recovery'
  | 'easy'
  | 'endurance'
  | 'sweetspot'
  | 'tempo'
  | 'threshold'
  | 'intervals_vo2'
  | 'sprint'
  | 'activation'

export type CyclingSessionFamily =
  | 'z2_aerobic'
  | 'long_ride'
  | 'sweetspot_tempo'
  | 'intervals_vo2'
  | 'sprint_anaerobic'
  | 'recovery'
  | 'activation'

export type CyclingIntensity = 'low' | 'moderate' | 'moderate-high' | 'high'

export type CyclingRole = 'primary' | 'support'

export interface CyclingSessionDefinition {
  id: string
  name: string
  category: CyclingSessionCategory
  family: CyclingSessionFamily
  focus: string[]
  intensity: CyclingIntensity
  tags: string[]
  description: string
  progressionLevel?: 1 | 2 | 3
  suitableRoles: CyclingRole[]
  typicalStructure: string
}

export const CYCLING_SESSION_LIBRARY: CyclingSessionDefinition[] = [
  {
    id: 'recovery_spin',
    name: 'Recovery spin',
    category: 'recovery',
    family: 'recovery',
    focus: ['recovery', 'circulation', 'active_rest'],
    intensity: 'low',
    tags: ['recovery', 'low_load', 'z1', 'beginner_friendly', 'post_race', 'taper'],
    description: 'Pedaleo muy suave para facilitar recuperacion activa. Sin presion de potencia ni ritmo. Cadencia ligera.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '20-35 min a cadencia suave y sin esfuerzo. FC <65% FC max. Ideal al dia siguiente de carga alta.',
  },
  {
    id: 'post_competition_recovery',
    name: 'Recuperacion post-competencia',
    category: 'recovery',
    family: 'recovery',
    focus: ['recovery', 'post_race', 'circulation', 'mobility_support'],
    intensity: 'low',
    tags: ['recovery', 'post_competition', 'post_race', 'support', 'primary'],
    description: 'Rodaje regenerativo posterior a competencia o bloque duro para bajar tono y recuperar sensacion de pedaleo.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '25-40 min muy suaves, Z1-Z2 baja, cadencia comoda. Terminar soltando hombros y cadera fuera de la bici.',
  },
  {
    id: 'easy_z2_short',
    name: 'Easy Z2 corto',
    category: 'easy',
    family: 'z2_aerobic',
    focus: ['z2', 'aerobic_base', 'cadence'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'support', 'base', 'recovery_active', 'beginner_friendly'],
    description: 'Rodaje Z2 aerobico corto. Cadencia 80-90 rpm. Ritmo conversacional sin presion de potencia.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '30-50 min en Z2 constante, cadencia 80-90rpm. Respiracion nasal o conversacion comoda como referencia.',
  },
  {
    id: 'easy_z2_base',
    name: 'Easy Z2 base',
    category: 'easy',
    family: 'z2_aerobic',
    focus: ['z2', 'aerobic_base', 'cadence', 'steady'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'base', 'steady', 'beginner_friendly'],
    description: 'Rodaje Z2 aerobico estandar. Construye motor aerobico con bajo impacto articular.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '50-70 min en Z2 constante. Cadencia objetivo 85-90rpm. Sin aceleraciones ni cambios de ritmo.',
  },
  {
    id: 'support_aerobic_flush',
    name: 'Support aerobic flush',
    category: 'easy',
    family: 'z2_aerobic',
    focus: ['z2', 'support', 'flush', 'aerobic_reset'],
    intensity: 'low',
    tags: ['support', 'hybrid', 'flush', 'post_strength', 'post_squash'],
    description: 'Salida aerobica de soporte para sumar base sin competir con el deporte principal. Busca soltar piernas, no generar carga dura.',
    progressionLevel: 1,
    suitableRoles: ['support'],
    typicalStructure: '35-50 min en Z1-Z2 muy controlado, cadencia 85-95rpm. Sin bloques de calidad ni cierres agresivos.',
  },
  {
    id: 'z2_cadence_work',
    name: 'Z2 + trabajo de cadencia',
    category: 'easy',
    family: 'z2_aerobic',
    focus: ['z2', 'cadence', 'technique', 'economy'],
    intensity: 'low',
    tags: ['z2', 'cadence', 'technique', 'base', 'economy'],
    description: 'Z2 con bloques de cadencia alta para mejorar eficiencia de pedaleo sin generar fatiga de piernas.',
    progressionLevel: 2,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '45-60 min base Z2 intercalando 5 x 3 min a cadencia >100rpm con 5 min Z2 normal entre bloques.',
  },
  {
    id: 'long_ride_z2',
    name: 'Long ride Z2',
    category: 'endurance',
    family: 'long_ride',
    focus: ['endurance', 'z2', 'aerobic_endurance', 'fat_oxidation'],
    intensity: 'moderate',
    tags: ['long_ride', 'aerobic_base', 'base', 'fondo', 'endurance'],
    description: 'Rodaje largo aerobico. Desarrolla resistencia metabolica, tolerancia y eficiencia a baja intensidad.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '90-150 min en Z2 sostenido. Nutricion en ruta si supera 90 min. Cadencia constante, sin picar ritmo.',
  },
  {
    id: 'long_ride_progressive',
    name: 'Long ride progresivo',
    category: 'endurance',
    family: 'long_ride',
    focus: ['endurance', 'progression', 'tempo_finish', 'aerobic_strength'],
    intensity: 'moderate',
    tags: ['long_ride', 'progression', 'build', 'fondo', 'aerobic_strength'],
    description: 'Rodaje largo con progresion final. Los ultimos 20-30 min suben a Z3 o sweetspot para entrenar en fatiga.',
    progressionLevel: 3,
    suitableRoles: ['primary'],
    typicalStructure: '80-120 min total. Primeros 60-80 min en Z2 comodo. Ultimos 20-30 min subiendo gradualmente a Z3-sweetspot.',
  },
  {
    id: 'sweetspot_2x15',
    name: 'Sweetspot 2x15 min',
    category: 'sweetspot',
    family: 'sweetspot_tempo',
    focus: ['sweetspot', 'threshold', 'sustained_power', 'lactate'],
    intensity: 'moderate-high',
    tags: ['sweetspot', 'threshold', 'build', 'tempo', 'base_advanced'],
    description: 'Dos bloques de sweetspot de 15 min. Trabajo de umbral alto sin el costo de los intervalos VO2.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '10 min Z2 + 2 x 15 min a 88-93% FTP (RPE 6-7) con 10 min Z2 entre bloques + 10 min Z2.',
  },
  {
    id: 'sweetspot_3x12',
    name: 'Sweetspot 3x12 min',
    category: 'sweetspot',
    family: 'sweetspot_tempo',
    focus: ['sweetspot', 'threshold', 'volume', 'sustained_power'],
    intensity: 'moderate-high',
    tags: ['sweetspot', 'threshold', 'build', 'tempo', 'vo2_support'],
    description: 'Tres bloques de sweetspot de 12 min. Mayor volumen de trabajo de umbral en bloque de construccion.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 3 x 12 min a 88-93% FTP con 8 min Z2 entre bloques + 10 min Z2.',
  },
  {
    id: 'tempo_sustained',
    name: 'Tempo continuo',
    category: 'tempo',
    family: 'sweetspot_tempo',
    focus: ['tempo', 'lactate', 'threshold', 'sustained_effort'],
    intensity: 'moderate-high',
    tags: ['tempo', 'threshold', 'build', 'sustained'],
    description: 'Bloque continuo a ritmo de tempo. Menos demandante que el sweetspot pero de mayor duracion.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 30-40 min a tempo continuo (76-84% FTP, RPE 6) + 10 min Z2.',
  },
  {
    id: 'controlled_tempo_support',
    name: 'Tempo controlado de soporte',
    category: 'tempo',
    family: 'sweetspot_tempo',
    focus: ['tempo', 'support', 'controlled_threshold', 'fatigue_managed'],
    intensity: 'moderate',
    tags: ['support', 'tempo', 'hybrid', 'fatigue_managed', 'build'],
    description: 'Trabajo controlado de tempo o sweetspot bajo para mantener estimulo sin dejar fatiga residual alta.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '12 min Z2 + 2 x 10 min a tempo alto o sweetspot bajo (RPE 6) con 6 min suaves entre bloques + 10 min Z2.',
  },
  {
    id: 'build_over_under',
    name: 'Build over-under',
    category: 'threshold',
    family: 'sweetspot_tempo',
    focus: ['threshold', 'build', 'power_control', 'race_specific'],
    intensity: 'moderate-high',
    tags: ['build', 'primary', 'threshold', 'over_under'],
    description: 'Sesion de construccion principal con cambios cortos sobre y bajo umbral para tolerancia al ritmo de competencia.',
    progressionLevel: 3,
    suitableRoles: ['primary'],
    typicalStructure: '15 min Z2 + 3 x 12 min alternando 2 min sweetspot / 1 min sobre umbral con 6 min suaves entre bloques + 10 min soltar.',
  },
  {
    id: 'vo2max_5x5',
    name: 'VO2max 5x5 min',
    category: 'intervals_vo2',
    family: 'intervals_vo2',
    focus: ['vo2max', 'high_intensity', 'aerobic_power'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'build', 'peak', 'high_intensity'],
    description: 'Series de 5 min sobre FTP para desarrollar potencia aerobica maxima. Exigente, requiere buena base.',
    progressionLevel: 3,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 5 x 5 min a >105% FTP (RPE 8-9) con 5 min Z2 de recuperacion activa + 10 min Z2.',
  },
  {
    id: 'vo2max_8x3',
    name: 'VO2max 8x3 min',
    category: 'intervals_vo2',
    family: 'intervals_vo2',
    focus: ['vo2max', 'high_intensity', 'repeatability'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'build', 'peak', 'high_intensity'],
    description: 'Series cortas de 3 min sobre FTP. Mas repeticiones, menor acumulacion de fatiga por bloque.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 8 x 3 min a >110% FTP con 3 min Z2 entre series + 10 min Z2.',
  },
  {
    id: 'pre_event_activation',
    name: 'Activacion pre-evento',
    category: 'activation',
    family: 'activation',
    focus: ['activation', 'race_prep', 'neuromuscular', 'feeling'],
    intensity: 'low',
    tags: ['activation', 'taper', 'race', 'pre_race', 'strides', 'beginner_friendly'],
    description: 'Activacion corta antes de evento o dia clave. Z2 suave con 2-3 esfuerzos cortos para despertar piernas.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '20-30 min Z2 suave + 3 x 30s a ritmo de carrera con recuperacion completa. Sin acumular fatiga.',
  },
  {
    id: 'race_week_openers',
    name: 'Openers semana de carrera',
    category: 'activation',
    family: 'activation',
    focus: ['activation', 'race_week', 'neuromuscular', 'sharpness'],
    intensity: 'low',
    tags: ['race', 'taper', 'activation', 'primary', 'support'],
    description: 'Activacion corta con openers controlados para llegar con piernas despiertas sin dejar fatiga residual.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '15-20 min Z2 + 4 x 45s agiles a ritmo de carrera con recuperacion completa + 8-10 min suaves.',
  },
]

export function getCyclingSessionFamily(session: CyclingSessionDefinition): CyclingSessionFamily {
  return session.family
}

export function normalizeCyclingSessionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function findCyclingSessionById(id: string): CyclingSessionDefinition | undefined {
  return CYCLING_SESSION_LIBRARY.find((s) => s.id === id)
}
