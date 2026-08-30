/** Zonas anatómicas que una restricción de fuerza puede nombrar. */
export type BodyRegion =
  | 'lumbar' | 'thoracic' | 'cervical' | 'trunk_core' | 'chest_ribs'
  | 'pelvis_sacroiliac' | 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'groin'
  | 'hamstring' | 'knee' | 'calf' | 'achilles' | 'ankle' | 'foot'

/** Patrones mecánicos que no son una zona anatómica. */
export type LoadPattern =
  | 'axial_load' | 'loaded_hinge' | 'impact' | 'deep_flexion'
  | 'overhead' | 'rotation' | 'grip_demand'

/** Ningún ejercicio físico es universalmente seguro. */
export type NonEmptyRegions = readonly [BodyRegion, ...BodyRegion[]]

export interface ExerciseSafetyProfile {
  /** Regiones que el ejercicio desafía; nunca una lista de regiones seguras. */
  loadsRegions: NonEmptyRegions
  loadPatterns: readonly LoadPattern[]
}

export type ConstraintSource =
  | 'current_injuries' | 'restrictions' | 'injury_notes'
  | 'user_message' | 'training_priority'

export type ConstraintSources = readonly [ConstraintSource, ...ConstraintSource[]]

export type UnresolvedConstraintReason =
  | 'medical_marker_without_supported_constraint'
  | 'structured_priority_without_detail'

export type ConstraintKey =
  | `region:${BodyRegion}`
  | `pattern:${LoadPattern}`
  | `unresolved:${UnresolvedConstraintReason}`

export type StrengthConstraint =
  | { kind: 'region'; region: BodyRegion; sources: ConstraintSources }
  | { kind: 'load_pattern'; pattern: LoadPattern; sources: ConstraintSources }
  | { kind: 'unresolved_medical_restriction'; reason: UnresolvedConstraintReason; sources: ConstraintSources }
