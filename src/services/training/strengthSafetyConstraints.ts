import type {
  BodyRegion, ConstraintKey, ConstraintSource, ConstraintSources, LoadPattern,
  StrengthConstraint, UnresolvedConstraintReason,
} from '../../types/strengthSafety'
import type { ExerciseDefinition } from './exerciseLibrary'

export interface SafetyConstraintInput {
  currentInjuries?: string
  restrictions?: string
  injuryNotes?: string
  userMessages?: readonly string[]
  trainingPriority?: string
}

const SOURCE_ORDER: readonly ConstraintSource[] = [
  'current_injuries', 'restrictions', 'injury_notes', 'user_message', 'training_priority',
]
const MEDICALLY_SCOPED = new Set<ConstraintSource>(['current_injuries', 'injury_notes'])
const REGION_SYNONYMS: ReadonlyArray<readonly [BodyRegion, readonly string[]]> = [
  ['lumbar', ['lumbar', 'espalda baja', 'espalda inferior', 'cuadrado lumbar', 'lumbago', 'hernia discal', 'zona lumbar', 'l4', 'l5', 'psoas']],
  ['thoracic', ['dorsal', 'espalda alta', 'toracic', 'dorsalgia']],
  ['cervical', ['cervical', 'cuello', 'trapecio']],
  ['trunk_core', ['zona media', 'core', 'abdominal', 'abdomen']],
  ['chest_ribs', ['costilla', 'costal', 'esternon', 'pectoral', 'condritis']],
  ['pelvis_sacroiliac', ['sacroiliac', 'sacro', 'pelvis', 'coxis']],
  ['shoulder', ['hombro', 'manguito rotador', 'manguito', 'supraespinoso', 'deltoides', 'acromioclavicular', 'clavicula']],
  ['elbow', ['codo', 'epicondilitis', 'epitrocleitis', 'epicondil']],
  ['wrist', ['muneca', 'carpo', 'tunel carpiano']],
  ['hip', ['cadera', 'gluteo', 'piramidal', 'labrum']],
  ['groin', ['aductor', 'ingle', 'pubalgia', 'pubis']],
  ['hamstring', ['isquiotibial', 'isquios', 'biceps femoral']],
  ['knee', ['rodilla', 'rotulian', 'rotula', 'menisco', 'ligamento cruzado', 'lca', 'condromalacia']],
  ['calf', ['gemelo', 'soleo', 'pantorrilla']],
  ['achilles', ['aquiles', 'aquileo']],
  ['ankle', ['tobillo', 'peroneo', 'esguince de tobillo']],
  ['foot', ['fascitis plantar', 'fascitis', 'metatarso', 'planta del pie', 'pie']],
]
const PATTERN_SYNONYMS: ReadonlyArray<readonly [LoadPattern, readonly string[]]> = [
  ['axial_load', ['carga axial', 'compresion axial', 'axial', 'peso sobre la espalda', 'barra en la espalda']],
  ['loaded_hinge', ['peso muerto', 'hinge', 'bisagra de cadera', 'flexion de tronco cargada']],
  ['impact', ['impacto', 'pliometr', 'saltos', 'salto']],
  ['deep_flexion', ['flexion profunda', 'sentadilla profunda', 'rango profundo']],
  ['overhead', ['sobre la cabeza', 'overhead', 'por encima de la cabeza']],
  ['rotation', ['rotacion', 'giro', 'torsion']],
  ['grip_demand', ['agarre', 'prension', 'grip']],
]
const MEDICAL_MARKERS = ['lesion', 'lesionad', 'dolor', 'duele', 'molestia', 'tendinitis', 'tendinopat', 'esguince', 'rotura', 'desgarro', 'hernia', 'operad', 'operaron', 'cirugia', 'postoperator', 'fractura', 'inflamacion', 'kinesiolog', 'fisioterap', 'traumatolog', 'medico']
const AVOIDANCE_TOKENS = ['sin ', 'evitar ', 'evita ', 'evite ', 'evito ', 'no ', 'nada de ', 'ninguna ', 'ningun ', 'ninguno ']
const SYMPTOM_OBJECTS = ['dolor', 'lesion', 'molestia', 'problema', 'restriccion', 'limitacion']
const ABSENCE_SENTINELS = [
  'ninguna', 'ninguno', 'no aplica', 'n/a', 'na', 'nada', 'sin restricciones', 'sin lesiones', 'ok', '-',
  'todo bien', 'todo ok', 'todo en orden', 'bien', 'sin novedad', 'sin novedades',
  'nada que reportar', 'sano', 'sana', 'no', 'ninguna lesion', 'sin problemas',
]
/**
 * Declaraciones de lesión ya superada. Se reconocen sólo con marca temporal
 * explícita de cierre ("ya recuperado", "dado de alta"): "en recuperación" o
 * "me estoy recuperando" describen un proceso EN CURSO y deben seguir
 * excluyendo. Una negación en la cláusula desactiva el reconocimiento, porque
 * "no estoy recuperado" significa lo contrario y ante la duda se conserva la
 * restricción.
 */
