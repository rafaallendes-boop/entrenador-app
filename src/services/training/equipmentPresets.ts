import type { EquipmentType } from './exerciseLibrary'

/**
 * Presets de equipamiento para la captura en el wizard.
 *
 * Un preset es una declaración, no un atajo de UI: lo que el atleta elige acá
 * es exactamente lo que el selector puede usar. Por eso «Gimnasio completo»
 * guarda la lista entera en vez de dejar el campo ausente — ausente significa
 * «nunca se preguntó», y esa distinción se pierde si la UI la reutiliza.
 *
 * El inventario es por familia, no por máquina. Declarar `machine` dice que el
 * gimnasio tiene máquinas de fuerza; NO acredita que tenga prensa, peck deck y
 * hack squat. Modelar máquina por máquina se descartó a propósito para un
 * piloto de 1–3 personas, y el copy del preset lo dice.
 */

export type EquipmentPresetId = 'full_gym' | 'machine_gym' | 'free_weights' | 'home' | 'custom'

export interface EquipmentPreset {
  id: EquipmentPresetId
  label: string
  hint: string
  equipment: EquipmentType[]
}

const ACCESSORIES: EquipmentType[] = ['bodyweight', 'box', 'medball', 'bands', 'plate', 'stability_ball']

export const EQUIPMENT_PRESETS: readonly EquipmentPreset[] = [
  {
    id: 'full_gym',
    label: 'Gimnasio completo',
    hint: 'Barra, mancuernas, máquinas, poleas y accesorios.',
    equipment: [
      'barbell', 'dumbbell', 'kettlebell', 'machine', 'smith', 'cable', 'trap_bar', 'trx',
      'assault_bike', 'air_treadmill', 'ladder', ...ACCESSORIES,
    ],
  },
  {
    id: 'machine_gym',
    label: 'Gimnasio de máquinas',
    hint: 'Máquinas, poleas, Smith y mancuernas, sin barra libre. Supone un gimnasio equipado: declarar máquinas no acredita que estén todas.',
    equipment: ['machine', 'smith', 'cable', 'dumbbell', ...ACCESSORIES],
  },
  {
    id: 'free_weights',
    label: 'Sólo pesos libres',
    hint: 'Barra, mancuernas y kettlebells, sin máquinas ni poleas.',
    equipment: ['barbell', 'dumbbell', 'kettlebell', 'trap_bar', ...ACCESSORIES],
  },
  {
    id: 'home',
    label: 'En casa',
    hint: 'Mancuernas, bandas y peso corporal.',
    equipment: ['dumbbell', 'bands', 'bodyweight'],
  },
]

/** Etiquetas en español para la selección fina. */
export const EQUIPMENT_LABELS: Record<EquipmentType, string> = {
  barbell: 'Barra',
  dumbbell: 'Mancuernas',
  bodyweight: 'Peso corporal',
  machine: 'Máquinas de fuerza',
  smith: 'Smith / multipower',
  cable: 'Poleas',
  kettlebell: 'Kettlebells',
  medball: 'Balón medicinal',
  bands: 'Bandas elásticas',
  trap_bar: 'Barra hexagonal',
  trx: 'TRX',
  box: 'Cajón',
  ladder: 'Escalera de agilidad',
  plate: 'Discos',
  stability_ball: 'Fitball',
  assault_bike: 'Bici de asalto',
  air_treadmill: 'Trotadora curva',
}

/** El preset cuyo inventario coincide exactamente, o `custom` si no hay ninguno. */
export function matchEquipmentPreset(equipment: readonly string[] | undefined): EquipmentPresetId | undefined {
  if (equipment == null) return undefined

  const selected = new Set(equipment)
  const preset = EQUIPMENT_PRESETS.find((candidate) =>
    candidate.equipment.length === selected.size &&
    candidate.equipment.every((item) => selected.has(item)),
  )
  return preset?.id ?? 'custom'
}
