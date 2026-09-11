import type { AthleticPrescription, EquipmentType, ExerciseDefinition } from './exerciseLibrary'

const landingCue = 'Busca distancia con una recepción estable. Reinicia la posición entre intentos y detén la serie si pierdes distancia o control.'
const reactiveCue = 'Usa mini vallas bajas y contactos rápidos. Prioriza el ritmo y la alineación de rodilla y pie; detente si aumenta el tiempo de contacto.'
const ladderCue = 'Prioriza precisión de apoyos antes de acelerar. Una pasada recorre toda la escalera; alterna la dirección o el pie de inicio.'

const ladderDose: AthleticPrescription = {
  kind: 'coordination', sets: 2, reps: '2 pasadas por dirección', restSeconds: 45, cues: ladderCue,
}

/** Dosis para identidades ya existentes: no se duplican ejercicios por cambiar el nombre. */
export const ATHLETIC_PRESCRIPTIONS: Partial<Record<string, AthleticPrescription>> = {
  broad_jump: { kind: 'horizontal_power', sets: 3, reps: 3, restSeconds: 120, cues: landingCue },
  single_leg_broad_jump: { kind: 'horizontal_power', sets: 3, reps: '3 saltos por pierna', restSeconds: 120, cues: landingCue },
  lateral_skater_jumps: { kind: 'reactive_power', sets: 3, reps: '4 saltos por lado', restSeconds: 90, cues: 'Empuja lateralmente y absorbe cada recepción antes de cambiar de lado. Mantén la distancia sólo mientras controles la cadera y la rodilla.' },
  pogo_jumps: { kind: 'reactive_power', sets: 3, reps: '8 contactos', restSeconds: 60, cues: 'Rebotes bajos y rápidos desde el tobillo. Corta la serie si los contactos se vuelven pesados.' },
  ladder_bipodal_front_1: ladderDose,
  ladder_bipodal_front_2: ladderDose,
  ladder_bipodal_front_3: ladderDose,
  ladder_coordinativo_front_2: ladderDose,
  ladder_coordinativo_front_4: ladderDose,
  ladder_bipodal_lateral_1: ladderDose,
  ladder_bipodal_lateral_3: ladderDose,
  assault_bike_30_30: { kind: 'finisher', sets: 1, reps: '4 min: 30s fuerte / 30s suave', restSeconds: 0,
    cues: 'Cuatro rondas en total. Pedalea suave durante la recuperación; el esfuerzo fuerte debe ser repetible, sin buscar el fallo.' },
  air_treadmill_20_20: { kind: 'finisher', sets: 1, reps: '4 min: 20s fuerte / 20s suave', restSeconds: 0,
    cues: 'Seis rondas en total. Reduce el ritmo durante la recuperación y conserva la técnica de carrera.' },
}

export const ATHLETIC_REQUIRED_EQUIPMENT: Partial<Record<string, EquipmentType[]>> = {
  ...Object.fromEntries(Object.entries(ATHLETIC_PRESCRIPTIONS)
    .filter(([, dose]) => dose?.kind === 'coordination')
    .map(([id]) => [id, ['ladder'] as EquipmentType[]])),
  assault_bike_30_30: ['assault_bike'],
  air_treadmill_20_20: ['air_treadmill'],
}