const RESOLVED_MARKERS = [
  'ya recuperad', 'ya me recupere', 'ya estoy recuperad', 'totalmente recuperad',
  'completamente recuperad', 'dado de alta', 'ya sano', 'ya sana', 'sin secuelas', 'ya supere',
]
/**
 * Recuperación NEGADA o en curso. Tiene que ganarle al reconocimiento de
 * ausencia: "no estoy recuperado de la lesión de rodilla" empieza con el token
 * de evitación "no " y contiene un objeto sintomático, así que la heurística de
 * ausencia lo leía como "no tengo nada" — exactamente lo contrario de lo que
 * dice el atleta.
 */
const UNRESOLVED_RECOVERY_MARKERS = [
  'no estoy recuperad', 'no me he recuperad', 'no me recupero', 'no recuperad',
  'aun no', 'todavia no', 'sigo lesionad', 'sigo con dolor', 'sigo con molestia',
  'en recuperacion', 'recuperandome', 'me estoy recuperando',
]
const NEUTRAL_LOAD_TERMS = ['fatiga', 'cansancio', 'agotamiento', 'sobrecarga general', 'cansado']

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}
function findRegions(clause: string): BodyRegion[] {
  return REGION_SYNONYMS.filter(([, names]) => names.some((name) => clause.includes(name))).map(([region]) => region)
}
function findPatterns(clause: string): LoadPattern[] {
  return PATTERN_SYNONYMS.filter(([, names]) => names.some((name) => clause.includes(name))).map(([pattern]) => pattern)
}
function startsOwnMode(fragment: string): boolean {
  const value = fragment.trim()
  return AVOIDANCE_TOKENS.some((token) => value.startsWith(token)) || MEDICAL_MARKERS.some((marker) => value.includes(marker))
}
function splitClauses(text: string): string[] {
  return text.split(/[,.;\n]+/).flatMap((part) => {
    const sections = part.trim().split(/\s+y\s+/)
    if (!sections[0]) return []
    const result: string[] = []
    let current = sections[0]
    for (const next of sections.slice(1)) {
      if (startsOwnMode(next)) { result.push(current); current = next } else current = `${current} y ${next}`
    }
    result.push(current)
    return result.filter(Boolean)
  })
}
type ClauseMode = 'active_medical' | 'prohibitive' | 'resolved_absence' | 'neutral'
function classifyClause(clause: string, source: ConstraintSource): ClauseMode {
  // Se evalúa ANTES que cualquier reconocimiento de ausencia: una recuperación
  // negada o en curso es una restricción vigente, no una declaración de que no
  // hay nada.
  if (UNRESOLVED_RECOVERY_MARKERS.some((marker) => clause.includes(marker))) {
    return 'active_medical'
  }
  if (RESOLVED_MARKERS.some((marker) => clause.includes(marker)) && !clause.includes('no ')) {
    return 'resolved_absence'
  }
  if (AVOIDANCE_TOKENS.some((token) => clause.startsWith(token) || clause.includes(` ${token}`))) {
    if (SYMPTOM_OBJECTS.some((term) => clause.includes(term))) return 'resolved_absence'
    return findRegions(clause).length || findPatterns(clause).length ? 'prohibitive' : 'neutral'
  }
  if (NEUTRAL_LOAD_TERMS.some((term) => clause.includes(term))) return 'neutral'
  return MEDICAL_MARKERS.some((marker) => clause.includes(marker)) || MEDICALLY_SCOPED.has(source)
    ? 'active_medical' : 'neutral'
}
type ConstraintPayload =
  | { kind: 'region'; region: BodyRegion }
  | { kind: 'load_pattern'; pattern: LoadPattern }
  | { kind: 'unresolved_medical_restriction'; reason: UnresolvedConstraintReason }
