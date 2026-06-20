# Calidad del generador (Plan Builder + Week Creator)

**Estado:** Diseño aprobado, pendiente de implementación incremental.
**Fecha:** 2026-06-19
**Autor:** Rafael Allendes (colaboración con Claude)
**Stakeholder:** beta privada + venta. Es el "producto estrella".

---

## Contexto y motivación

El generador ya produce planes completos, async y rápidos (plan real del 2026-06-19: 6 semanas, `strategy: single`, `~134 s`, background OK). Pero la **calidad deportiva** todavía no convence. El `qualityReview` del plan real dio **score 73 ("Revisar")** con 10 warnings y 40 reparaciones, y los problemas son consistentes con lo que se ve al inspeccionar las sesiones:

- **Monotonía de match-play:** la sesión "Squash - Match Play Competitivo" aparece **idéntica 5 veces** (mismo par de drills, 25+25 min). Detectado como `quality.squash.low_drill_variety` ("12 drills únicos sobre 32 usos").
- **Periodización mal etiquetada:** 6 semanas con "peak" de **4 semanas** (wk0–3). Peak real son 1–2 semanas. Además `macroSnapshot.timeline` viene con `startWeek/endWeek` invertidos/inconsistentes (peak `startWeek:5 endWeek:5`, taper `startWeek:4 endWeek:1`).
- **Deporte principal subponderado:** `week.primary_sport.underweighted` en semanas 2, 3 y 4 — el accesorio le come protagonismo al squash en pleno peak.
- **Salto de carga falso:** `plan.load.jump 186%` entre semanas 1 y 2, artefacto de la semana 1 parcial (arranca el 19/06 casi sin días).
- **Fuerza repetida:** semanas 3 y 4 comparten 3 ejercicios (`quality.strength.repeated_template`).

**Filosofía clave:** hoy `qualityReview` *detecta* estos problemas pero el generador igual los produce y el usuario igual los recibe. El objetivo es que el generador/reparador los **prevenga**, no solo los marque.

**Objetivo:** que un plan de 8–12 semanas de squash competitivo salga con score ≥85 sin intervención, sin sesiones clonadas, con periodización legible y squash dominante en las fases que corresponde.

**No-objetivos:**

- Cambios de frontend (es el Spec 1, `2026-06-19-frontend-detechification-design.md`).
- Migrar de provider.
- Tocar `promptBuilder.ts` por estética (regla del proyecto).

---

## Mejoras priorizadas

Ordenadas por impacto/esfuerzo. Cada una es implementable de forma independiente e incremental.

### P1 — Anti-monotonía de squash (alto impacto)

**Problema:** sesiones de match-play clonadas; baja variedad de drills en el bloque.

**Diseño:**
- En el selector/reparador de squash (`repairWeek.ts` `buildSquashMatchDrills`, `WeekCreatorEngine` fallbacks, y el prompt en `src/services/week/prompts/`), **rotar formato de match** entre las opciones reales del catálogo: `Game a 11 con marcador real`, `Partido de entrenamiento al mejor de 3 juegos`, `Partido con ataque temprano`, `Partido de entrenamiento al mejor de 5 juegos` — sin repetir el mismo par en sesiones consecutivas.
- Mezclar dentro de las sesiones competitivas al menos un bloque no-match (presión/ghosting/técnico) en vez de 25+25 de puro partido.
- Convertir la heurística de `quality.squash.low_drill_variety` (`qualityReview.ts:532`) en una **restricción activa** del reparador: si la variedad cae bajo umbral, el reparador sustituye drills repetidos por alternativas del mismo `focus`/fase antes de devolver la semana.

**Criterio de éxito:** ≥6 drills de squash distintos en un plan de 6 semanas; ningún par de match clonado en sesiones consecutivas; `low_drill_variety` ausente o auto-reparado.

### P2 — Periodización real y `macroSnapshot` correcto

**Problema:** "peak" de 4 semanas; timeline con índices invertidos.

**Diseño:**
- En `macroPlan.ts` / `buildPlanShell.ts`, derivar fases por semanas-al-evento: bloque largo de **build/específico**, **peak** acotado a 1–2 semanas finales pre-taper, **taper** corto, **race**. Para un plan de 6 semanas: ~build wk0–2, peak wk3–4, taper, race.
- Auditar y corregir el cálculo de `macroSnapshot.timeline` (`startWeek`, `endWeek`, `weeksFromReference`) — hoy salen invertidos. Test que verifique monotonía creciente de `startWeek` y coherencia con `phases[]`.

