import type { StrengthProfile } from '../../../../../types'
import {
  hasAnyStrengthReference,
  listAvailableStrengthReferences,
} from '../../../../training/strengthLoadPrescription'

export interface StrengthLoadPackInput {
  strengthProfile?: StrengthProfile
}

/**
 * Prompt section that teaches the model how to prescribe loads and warm-up sets
 * for strength exercises. Renders only when at least one 1RM is available; if
 * the profile is empty, returns the RPE-only fallback so the model knows not to
 * invent weights.
 */
export function buildStrengthLoadPack(input: StrengthLoadPackInput): string {
  const profile = input.strengthProfile
  if (!hasAnyStrengthReference(profile)) {
    return buildNoReferenceFallback()
  }

  const refs = listAvailableStrengthReferences(profile).join(' · ')

  return `PRESCRIPCIÓN DE CARGA EN FUERZA
1RMs disponibles del atleta: ${refs}.

Para cada ejercicio principal (lift compound, accesorio pesado) entrega SIEMPRE:
· weight: kilos sugeridos para el set efectivo, redondeados a múltiplos de 2.5kg.
· targetPercent1RM: porcentaje aproximado del 1RM del propio ejercicio (1-100).
· warmupSets: 1-3 series de aproximación con cargas crecientes ANTES del set efectivo.

Cómo calcular weight desde el 1RM:
· Lifts exactos (sentadilla, peso muerto, press banca, press hombro) → weight = 1RM × (targetPercent1RM/100).
· Lifts derivados → estima primero el 1RM del derivado usando estas equivalencias y luego aplica el porcentaje:
  - press inclinado ≈ 85% press banca
  - press declinado / agarre cerrado ≈ 90% press banca
  - dips ≈ 70% press banca (con peso añadido = dip 1RM × % menos peso corporal)
  - push press ≈ 115% press hombro
  - front squat ≈ 85% sentadilla
  - búlgaras / split squat ≈ 35% sentadilla (unilateral, por pierna)
  - lunge / zancada ≈ 40% sentadilla (por pierna)
  - hip thrust ≈ 120% sentadilla
  - peso muerto rumano ≈ 80% peso muerto
  - peso muerto sumo / trap bar ≈ 95% peso muerto
  - remo con barra ≈ 75% press banca
  - remo pendlay ≈ 70% press banca
· Las equivalencias son aproximaciones; ajusta hacia abajo si el atleta es intermedio o si la sesión es de fatiga alta.

Escalera de aproximación recomendada (warmupSets[]):
· Target ≥ 85% 1RM: 3 series → 50%×5, 70%×3, 85%×2.
· Target 75-84% 1RM: 2 series → 50%×8, 70%×5.
· Target 60-74% 1RM: 1 serie → 50%×8.
· Target < 60% 1RM: omite warmupSets, no son necesarios.
· Cada warmupSet incluye reps, weight (kg redondeado a 2.5) y percent1RM.

Reglas de oro:
· No prescribas weight sin targetPercent1RM (la app los muestra juntos).
· Si el ejercicio no aparece en la tabla y no es similar a uno listado, omite weight/targetPercent1RM y usa targetRpe (1-10) en su lugar.
· En sesiones de potencia/olímpicos: usa targetPercent1RM bajo (60-75%) priorizando velocidad, no peso máximo.
· En semana de competencia / taper / fatiga ≥7: baja 5-10% el targetPercent1RM respecto a lo habitual.
· Para accesorios livianos (core, movilidad, activación con bandas): omite weight y targetPercent1RM, usa solo sets×reps.`
}

function buildNoReferenceFallback(): string {
  return `PRESCRIPCIÓN DE CARGA EN FUERZA
El atleta no tiene 1RMs cargados en su perfil. NO inventes pesos.

Para cada ejercicio principal entrega:
· sets, reps como siempre.
· targetRpe (1-10): nivel de esfuerzo objetivo. Compound pesado → RPE 7-8; accesorio → RPE 6-8; potencia/explosivo → RPE 6-7 priorizando velocidad.
· notes: breve cue técnico ("Control y amplitud en el descenso", "Salir explosivo", etc).
· Omite weight, targetPercent1RM y warmupSets en TODOS los ejercicios.

Esto permite que el atleta autorregule por sensación mientras carga sus 1RM. Sugiere implícitamente que complete su perfil para recibir cargas concretas.`
}