type RawConstraint = { key: ConstraintKey; constraint: ConstraintPayload; source: ConstraintSource }
function parseField(text: string | undefined, source: ConstraintSource): RawConstraint[] {
  if (!text?.trim()) return []
  const normalized = normalize(text)
  if (ABSENCE_SENTINELS.includes(normalized)) return []
  return splitClauses(normalized).flatMap((rawClause): RawConstraint[] => {
    // La puntuación de borde no cambia el significado, y sin recortarla un
    // simple "Ninguna." dejaba de reconocerse como ausencia y bloqueaba toda
    // la generación de fuerza del atleta de forma permanente.
    const clause = rawClause.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim()
    if (!clause || ABSENCE_SENTINELS.includes(clause)) return []
    const mode = classifyClause(clause, source)
    if (mode === 'neutral' || mode === 'resolved_absence') return []
    const regions = findRegions(clause)
    const patterns = findPatterns(clause)
    if (!regions.length && !patterns.length) return mode === 'active_medical'
      ? [{ key: 'unresolved:medical_marker_without_supported_constraint', constraint: { kind: 'unresolved_medical_restriction', reason: 'medical_marker_without_supported_constraint' }, source }]
      : []
    return [
      ...regions.map((region): RawConstraint => ({ key: `region:${region}`, constraint: { kind: 'region', region }, source })),
      ...patterns.map((pattern): RawConstraint => ({ key: `pattern:${pattern}`, constraint: { kind: 'load_pattern', pattern }, source })),
    ]
  })
}
/**
 * ¿Queda texto de restricción que el parser no resolvió NI reconoció como
 * ausencia? Es distinto de "no hay restricciones": una cláusula que el parser
 * descarta por no entenderla no autoriza a delegar la sesión en los selectores
 * locales. Fatiga y cansancio quedan fuera a propósito — son señal de carga,
 * no médica— igual que las declaraciones de ausencia.
 *
 * Vive acá porque este módulo es la única autoridad que interpreta texto libre.
 */
export function hasUnrecognizedRestrictionText(input: SafetyConstraintInput): boolean {
  const fields: Array<[string | undefined, ConstraintSource]> = [
    [input.currentInjuries, 'current_injuries'],
    [input.restrictions, 'restrictions'],
    [input.injuryNotes, 'injury_notes'],
  ]
  return fields.some(([text, source]) => {
    if (!text?.trim()) return false
    return splitClauses(normalize(text)).some((rawClause) => {
      const clause = rawClause.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim()
      if (!clause || ABSENCE_SENTINELS.includes(clause)) return false
      const mode = classifyClause(clause, source)
      if (mode === 'resolved_absence') return false
      if (NEUTRAL_LOAD_TERMS.some((term) => clause.includes(term))) return false
      return findRegions(clause).length === 0 && findPatterns(clause).length === 0
    })
  })
}

