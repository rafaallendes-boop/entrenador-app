import type { EquipmentType, ExerciseDefinition } from './exerciseLibrary'

export function hasExerciseEquipment(exercise: Pick<ExerciseDefinition, 'equipment' | 'requiredEquipment'>, available: readonly EquipmentType[]): boolean {
  return exercise.equipment.some((item) => available.includes(item))
    && (exercise.requiredEquipment ?? []).every((item) => available.includes(item))
}

/**
 * Vocabulario de equipamiento, con dos reconocedores deliberadamente separados.
 *
 * `detectEquipmentMentionsInName` lee el **nombre de un ejercicio** y responde
 * qué equipamiento nombra ese texto. `normalizeProfileEquipment` lee el
 * **inventario declarado por el atleta** y responde qué hay en su gimnasio.
 *
 * No comparten tabla a propósito: son preguntas distintas y sus errores tienen
 * costos distintos. `peso` en un inventario significa peso corporal; en un
 * nombre, «peso muerto» no habla de equipamiento. Fusionarlas haría que un
 * nombre de ejercicio pareciera un inventario, que es justo lo que el hallazgo
 * 4 de la auditoría pide evitar: que alguien mencione una prensa no demuestra
 * que su gimnasio tenga todas las máquinas.
 */

/** Segmento que niega el equipamiento que le sigue: «press banca sin máquina». */
const NEGATION_SEGMENTS: ReadonlySet<string> = new Set(['sin', 'without'])

/**
 * Tokens que, dentro del NOMBRE de un ejercicio, nombran equipamiento.
 *
 * Se evalúan de más largo a más corto para que `barra_hexagonal` gane sobre
 * `barra`. Un token sólo empata como secuencia completa de segmentos, así que
 * `bar` no aparece acá: en un inventario es señal útil, en un nombre empataría
 * con cualquier palabra que lo contenga.
 */
const NAME_EQUIPMENT_TOKENS: ReadonlyArray<readonly [string, EquipmentType]> = [
  ['trotadora_de_aire', 'air_treadmill'],
  ['trotadora_curva', 'air_treadmill'],
  ['cinta_curva', 'air_treadmill'],
  ['curved_treadmill', 'air_treadmill'],
  ['air_treadmill', 'air_treadmill'],
  // `cinta` a secas NO entra: en español de Chile «cinta elástica» es una
  // banda, y como token de nombre hacía que `filterCandidatesByNamedEquipment`
  // exigiera `treadmill`, dejando sin resolver 79 ejercicios cuyo nombre la
  // menciona. Sólo la secuencia completa nombra la máquina.
  ['cinta_de_correr', 'treadmill'],
  ['mini_vallas', 'mini_hurdles'],
  ['mini_valla', 'mini_hurdles'],
  ['mini_hurdle', 'mini_hurdles'],
  ['mini_hurdles', 'mini_hurdles'],
  ['barra_hexagonal', 'trap_bar'],
  ['balon_medicinal', 'medball'],
  ['pelota_medicinal', 'medball'],
  ['peso_corporal', 'bodyweight'],
  ['balon_suizo', 'stability_ball'],
  ['pelota_suiza', 'stability_ball'],
  ['pesa_rusa', 'kettlebell'],
  ['peck_deck', 'machine'],
  ['trap_bar', 'trap_bar'],
  ['hex_bar', 'trap_bar'],
  ['selectorizada', 'machine'],
  ['multipower', 'smith'],
  ['machines', 'machine'],
  ['machine', 'machine'],
  ['dumbbells', 'dumbbell'],
  ['bands', 'bands'],
  ['band', 'bands'],
  ['maquinas', 'machine'],
  ['maquina', 'machine'],
  ['mancuernas', 'dumbbell'],
  ['mancuerna', 'dumbbell'],
  ['kettlebell', 'kettlebell'],
  ['bodyweight', 'bodyweight'],
  ['dumbbell', 'dumbbell'],
  ['elasticos', 'bands'],
  ['elastico', 'bands'],
  ['barbell', 'barbell'],
  ['fitball', 'stability_ball'],
  ['poleas', 'cable'],
  ['bandas', 'bands'],
  ['discos', 'plate'],
  ['smith', 'smith'],
  ['polea', 'cable'],
  ['cable', 'cable'],
  ['banda', 'bands'],
  ['barra', 'barbell'],
  ['disco', 'plate'],
  ['trx', 'trx'],
  ['trotadora', 'treadmill'],
  ['treadmill', 'treadmill'],
]

