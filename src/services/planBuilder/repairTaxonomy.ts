/**
 * Taxonomía de reparación para `quality_version = 2`.
 *
 * `repairWeek.ts` histórico usa un único `repairedSessionCount` que mezcla
 * hidratación determinística del contrato esqueleto (esperada por diseño) con
 * corrección real de salida del modelo. Ese contador penaliza el score vía
 * `countRepairs()`, así que la arquitectura esqueleto+hidratación se castiga a
 * sí misma.
 *
 * Este módulo NO reemplaza al contador legacy: lo acompaña. El legacy conserva
 * su semántica exacta porque Week Creator ramifica sobre él
 * (`WeekCreatorEngine.ts:826`).
 *
 * Unidad: **acciones atómicas**. Una misma sesión puede recibir varias
 * acciones. Los conteos de sesiones únicas se exponen aparte y no puntúan.
 */

export type RepairActionCategory = 'hydration' | 'corrective' | 'structural'

export interface RepairTaxonomyMeta {
  hydrationActionCount: number
  correctiveActionCount: number
  structuralActionCount: number
  hydratedSessions: Set<string>
  correctedSessions: Set<string>
  structurallyRepairedSessions: Set<string>
}

export interface RepairTaxonomySummary {
  hydrationActionCount: number
  correctiveActionCount: number
  structuralActionCount: number
  hydratedSessionsAffected: number
  correctedSessionsAffected: number
  structurallyRepairedSessionsAffected: number
}

export function createRepairTaxonomyMeta(): RepairTaxonomyMeta {
  return {
    hydrationActionCount: 0,
    correctiveActionCount: 0,
    structuralActionCount: 0,
    hydratedSessions: new Set<string>(),
    correctedSessions: new Set<string>(),
    structurallyRepairedSessions: new Set<string>(),
  }
}

export function recordRepairAction(
  taxonomy: RepairTaxonomyMeta,
  category: RepairActionCategory,
  sessionKey?: string,
): void {
  switch (category) {
    case 'hydration':
      taxonomy.hydrationActionCount++
      if (sessionKey) taxonomy.hydratedSessions.add(sessionKey)
      break
    case 'corrective':
      taxonomy.correctiveActionCount++
      if (sessionKey) taxonomy.correctedSessions.add(sessionKey)
      break
    case 'structural':
      taxonomy.structuralActionCount++
      if (sessionKey) taxonomy.structurallyRepairedSessions.add(sessionKey)
      break
  }
}

export function summarizeTaxonomy(taxonomy: RepairTaxonomyMeta): RepairTaxonomySummary {
  return {
    hydrationActionCount: taxonomy.hydrationActionCount,
    correctiveActionCount: taxonomy.correctiveActionCount,
    structuralActionCount: taxonomy.structuralActionCount,
    hydratedSessionsAffected: taxonomy.hydratedSessions.size,
    correctedSessionsAffected: taxonomy.correctedSessions.size,
    structurallyRepairedSessionsAffected: taxonomy.structurallyRepairedSessions.size,
  }
}