/**
 * ¿El atleta declaró ALGO, aunque el parser no lo estructure?
 *
 * Distinta de `hasUnrecognizedRestrictionText`, que sólo cuenta el texto capaz
 * de esconder una restricción real. Acá alcanza con que la declaración no sea
 * una ausencia explícita: "vengo con sobrecarga general" no produce ninguna
 * zona y aun así es contexto legítimo para el prompt, mientras que "Ninguna."
 * no debe inducir cautela que nadie pidió.
 *
 * Vive acá porque este módulo es la única autoridad que interpreta texto libre.
 */
export function hasDeclaredRestrictionSignal(input: SafetyConstraintInput): boolean {
  const fields: Array<[string | undefined, ConstraintSource]> = [
    [input.currentInjuries, 'current_injuries'],
    [input.restrictions, 'restrictions'],
    [input.injuryNotes, 'injury_notes'],
  ]
  return fields.some(([text, source]) => {
    if (!text?.trim()) return false
    return splitClauses(normalize(text)).some((rawClause) => {
      const clause = rawClause.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim()
      if (!clause || ABSENCE_SENTINELS.includes(clause)) return false
      return classifyClause(clause, source) !== 'resolved_absence'
    })
  })
}

export function constraintKey(constraint: StrengthConstraint): ConstraintKey {
  if (constraint.kind === 'region') return `region:${constraint.region}`
  if (constraint.kind === 'load_pattern') return `pattern:${constraint.pattern}`
  return `unresolved:${constraint.reason}`
}
function keyRank(key: ConstraintKey): number {
  if (key.startsWith('region:')) return REGION_SYNONYMS.findIndex(([v]) => v === key.slice(7))
  if (key.startsWith('pattern:')) return 100 + PATTERN_SYNONYMS.findIndex(([v]) => v === key.slice(8))
  const reason = key.slice(11) as UnresolvedConstraintReason
  return 200 + (reason === 'medical_marker_without_supported_constraint' ? 0 : 1)
}
export function resolveStrengthSafetyConstraints(input: SafetyConstraintInput): readonly StrengthConstraint[] {
  const profile = [
    ...parseField(input.currentInjuries, 'current_injuries'), ...parseField(input.restrictions, 'restrictions'),
    ...parseField(input.injuryNotes, 'injury_notes'),
  ]
  // Decisión del owner (2026-09-14): con una zona ya identificada en el perfil,
  // "considerando mi lesión de espalda" o "el kine aún no me da permiso" hablan
  // de esa misma lesión. Sin esta lectura, la marca sin zona del mensaje
  // bloqueaba toda la fuerza aunque la restricción real ya estuviera resuelta.
  // Sólo se absorbe la marca sin zona del MENSAJE: una zona nueva se suma, y
  // una marca sin zona del propio perfil o `return_to_play` siguen bloqueando.
  const profileHasRegion = profile.some((item) => item.constraint.kind === 'region')
  const message = (input.userMessages ?? []).flatMap((text) => parseField(text, 'user_message'))
    .filter((item) => !(profileHasRegion && item.constraint.kind === 'unresolved_medical_restriction'))
  const raw = [
    ...profile, ...message,
    ...(input.trainingPriority === 'return_to_play' ? [{ key: 'unresolved:structured_priority_without_detail' as const, constraint: { kind: 'unresolved_medical_restriction' as const, reason: 'structured_priority_without_detail' as const }, source: 'training_priority' as const }] : []),
  ]
  const merged = new Map<ConstraintKey, { constraint: ConstraintPayload; sources: Set<ConstraintSource> }>()
  for (const item of raw) {
    const current = merged.get(item.key)
    if (current) current.sources.add(item.source)
    else merged.set(item.key, { constraint: item.constraint, sources: new Set([item.source]) })
  }
  return [...merged.entries()].sort(([a], [b]) => keyRank(a) - keyRank(b)).map(([, value]) => ({
    ...value.constraint,
    sources: SOURCE_ORDER.filter((source) => value.sources.has(source)) as unknown as ConstraintSources,
  })) as unknown as readonly StrengthConstraint[]
}
/** Une conjuntos ya resueltos sin perder procedencia ni orden canónico. */
export function mergeStrengthConstraints(
  ...groups: readonly (readonly StrengthConstraint[])[]
): readonly StrengthConstraint[] {
  const raw = groups.flat().map((constraint) => ({
    key: constraintKey(constraint),
    constraint: constraint.kind === 'region'
      ? { kind: constraint.kind, region: constraint.region }
      : constraint.kind === 'load_pattern'
        ? { kind: constraint.kind, pattern: constraint.pattern }
        : { kind: constraint.kind, reason: constraint.reason },
    sources: constraint.sources,
  }))
  const merged = new Map<ConstraintKey, { constraint: ConstraintPayload; sources: Set<ConstraintSource> }>()
  for (const item of raw) {
    const current = merged.get(item.key)
    if (current) item.sources.forEach((source) => current.sources.add(source))
    else merged.set(item.key, { constraint: item.constraint, sources: new Set(item.sources) })
  }
  return [...merged.entries()].sort(([a], [b]) => keyRank(a) - keyRank(b)).map(([, value]) => ({
    ...value.constraint,
    sources: SOURCE_ORDER.filter((source) => value.sources.has(source)) as unknown as ConstraintSources,
  })) as unknown as readonly StrengthConstraint[]
}
export function hasAnyConstraint(constraints: readonly StrengthConstraint[]): boolean { return constraints.length > 0 }
export function hasUnresolvedMedicalRestriction(constraints: readonly StrengthConstraint[]): boolean {
  return constraints.some((constraint) => constraint.kind === 'unresolved_medical_restriction')
}
/** Única autoridad de interpretación de perfiles `safety` fuera de la biblioteca. */
export function matchedConstraintKeys(definition: ExerciseDefinition, constraints: readonly StrengthConstraint[]): ConstraintKey[] {
  const regions = new Set<BodyRegion>(definition.safety.loadsRegions)
  const patterns = new Set<LoadPattern>(definition.safety.loadPatterns)
  return constraints.filter((constraint) =>
    (constraint.kind === 'region' && regions.has(constraint.region)) ||
    (constraint.kind === 'load_pattern' && patterns.has(constraint.pattern)),
  ).map(constraintKey)
}
export function isExerciseAllowed(definition: ExerciseDefinition, constraints: readonly StrengthConstraint[]): boolean {
  return matchedConstraintKeys(definition, constraints).length === 0
}