**Criterio de éxito:** ninguna fase "peak" dura >2 semanas en planes ≤8 semanas; `timeline` consistente con `phases`; test de coherencia macro verde.

### P3 — Ponderación del deporte principal

**Problema:** `week.primary_sport.underweighted` en peak.

**Diseño:**
- Reforzar en el shell/selector que el deporte primario domine el reparto semanal en build/peak (más sesiones y/o más minutos que el conjunto accesorio).
- Bajar más agresivo el volumen de soporte (running/fuerza/movilidad) cuando squash es primario y está en peak, alineado con `volumeBias: reduce` que ya trae el `macroSnapshot`.
- Convertir `primary_sport.underweighted` en restricción del reparador, no solo warning.

**Criterio de éxito:** `primary_sport.underweighted` ausente en build/peak de un plan squash-primario.

### P4 — Carga de semana parcial

**Problema:** `plan.load.jump 186%` por semana 1 incompleta.

**Diseño:**
- El prorrateo de semanas parciales ya existe en `qualityReview.ts` pero no neutraliza el salto cuando la semana 1 arranca a mitad. Revisar: o se prorratea la carga base de la semana parcial antes de comparar saltos, o se excluye la semana parcial del cálculo de `load.jump` (comparar solo semanas completas).

**Criterio de éxito:** ningún `plan.load.jump` espurio originado por la primera/última semana parcial.

### P5 — Rotación de templates de fuerza

**Problema:** semanas 3–4 comparten 3 ejercicios (`quality.strength.repeated_template`).

**Diseño:**
- En la selección de bloques de fuerza (`strengthBlocks/`, `selectStrengthSession`), forzar rotación entre semanas consecutivas del mismo bloque para que no compartan ≥3 ejercicios.
- Considerar (criterio deportivo, masters 34): preferir patrones con menos riesgo técnico/residuo en peak frente a olímpicos pesados, salvo que el perfil indique competencia técnica clara en levantamientos.
- Convertir `repeated_template` en restricción del reparador.

**Criterio de éxito:** 0 semanas consecutivas con ≥3 ejercicios de fuerza compartidos dentro del mismo bloque.

---

## Estrategia transversal: detección → prevención

El patrón común de P1, P3 y P5 es el mismo: hoy `qualityReview` *detecta* (`low_drill_variety`, `primary_sport.underweighted`, `repeated_template`) pero `repairWeek` no las *resuelve*. La estrategia es **cerrar el loop**: cada regla de calidad que hoy emite warning debe tener una ruta de reparación que la intente resolver automáticamente antes de marcarla. Si el reparador no puede, ahí sí queda el warning (visible solo en dev, por Spec 1).

## Testing

- Tests por mejora (todos en `src/services/planBuilder/__tests__/` o `src/services/__tests__/`):
  - P1: plan generado no repite par de match en sesiones consecutivas; variedad ≥ umbral.
  - P2: fases derivadas correctas por semanas-al-evento; `timeline` coherente.
  - P3: squash domina build/peak; sin `primary_sport.underweighted`.
  - P4: semana parcial no genera `load.jump`.
  - P5: sin `repeated_template` entre semanas consecutivas.
- Regresión: la suite actual (830 tests) sigue verde.
- Validación deportiva manual: regenerar el plan del Nacional y confirmar score ≥85 y los criterios anteriores.

## Riesgos

- **Sobre-restringir el reparador** podría aumentar fallback. Mitigación: el reparador sustituye dentro del mismo `focus`/fase; si no encuentra alternativa válida, deja el warning en vez de romper la semana.
- **Tocar `macroPlan`/`buildPlanShell`** afecta a todos los planes. Mitigación: tests de coherencia macro existentes (`macroWeekCoherence.test.ts`) + nuevos.

## Orden de implementación sugerido

P1 (mayor impacto percibido) → P2 (legibilidad/periodización) → P3 → P5 → P4. Cada una como cambio aislado con sus tests antes de pasar a la siguiente.