export const ATHLETIC_EXERCISES: ExerciseDefinition[] = [
  {
    id: 'repeated_broad_jump', name: 'Tres saltos horizontales encadenados',
    category: 'full_body', movement: 'locomotion', intensityType: 'power', equipment: ['bodyweight'],
    tags: ['power', 'jump_power', 'athletic_transfer', 'squash_specific'],
    description: 'Encadena tres saltos bipodales hacia delante y estabiliza la última recepción. Busca cubrir distancia manteniendo el control en los tres apoyos.',
    aliases: ['Triple broad jump', 'Saltos horizontales consecutivos', 'Multisaltos horizontales'],
    difficulty: 'advanced', sportsTransfer: ['squash', 'running', 'strength'], squashTransfer: ['horizontal_power', 'landing_quality'],
    riskLevel: 'high', fatigueCost: 'medium', appropriateForPhases: ['build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'hamstring'], loadPatterns: ['impact'] },
    athleticPrescription: { kind: 'horizontal_power', sets: 3, reps: '3 saltos encadenados', restSeconds: 120, cues: 'Cada serie es una secuencia de tres saltos, nueve contactos de trabajo en total. Mide la distancia de la secuencia con una recepción final estable.' },
  },
  {
    id: 'alternating_horizontal_bounds', name: 'Saltos horizontales alternados',
    category: 'full_body', movement: 'locomotion', intensityType: 'power', equipment: ['bodyweight'], unilateral: true,
    tags: ['power', 'jump_power', 'athletic_transfer', 'squash_specific'],
    description: 'Avanza con saltos largos alternando pierna derecha e izquierda. Empuja hacia delante sin buscar longitud a costa del control de la recepción.',
    aliases: ['Alternating bounds', 'Bounding horizontal', 'Zancadas explosivas horizontales'],
    difficulty: 'advanced', sportsTransfer: ['squash', 'running'], squashTransfer: ['horizontal_power', 'single_leg_power'],
    riskLevel: 'high', fatigueCost: 'medium', appropriateForPhases: ['build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'hamstring'], loadPatterns: ['impact'] },
    athleticPrescription: { kind: 'horizontal_power', sets: 3, reps: '6 apoyos alternados (3 por pierna)', restSeconds: 120, cues: landingCue },
  },
  {
    id: 'mini_hurdle_lateral_rebounds', name: 'Saltos laterales rápidos sobre mini valla',
    category: 'full_body', movement: 'locomotion', intensityType: 'power', equipment: ['mini_hurdles'],
    tags: ['power', 'lateral_power', 'reactive_stiffness', 'athletic_transfer', 'squash_specific'],
    description: 'Con los pies juntos, salta lateralmente de ida y vuelta sobre una mini valla baja. Mantén el tronco estable y minimiza el tiempo de apoyo.',
    aliases: ['Lateral mini hurdle hops', 'Saltos laterales mini vallas', 'Mini hurdle lateral rebounds'],
    difficulty: 'intermediate', sportsTransfer: ['squash', 'running'], squashTransfer: ['lateral_power', 'reactive_stiffness', 'split_step_quality'],
    riskLevel: 'medium', fatigueCost: 'medium', appropriateForPhases: ['build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'groin'], loadPatterns: ['impact'] },
    athleticPrescription: { kind: 'reactive_power', sets: 3, reps: '6 contactos (3 por dirección)', restSeconds: 90, cues: reactiveCue },
  },
  {
    id: 'mini_hurdle_single_leg_lateral_hops', name: 'Saltos laterales a una pierna sobre mini valla',
    category: 'full_body', movement: 'locomotion', intensityType: 'power', equipment: ['mini_hurdles'], unilateral: true,
    tags: ['power', 'lateral_power', 'reactive_stiffness', 'squash_specific'],
    description: 'Salta lateralmente sobre una mini valla baja apoyando una sola pierna. Completa pocos contactos y cambia de pierna tras recuperar el control.',
    aliases: ['Single leg lateral mini hurdle hops', 'Mini vallas laterales unipodales'],
    difficulty: 'advanced', sportsTransfer: ['squash'], squashTransfer: ['single_leg_power', 'lateral_power', 'landing_quality'],
    riskLevel: 'high', fatigueCost: 'medium', appropriateForPhases: ['build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'groin'], loadPatterns: ['impact'] },
    athleticPrescription: { kind: 'reactive_power', sets: 3, reps: '4 contactos por pierna', restSeconds: 120, cues: reactiveCue },
  },
  {
    id: 'ladder_lateral_crossover', name: 'Escalera lateral con paso cruzado',
    category: 'full_body', movement: 'locomotion', intensityType: 'stability', equipment: ['ladder'],
    tags: ['court_footwork', 'coordination', 'squash_specific'],
    description: 'Desplázate de costado por la escalera alternando un paso lateral y un cruce por delante. Mantén precisión en los cuadros y repite hacia ambos lados.',
    aliases: ['Ladder lateral crossover', 'Escalera carioca', 'Paso cruzado en escalera'],
    difficulty: 'intermediate', sportsTransfer: ['squash'], squashTransfer: ['lateral_movement', 'footwork_rhythm'],
    riskLevel: 'low', fatigueCost: 'low', appropriateForPhases: ['base', 'build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'groin'], loadPatterns: ['impact'] },
    athleticPrescription: ladderDose,
  },
  {
    id: 'ladder_lateral_icky_shuffle', name: 'Escalera lateral con Icky shuffle',
    category: 'full_body', movement: 'locomotion', intensityType: 'stability', equipment: ['ladder'],
    tags: ['court_footwork', 'coordination', 'squash_specific'],
    description: 'Recorre la escalera de lado enlazando dos apoyos dentro y uno fuera. Mantén el pecho orientado al frente y practica ambas direcciones.',
    aliases: ['Lateral Icky shuffle', 'Icky shuffle lateral'],
    difficulty: 'intermediate', sportsTransfer: ['squash'], squashTransfer: ['lateral_movement', 'footwork_rhythm'],
    riskLevel: 'low', fatigueCost: 'low', appropriateForPhases: ['base', 'build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip'], loadPatterns: ['impact'] },
    athleticPrescription: ladderDose,
  },
  {
    id: 'ladder_split_step_acceleration', name: 'Escalera con split-step y salida de 3 metros',
    category: 'full_body', movement: 'locomotion', intensityType: 'stability', equipment: ['ladder'],
    tags: ['court_footwork', 'coordination', 'squash_specific'],
    description: 'Recorre la escalera con apoyos precisos, realiza un split-step al salir y acelera tres metros. Deja espacio libre para frenar de forma progresiva.',
    aliases: ['Ladder split step acceleration', 'Escalera con salida explosiva'],
    difficulty: 'intermediate', sportsTransfer: ['squash'], squashTransfer: ['split_step_quality', 'court_reacceleration'],
    riskLevel: 'medium', fatigueCost: 'medium', appropriateForPhases: ['base', 'build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'hamstring'], loadPatterns: ['impact'] },
    athleticPrescription: { ...ladderDose, reps: '2 pasadas con salida de 3 m', restSeconds: 60 },
  },
  {
    id: 'treadmill_30_30', name: 'Cinta 30/30 — 4 rondas',
    category: 'full_body', movement: 'locomotion', intensityType: 'power', equipment: ['treadmill', 'air_treadmill'],
    tags: ['finisher', 'cardio_specific', 'court_conditioning', 'repeat_sprint', 'squash_specific'],
    description: 'Completa cuatro rondas de 30 segundos fuertes y 30 segundos suaves en cinta: cuatro minutos en total. Ajusta la velocidad al esfuerzo que puedas repetir con buena técnica.',
    aliases: ['Treadmill 30/30', 'Cinta 4 x 30/30', 'Trotadora 30/30', 'Finisher cinta 30 segundos in 30 segundos out'],
    difficulty: 'intermediate', sportsTransfer: ['squash', 'running'], squashTransfer: ['repeat_sprint_capacity', 'short_point_recovery'],
    riskLevel: 'medium', fatigueCost: 'high', appropriateForPhases: ['base', 'build', 'peak'],
    safety: { loadsRegions: ['knee', 'ankle', 'calf', 'achilles', 'foot', 'hip', 'hamstring'], loadPatterns: ['impact'] },
    athleticPrescription: { kind: 'finisher', sets: 1, reps: '4 rondas: 30s fuerte / 30s suave (4 min)', restSeconds: 0,
      cues: 'Recupera bajando la velocidad, sin saltar a los laterales de la cinta en movimiento. Considera el tiempo de aceleración de la máquina; los intervalos fuertes deben ser repetibles.' },
  },
  {
    id: 'assault_bike_15_45', name: 'Bici de asalto 15/45 — 6 rondas',
    category: 'full_body', movement: 'locomotion', intensityType: 'power', equipment: ['assault_bike'],
    tags: ['finisher', 'cardio_specific', 'court_conditioning', 'repeat_sprint', 'squash_specific'],
    description: 'Completa seis rondas de 15 segundos fuertes y 45 segundos de pedaleo suave: seis minutos en total. Conserva una potencia repetible entre rondas.',
    aliases: ['Assault bike 15/45', 'Air bike 15/45', 'Finisher bici 15/45'],
    difficulty: 'intermediate', sportsTransfer: ['squash'], squashTransfer: ['repeat_sprint_capacity', 'short_point_recovery'],
    riskLevel: 'low', fatigueCost: 'high', appropriateForPhases: ['base', 'build', 'peak'],
    safety: { loadsRegions: ['knee', 'hip', 'shoulder', 'elbow'], loadPatterns: [] },
    athleticPrescription: { kind: 'finisher', sets: 1, reps: '6 rondas: 15s fuerte / 45s suave (6 min)', restSeconds: 0,
      cues: 'Pedalea suave durante los 45 segundos de recuperación. Termina el bloque si la potencia o la técnica se deterioran.' },
  },
]