const REGION_LABELS: Record<BodyRegion, string> = {
  lumbar: 'zona lumbar', thoracic: 'espalda alta', cervical: 'cuello', trunk_core: 'zona media', chest_ribs: 'costillas',
  pelvis_sacroiliac: 'pelvis', shoulder: 'hombro', elbow: 'codo', wrist: 'muñeca', hip: 'cadera', groin: 'ingle',
  hamstring: 'isquiotibiales', knee: 'rodilla', calf: 'pantorrilla', achilles: 'tendón de Aquiles', ankle: 'tobillo', foot: 'pie',
}
const PATTERN_LABELS: Record<LoadPattern, string> = {
  axial_load: 'carga axial', loaded_hinge: 'bisagra de cadera cargada', impact: 'impacto', deep_flexion: 'flexión profunda', overhead: 'trabajo sobre la cabeza', rotation: 'rotación', grip_demand: 'demanda de agarre',
}
export function describeSafetyConstraints(constraints: readonly StrengthConstraint[]): string | undefined {
  if (!constraints.length) return undefined
  if (hasUnresolvedMedicalRestriction(constraints)) return 'Detecté una restricción, pero no pude identificar la zona'
  const labels = constraints.flatMap((constraint) => constraint.kind === 'region'
    ? [REGION_LABELS[constraint.region]]
    : constraint.kind === 'load_pattern' ? [`evitar ${PATTERN_LABELS[constraint.pattern]}`] : [])
  return labels.length ? `Entendí: ${labels.join(', ')}` : undefined
}
/** Alias explícito para las superficies de UI. */
export const formatStrengthConstraintFeedback = describeSafetyConstraints