const NAME_TOKENS_BY_LENGTH = [...NAME_EQUIPMENT_TOKENS].sort(
  ([left], [right]) => right.split('_').length - left.split('_').length,
)

/** Clave canónica de comparación: sin tildes, minúsculas, segmentos con `_`. */
export function normalizeStrengthExerciseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export interface EquipmentMentions {
  /** Equipamiento que el nombre pide. */
  requested: EquipmentType[]
  /** Equipamiento nombrado bajo negación: mencionarlo no es pedirlo. */
  negated: EquipmentType[]
}

/**
 * Qué equipamiento nombra el texto de un ejercicio.
 *
 * Sólo habla del nombre. No dice nada sobre lo que el atleta tiene disponible.
 */
export function detectEquipmentMentionsInName(name: string): EquipmentMentions {
  const segments = normalizeStrengthExerciseKey(name).split('_').filter(Boolean)
  const consumed = new Array<boolean>(segments.length).fill(false)
  const requested = new Set<EquipmentType>()
  const negated = new Set<EquipmentType>()

  for (const [token, equipment] of NAME_TOKENS_BY_LENGTH) {
    const tokenSegments = token.split('_')

    for (let start = 0; start + tokenSegments.length <= segments.length; start += 1) {
      const matches = tokenSegments.every((segment, offset) =>
        !consumed[start + offset] && segments[start + offset] === segment,
      )
      if (!matches) continue

      for (let offset = 0; offset < tokenSegments.length; offset += 1) consumed[start + offset] = true
      const isNegated = start > 0 && NEGATION_SEGMENTS.has(segments[start - 1]!)
      if (isNegated) negated.add(equipment)
      else requested.add(equipment)
    }
  }

  return { requested: [...requested], negated: [...negated] }
}

/**
 * Todo el equipamiento conocido. Es el significado de «no declarado»: un perfil
 * anterior a la captura de equipamiento se comporta como antes del cambio.
 */
export const ALL_EQUIPMENT: readonly EquipmentType[] = [
  'barbell', 'dumbbell', 'bodyweight', 'machine', 'smith', 'cable', 'kettlebell',
  'medball', 'bands', 'trap_bar', 'trx', 'box', 'ladder', 'plate', 'stability_ball',
  'assault_bike', 'air_treadmill', 'treadmill', 'mini_hurdles',
]

/**
 * Tokens del INVENTARIO declarado por el atleta, en orden de especificidad.
 *
 * Empatan por substring porque una entrada de inventario es texto libre
 * («barra olímpica», «bandas elásticas»). Nombres de máquinas puntuales
 * —prensa, peck deck, hack squat— quedan fuera a propósito: declarar una
 * prensa no acredita que el gimnasio tenga el resto de las máquinas, así que
 * se registran como no reconocidos en vez de ascender a `machine`.
 */
