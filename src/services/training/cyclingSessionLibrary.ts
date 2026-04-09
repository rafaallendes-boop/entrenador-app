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
  // ─── recovery ────────────────────────────────────────────────────────────────
  {
    id: 'recovery_spin',
    name: 'Recovery spin',
    category: 'recovery',
    family: 'recovery',
    focus: ['recovery', 'circulation', 'active_rest'],
    intensity: 'low',
    tags: ['recovery', 'low_load', 'z1', 'beginner_friendly', 'post_race', 'taper'],
    description: 'Pedaleo muy suave para facilitar recuperación activa. Sin presión de potencia ni ritmo. Cadencia ligera.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '20-35 min a cadencia suave y sin esfuerzo. FC <65% FC máx. Opción ideal para día después de carga alta.',
  },

  // ─── z2_aerobic ──────────────────────────────────────────────────────────────
  {
    id: 'easy_z2_short',
    name: 'Easy Z2 corto',
    category: 'easy',
    family: 'z2_aerobic',
    focus: ['z2', 'aerobic_base', 'cadence'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'support', 'base', 'recovery_active', 'beginner_friendly'],
    description: 'Rodaje Z2 aeróbico corto. Cadencia 80-90 rpm. Ritmo conversacional sin presión de potencia.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '30-50 min en Z2 constante, cadencia 80-90rpm. Respiración nasal o conversación cómoda como referencia.',
  },
  {
    id: 'easy_z2_base',
    name: 'Easy Z2 base',
    category: 'easy',
    family: 'z2_aerobic',
    focus: ['z2', 'aerobic_base', 'cadence', 'steady'],
    intensity: 'low',
    tags: ['z2', 'aerobic_base', 'base', 'steady', 'beginner_friendly'],
    description: 'Rodaje Z2 aeróbico estándar. Construye motor aeróbico con bajo impacto articular.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '50-70 min en Z2 constante. Cadencia objetivo 85-90rpm. Sin aceleraciones ni cambios de ritmo.',
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
    typicalStructure: '45-60 min base Z2 intercalando 5 × 3 min a cadencia >100rpm con 5 min Z2 normal entre bloques.',
  },

  // ─── long_ride ───────────────────────────────────────────────────────────────
  {
    id: 'long_ride_z2',
    name: 'Long ride Z2',
    category: 'endurance',
    family: 'long_ride',
    focus: ['endurance', 'z2', 'aerobic_endurance', 'fat_oxidation'],
    intensity: 'moderate',
    tags: ['long_ride', 'aerobic_base', 'base', 'fondo', 'endurance'],
    description: 'Rodaje largo aeróbico. Desarrolla resistencia metabólica, tolerancia y eficiencia a baja intensidad.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '90-150 min en Z2 sostenido. Nutrición en ruta si supera 90 min. Cadencia constante, sin picar ritmo.',
  },
  {
    id: 'long_ride_progressive',
    name: 'Long ride progresivo',
    category: 'endurance',
    family: 'long_ride',
    focus: ['endurance', 'progression', 'tempo_finish', 'aerobic_strength'],
    intensity: 'moderate',
    tags: ['long_ride', 'progression', 'build', 'fondo', 'aerobic_strength'],
    description: 'Rodaje largo con progresión final: los últimos 20-30 min suben a Z3 o ritmo de sweetspot para entrenar en fatiga.',
    progressionLevel: 3,
    suitableRoles: ['primary'],
    typicalStructure: '80-120 min total. Primeros 60-80 min en Z2 cómodo. Últimos 20-30 min subiendo gradualmente a Z3-sweetspot.',
  },

  // ─── sweetspot_tempo ─────────────────────────────────────────────────────────
  {
    id: 'sweetspot_2x15',
    name: 'Sweetspot 2×15 min',
    category: 'sweetspot',
    family: 'sweetspot_tempo',
    focus: ['sweetspot', 'threshold', 'sustained_power', 'lactate'],
    intensity: 'moderate-high',
    tags: ['sweetspot', 'threshold', 'build', 'tempo', 'base_advanced'],
    description: 'Dos bloques de sweetspot de 15 min. Trabajo de umbral alto sin el costo de los intervalos VO2.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '10 min Z2 calentamiento + 2 × 15 min a 88-93% FTP (RPE 6-7) con 10 min Z2 entre bloques + 10 min Z2.',
  },
  {
    id: 'sweetspot_3x12',
    name: 'Sweetspot 3×12 min',
    category: 'sweetspot',
    family: 'sweetspot_tempo',
    focus: ['sweetspot', 'threshold', 'volume', 'sustained_power'],
    intensity: 'moderate-high',
    tags: ['sweetspot', 'threshold', 'build', 'tempo', 'vo2_support'],
    description: 'Tres bloques de sweetspot de 12 min. Mayor volumen de trabajo de umbral en bloque de construcción.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 3 × 12 min a 88-93% FTP con 8 min Z2 entre bloques + 10 min Z2.',
  },
  {
    id: 'tempo_sustained',
    name: 'Tempo continuo',
    category: 'tempo',
    family: 'sweetspot_tempo',
    focus: ['tempo', 'lactate', 'threshold', 'sustained_effort'],
    intensity: 'moderate-high',
    tags: ['tempo', 'threshold', 'build', 'sustained'],
    description: 'Bloque continuo a ritmo de tempo (76-84% FTP). Menos demandante que el sweetspot pero de mayor duración.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 30-40 min a tempo continuo (76-84% FTP, RPE 6) + 10 min Z2.',
  },

  // ─── intervals_vo2 ───────────────────────────────────────────────────────────
  {
    id: 'vo2max_5x5',
    name: 'VO2max 5×5 min',
    category: 'intervals_vo2',
    family: 'intervals_vo2',
    focus: ['vo2max', 'high_intensity', 'aerobic_power'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'build', 'peak', 'high_intensity'],
    description: 'Series de 5 min sobre FTP para desarrollar potencia aeróbica máxima. Exigente, requiere buena base.',
    progressionLevel: 3,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 5 × 5 min a >105% FTP (RPE 8-9) con 5 min Z2 de recuperación activa + 10 min Z2.',
  },
  {
    id: 'vo2max_8x3',
    name: 'VO2max 8×3 min',
    category: 'intervals_vo2',
    family: 'intervals_vo2',
    focus: ['vo2max', 'high_intensity', 'repeatability'],
    intensity: 'high',
    tags: ['vo2', 'intervals', 'build', 'peak', 'high_intensity'],
    description: 'Series cortas de 3 min sobre FTP. Más repeticiones, menor acumulación de fatiga por bloque.',
    progressionLevel: 2,
    suitableRoles: ['primary'],
    typicalStructure: '10 min Z2 + 8 × 3 min a >110% FTP con 3 min Z2 entre series + 10 min Z2.',
  },

  // ─── activation ──────────────────────────────────────────────────────────────
  {
    id: 'pre_event_activation',
    name: 'Activación pre-evento',
    category: 'activation',
    family: 'activation',
    focus: ['activation', 'race_prep', 'neuromuscular', 'feeling'],
    intensity: 'low',
    tags: ['activation', 'taper', 'race', 'pre_race', 'strides', 'beginner_friendly'],
    description: 'Activación corta antes de evento o día clave. Z2 suave con 2-3 esfuerzos cortos para despertar piernas.',
    progressionLevel: 1,
    suitableRoles: ['primary', 'support'],
    typicalStructure: '20-30 min Z2 suave + 3 × 30s a ritmo de carrera con recuperación completa. Sin acumular fatiga.',
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
  return CYCLING_SESSION_LIBRARY.find(s => s.id === id)
}
