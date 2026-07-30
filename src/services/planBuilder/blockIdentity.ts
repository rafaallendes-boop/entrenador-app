/**
 * Identidad e índice de bloque, única fuente para el review de calidad y para
 * las normalizaciones de reparación. Si las dos capas divergen, la rotación se
 * reinicia en un punto distinto del que el check compara y el bug es silencioso.
 *
 * Replica exactamente las tres ramas de `getPlanPhaseForWeek` en qualityReview,
 * y corrige la única discrepancia real: en planes legacy el índice deja de ser
 * 0 para todas las semanas y pasa a ser la posición ordinal dentro del grupo.
 */

export interface PlanWeekDescriptor {
  weekIndex: number
  phase: string
}

export interface PlanPhaseDescriptor {
  phase: string
  startWeekIndex: number
  endWeekIndex: number
}

export interface BlockPosition {
  blockId: string
  indexInBlock: number
}

export function resolveBlockPositions(
  phases: readonly PlanPhaseDescriptor[],
  weeks: readonly PlanWeekDescriptor[],
): Map<number, BlockPosition> {
  const positions = new Map<number, BlockPosition>()
  // Orden explícito: el ordinal legacy no puede depender del orden de entrada.
  const ordered = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)

  if (phases.length === 0) {
    const seenPerBlock = new Map<string, number>()
    for (const week of ordered) {
      const blockId = `${week.phase}:legacy`
      const indexInBlock = seenPerBlock.get(blockId) ?? 0
      seenPerBlock.set(blockId, indexInBlock + 1)
      positions.set(week.weekIndex, { blockId, indexInBlock })
    }
    return positions
  }

  for (const week of ordered) {
    const containing = phases.find(
      (phase) => week.weekIndex >= phase.startWeekIndex && week.weekIndex <= phase.endWeekIndex,
    )

    if (!containing) {
      // Grupo unitario: sin semana anterior, el check no puede disparar y la
      // rotación no debe aplicarse. Índice 0 es la respuesta correcta.
      positions.set(week.weekIndex, {
        blockId: `${week.phase}:${week.weekIndex}:${week.weekIndex}`,
        indexInBlock: 0,
      })
      continue
    }

    positions.set(week.weekIndex, {
      blockId: `${containing.phase}:${containing.startWeekIndex}:${containing.endWeekIndex}`,
      indexInBlock: week.weekIndex - containing.startWeekIndex,
    })
  }

  return positions
}