const INVENTORY_EQUIPMENT_TOKENS: ReadonlyArray<readonly [readonly string[], readonly EquipmentType[]]> = [
  [['trap', 'hex'], ['trap_bar']],
  [['trx', 'suspension'], ['trx']],
  [['cajon', 'box'], ['box']],
  [['escalera', 'ladder'], ['ladder']],
  [['assault', 'asalto', 'air bike', 'bici'], ['assault_bike']],
  // Antes que cualquier fila de cinta: «cinta elástica» es una banda.
  [['banda', 'elastico', 'elastica', 'band', 'goma'], ['bands']],
  [['air runner', 'air treadmill', 'trotadora de aire', 'curved', 'curva'], ['air_treadmill']],
  [['mini valla', 'minivalla', 'mini hurdle', 'vallas'], ['mini_hurdles']],
  [['cinta de correr', 'cinta corredora', 'caminadora', 'treadmill'], ['treadmill']],
  // «Trotadora» o «cinta» a secas es ambiguo y ya estaba guardado en perfiles
  // anteriores, donde significaba la curva. Acreditar sólo `treadmill` le
  // quitaría en silencio un ejercicio que el atleta ya tenía: se acreditan
  // ambas y la desambiguación queda en la selección fina.
  [['trotadora', 'cinta'], ['treadmill', 'air_treadmill']],
  [['disco', 'plate'], ['plate']],
  [['stability', 'swiss', 'fitball', 'balon suizo', 'pelota suiza'], ['stability_ball']],
  [['smith', 'multipower'], ['smith']],
  [['peso corporal', 'bodyweight', 'body weight', 'calistenia'], ['bodyweight']],
  [['pesa rusa', 'kettle'], ['kettlebell']],
  [['medicinal', 'medball', 'med ball'], ['medball']],
  [['maquina', 'machine', 'selectorizada'], ['machine']],
  [['polea', 'cable'], ['cable']],
  [['mancuerna', 'dumb'], ['dumbbell']],
  [['barra', 'barbell', 'bar'], ['barbell']],
]

const CANONICAL_EQUIPMENT = new Map<string, EquipmentType>(
  ALL_EQUIPMENT.map((item) => [item, item]),
)

export interface DeclaredEquipment {
  /** Hubo una declaración, aunque sus entradas no se hayan reconocido. */
  declared: boolean
  equipment: EquipmentType[]
  /** Entradas que no se pudieron interpretar, tal como las escribió el atleta. */
  unrecognized: string[]
}

function normalizeInventoryEntry(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Qué equipamiento tiene disponible el atleta, según lo que declaró.
 *
 * Tres estados distintos, y ninguno se confunde con otro:
 *   - `undefined` → sin declarar. Se resuelve a todo el equipamiento, que es
 *     exactamente el comportamiento anterior a este campo.
 *   - `[]` → seleccionó nada. Se respeta: no hay equipamiento disponible. No se
 *     convierte en gimnasio completo, porque eso produciría sesiones que el
 *     atleta no puede ejecutar.
 *   - texto no interpretable → no habilita equipo por suposición. Los términos
 *     quedan registrados para poder corregir la declaración.
 */
export function resolveDeclaredEquipment(values: readonly string[] | undefined): DeclaredEquipment {
  if (values == null) return { declared: false, equipment: [...ALL_EQUIPMENT], unrecognized: [] }
  if (values.length === 0) return { declared: true, equipment: [], unrecognized: [] }

  const equipment = new Set<EquipmentType>()
  const unrecognized: string[] = []

  for (const value of values) {
    const normalized = normalizeInventoryEntry(value)

    // Un valor canónico se reconoce por identidad. Sin esto, `air_treadmill`
    // —que la UI y los contextos internos ya escriben en su forma canónica— no
    // empataría con ninguno de los tokens en español.
    const canonical = CANONICAL_EQUIPMENT.get(normalized.replace(/[\s-]+/g, '_'))
    if (canonical) {
      equipment.add(canonical)
      continue
    }

    const match = INVENTORY_EQUIPMENT_TOKENS.find(([tokens]) =>
      tokens.some((token) => normalized.includes(token)),
    )
    if (match) for (const item of match[1]) equipment.add(item)
    else unrecognized.push(value)
  }

  if (equipment.size === 0) {
    return { declared: true, equipment: [], unrecognized }
  }

  return { declared: true, equipment: [...equipment], unrecognized }
}

/**
 * El equipamiento tal como lo consume el selector: la lista declarada, o
 * `undefined` sólo cuando no hay declaración.
 *
 * Es la única conversión de perfil a contexto de selección. Todo productor de
 * una sesión de fuerza —plan builder, prompt, chat, reparaciones— la usa, para
 * que capturar el equipamiento y respetarlo no puedan divergir.
 */
export function resolveSelectorEquipment(
  values: readonly string[] | undefined,
): EquipmentType[] | undefined {
  const declared = resolveDeclaredEquipment(values)
  return declared.declared ? declared.equipment : undefined
}
