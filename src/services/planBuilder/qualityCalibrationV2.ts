/**
 * Calibración CONGELADA de la penalización de reparación de
 * `quality_version = 2`, elegida por el owner sobre el control medido
 * (spec §3.8, §5.3).
 *
 * Los topes quedan deliberadamente por encima del máximo observado en el
 * control (semana 6, plan 4): un tope igual al máximo saturaría justo donde
 * empieza la degradación que esta fase existe para detectar.
 *
 * Nunca recalibrar por variante. Comparar contra otra variante exige repetir
 * el mismo manifest y contrastar contra estos valores; derivar valores nuevos
 * normalizaría una degradación real.
 */

export interface QualityV2Calibration {
  weekRepairDivisor: number
  weekRepairPenaltyCap: number
  planRepairDivisor: number
  planRepairPenaltyCap: number
  /** Sobre correctiveActionCount + structuralActionCount, no countRepairsV2. */
  highRepairWarningThreshold: number
}

export const QUALITY_V2_CALIBRATION: QualityV2Calibration = {
  weekRepairDivisor: 1,
  weekRepairPenaltyCap: 10,
  planRepairDivisor: 4,
  planRepairPenaltyCap: 8,
  highRepairWarningThreshold: 5,
}

export interface QualityV2ControlRecord {
  calibratedQualityVersion: 2
  /** Lleva q1 porque el control se generó antes del flip productivo. */
  controlGenerationVariantId: string
  /** Todas las dimensiones de request salvo qualityVersion, incluido provider. */
  controlRequestFingerprint: string
  artifactPath: string
  artifactSha256: string
  artifactSchemaVersion: number
  completePlans: number
  scorableWeeks: number
  gitSha: string
  gitDirty: false
  calibratedAt: string
}

export const QUALITY_V2_CONTROL: QualityV2ControlRecord = {
  calibratedQualityVersion: 2,
  controlGenerationVariantId: 's46-q1-01bxcrr9',
  controlRequestFingerprint: '0111cbik',
  artifactPath: 'docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json',
  artifactSha256: '6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a',
  artifactSchemaVersion: 1,
  completePlans: 12,
  scorableWeeks: 42,
  gitSha: '7da37f94d656448810be0bb8cad240195814a372',
  gitDirty: false,
  calibratedAt: '2026-07-25',
}
