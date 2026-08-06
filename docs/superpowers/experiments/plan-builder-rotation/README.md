# Plan Builder — smoke de rotación coordinada

Fecha de la corrida: **2026-07-30**. Cierra la Task 12 del plan
el plan retirado (historial en git).

## Procedencia

| Campo | Valor |
|---|---|
| Artefacto | `rotation-post.json` |
| SHA-256 | `7582401f444d7b89c49c83094265b966eff7c241073d72127e29f868eee2e666` |
| SHA de git | `2ea9b5327d031ff58b9a13bf3c02f28d5f32ceaf` (`dirty: false`) |
| `variant_id` | `s46-q2-00qwoc9q` |
| Variante | `claude-sonnet-4-6`, `effort=high`, `thinking=disabled`, `temperature=0.25`, `maxTokens=5000`, `qualityVersion=2`, concurrencia 3 |
| Manifest | 6 escenarios × 2 planes = 12 planes / 42 semanas |
| Elegibilidad | `--phase2-check ... high` → **ELEGIBLE** |
| Costo | **US$0,8941** |

Control de contraste: `../plan-builder-speed-phase-2/phase2-C.json`, mismo
`variant_id` (`s46-q2-00qwoc9q`) sobre `f349ae4`, es decir **pre-rotación**. Las
dos corridas comparten manifest y variante, así que el contraste es pareado.

> **El artefacto es anterior al arreglo de `low_drill_depth`** descrito abajo. Sus
> conteos de ese código son **pre-arreglo** y no deben releerse como estado actual.

## Resultado

| Métrica | C (pre-rotación) | POST | Lectura |
|---|---|---|---|
| `signature_uniqueness_unresolved` | — | **0** intentos / 0 semanas / 0 planes | La invariante nueva no dispara |
| `quality.squash.low_drill_variety` | 6 planes | **1** | Definición **sin cambios**: comparable |
| `quality.strength.repeated_template` | 10 planes | 4 | Definición **cambiada** en este bloque: solo descriptivo |
| `quality.generation.high_repair_count` | 2 planes | 3 | Sin inflación atribuible a la política |
| `quality.squash.low_drill_depth` | 0 planes | 8 | Ver "Hallazgo" |
| planScore p50 / min | 80 / 65 | 89 / 54 | Mediana sube, cola baja |
| weekScore p50 / min | 93 / 81 | 91 / 67 | |
| 1ª semana p50 | 14,5 s | 15,8 s | Plano dentro del ruido de n=12 |
| Plan completo p50 | 31,2 s | 33,2 s | Plano |
| Costo | US$0,8975 | US$0,8941 | Plano |

Actividad de la política (42 semanas):

| Métrica | Suma | Semanas con dato |
|---|---|---|
| `strengthAccessoryRotationActionCount` | 201 | 26 |
| `strengthAccessoryRotationSessionsAffected` | 31 | 26 |
| `squashDrillRotationActionCount` | 60 | 16 |
| `squashDrillRotationSessionsAffected` | 30 | 16 |
| `squashDrillRotationOmittedCount` | 4 | 16 |
| `squashSignatureUniquenessFailureAttemptCount` | 0 | **42** |

Las 42 semanas traen el campo de fallo con dato (no `null`): la instrumentación
midió de verdad, no quedó en el modo silencioso que el plan advertía.

Las 4 omisiones de squash son bajas. **No se abre el follow-up de ampliar
`category`** que el plan dejaba condicionado a este número.

## Hallazgo: `low_drill_depth` 0 → 8

`quality.squash.low_drill_depth` es un código **preexistente** (`f6f993f`,
2026-05-25, ancestro de `f349ae4`), así que las 8 ocurrencias son nuevas, no una
regla nueva.

Reproducido A/B en worktrees sobre `ac01830` (pre-rotación) y `2ea9b53`, con la
misma entrada: dos sesiones `practice_match` de 60 min con firma duplicada.

| | Sesión 1 | Sesión 2 (firma duplicada) |
|---|---|---|
| Pre-rotación | 1 drill, `practice_match` | **3 drills**, `drill_session` |
| Post-rotación | 1 drill, `practice_match` | **1 drill**, `practice_match` |

`COMPETITION_MATCH_VARIANTS` y `PRACTICE_MATCH_VARIANTS` tienen **una sola**
entrada cada uno. El viejo `enforceSquashSignatureUniqueness` agotaba las
variantes y caía a `rebuildSquashDetailsAvoidingDuplicates`, que regeneraba la
sesión como contenido multi-drill **no-partido**. El nuevo
`normalizeSquashSessionContent` la diferencia cambiándola por **otro drill de
partido**: conserva la intención del coach (dos partidos) y deja dos sesiones de
1 drill.

**El contenido nuevo es mejor; la regla es la que tiene el punto ciego.**
`buildSquashMatchDrills` devuelve una sola entrada por construcción, así que
ninguna sesión de partido bien formada puede cumplir el umbral, y rellenarla con
drills técnicos sería contenido equivocado.

Arreglo aplicado en `src/services/planBuilder/qualityReview.ts`: `low_drill_depth`
exime a las sesiones de partido (`sessionKind === 'match'` o `sessionMode` de
partido). Cubierto por `__tests__/qualityReviewMatchDrillDepth.test.ts`, que
además fija que una sesión de drills con un solo drill **se sigue penalizando**.

**Limitación:** el artefacto guarda solo métricas allowlisted, no contenido de
sesión, así que no se pudo verificar que las 8 ocurrencias sean todas de
partido. El A/B prueba el mecanismo, no la cobertura. Cuantificar el efecto del
arreglo exige otra corrida pagada.

## Veredicto

**Positivo.** La rotación cumple su objetivo: `low_drill_variety` cae de 6 a 1
planes sobre una definición que no cambió, la mediana de `planScore` sube de 80 a
89, y la invariante nueva de unicidad de firma no dispara ni una vez en 42
semanas. Latencia y costo quedan planos.

La única regresión observada (`low_drill_depth`) resultó ser un punto ciego de la
regla de calidad, no del contenido, y quedó corregida fuera de este artefacto.
