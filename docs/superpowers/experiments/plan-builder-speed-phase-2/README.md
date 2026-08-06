# Plan Builder — Fase 2 de velocidad: campaña `effort`

**Ejecutada:** 2026-07-27
**Spec:** `docs/superpowers/specs/2026-07-26-plan-builder-speed-phase-2-design.md`
**Plan:** el plan retirado (historial en git)

## Veredicto

**Ninguna variante fue aceptada. `high` se queda como configuración productiva.**

Ese es el resultado de la fase, no un fracaso de la fase: la regla estaba
congelada antes de gastar y se aplicó mecánicamente. El instrumento funcionó —
las tres corridas fueron elegibles, pareadas al 100% y sin fallbacks ni fallos
de harness.

Como la configuración productiva no cambia, **no hay nada que desplegar**.
`PLAN_BUILDER_EFFORT` y `PLAN_BUILDER_THINKING` quedan sin definir en producción,
que es el estado "omitido" con el que ya venía corriendo.

## Procedencia

| | |
|---|---|
| SHA de la campaña | `f349ae4d4330a51a6d20a0cf5bdabd4614cb3130` |
| Árbol | limpio (`dirty: false`) en las tres corridas |
| Modelo | `claude-sonnet-4-6` en las tres |
| `quality_version` | 2 en las tres |
| Manifest | congelado, 6 escenarios × 2 planes / 42 semanas |
| Concurrencia | 3 |
| Costo total | **US$2,5941** |

| Corrida | `effort` | `thinking` | `variant_id` | SHA-256 del artefacto |
|---|---|---|---|---|
| C (control) | `high` | `disabled` | `s46-q2-00qwoc9q` | `3bf5f9b39ecebffc9e69e28ed01a8a788ed9fe03a8b78389cdc99913b60d8f26` |
| A | `medium` | `disabled` | `s46-q2-00vgxagr` | `a181e84f1e9df58c9c867ee7a7f2530414a86ecf59ba13a8ce5ecc51b0626e9c` |
| B | `low` | `disabled` | `s46-q2-00793b6k` | `07ed8b5ee97206476facd4665e059779edfe1e53addb3f0acd4e9e6c6fbcb8eb` |

Las tres pasaron `--phase2-check` con `RESULTADO: ELEGIBLE`: 12/12 planes,
42/42 semanas puntuables, q2, manifest congelado, SHA limpio, modelo observado
único, directivas correctas, cero fallbacks y cero fallos de harness.

## Resumen por corrida

| | C (`high`) | A (`medium`) | B (`low`) |
|---|---|---|---|
| Primera semana p50 | 14 399 ms | 14 830 ms | **13 062 ms** |
| Primera semana p95 | 21 809 ms | 19 876 ms | **19 219 ms** |
| Plan completo p50 | 23 458 ms | 23 095 ms | **20 300 ms** |
| Costo | US$0,8975 | US$0,8750 | **US$0,8216** |
| Tokens de salida | 41 374 | 39 867 | **36 303** |
| Grados | 2 exc / 4 good / 6 nr / 0 poor | 2 / 5 / 4 / **1 poor** | 2 / 4 / 5 / **1 poor** |

Los p50 marginales de arriba son descriptivos. **La decisión se toma sobre las
métricas pareadas**, no sobre estos agregados: la diferencia de medianas no es
la mediana de las diferencias.

## Veredicto por variante, check por check

### A (`medium`) — RECHAZADA

Falla 6 checks:

| Check | Obtenido | Requerido |
|---|---|---|
| `firstWeekReady.p50` | 0,9507 | ≤ 0,80 |
| `firstWeekReady.improvedCases` | 7 | ≥ 10 |
| `firstWeekReady.improvedScenarios` | 4 | ≥ 5 |
| `score.min` | **−7** | ≥ −5 |
| `weekCountRepairsV2.p90` | 2 | ≤ 0 |
| `weekWarningInput.p90` | 2 | ≤ 0 |
| `planCountRepairsV2.p90` | 5 | ≤ 0 |

A no es un candidato ajustado: mejora la primera semana un 5% mediano, gana en
solo 7 de 12 casos —indistinguible de una moneda— y **degrada calidad de forma
visible**. `dobles#2` cae de `needs_review` a `poor` (67 → 60), que es el
`score.min = −7`. Es la peor combinación posible: casi nada de velocidad a
cambio de un plan que empeora de grado.

### B (`low`) — RECHAZADA

Falla 4 checks:

| Check | Obtenido | Requerido |
|---|---|---|
| `firstWeekReady.p50` | 0,8977 | ≤ 0,80 |
| `firstWeekReady.improvedCases` | 9 | ≥ 10 |
| `weekCountRepairsV2.p90` | 3 | ≤ 0 |
| `weekWarningInput.p90` | 2 | ≤ 0 |
| `planCountRepairsV2.p90` | 4 | ≤ 0 |

B muestra una **señal de velocidad consistente entre casos y escenarios**, y
conviene dejarlo escrito con precisión porque es lo que orienta la fase
siguiente. "Consistente" no es "real": sin piso de ruido medido, ninguna de las
cifras de abajo puede afirmarse por encima del ruido.

- Primera semana: **−10,2% mediano pareado**, mejorando en 9/12 casos y en
  **5/6 escenarios** (pasa `improvedScenarios`).
- Plan completo: **−13,6% mediano pareado**.
- Costo: **−8,5%** (US$0,076 sobre la corrida).
- Tokens de salida: **−12,3%** (−5 071).

La caída de tokens de salida es un **mecanismo plausible** para la caída de
latencia: menos tokens generados es menos tiempo de generación. Que exista un
mecanismo hace la señal de B más interpretable que la de A, pero no la
convierte en un efecto medido: para eso falta el piso de ruido.

En calidad, B es aproximadamente neutro en score: `score.p50 = 0` y
`score.min = −4`, **dentro** de la tolerancia de −5. Lo que lo rechaza es la
magnitud (necesitaba 20% y dio 10%) y los tres checks de reparaciones.

## Advertencia sobre los checks de reparaciones

Los tres checks `*.p90 ≤ 0` fallaron en **ambas** variantes. Hay motivo para
sospechar que **fallarían también comparando C contra una repetición de C**,
pero es una sospecha derivada de la aritmética del umbral, no una observación:
esa corrida no existe.

Distribución del delta pareado de `countRepairsV2` por semana (n=42):

| | mejora | empata | empeora | suma |
|---|---|---|---|---|
| A vs C | 6 | 21 | 15 | +13 |
| B vs C | 13 | 13 | 16 | +8 |

La de B es prácticamente simétrica: 13 semanas mejores contra 16 peores. Eso es
**compatible con ruido**, y también sería compatible con una degradación muy
pequeña; sin piso de ruido medido las dos lecturas siguen abiertas y no
corresponde elegir una.

Lo que sí es aritmética y no interpretación: `p90 ≤ 0` sobre nearest-rank con
n=42 exige que **38 de 42 semanas** no empeoren ni en una reparación. Con
generación estocástica (`temperature 0,25`) es **plausible** que ninguna
configuración despeje esa barra, ni siquiera `high` contra sí misma —
**pero eso no se midió.**

**Esto es una observación sobre el diseño de la medición, no un intento de
rescatar a B.** El veredicto mecánico se mantiene: B está rechazada, y además
falla el criterio primario de magnitud por un margen que ningún ajuste de la
regla de reparaciones cambiaría.

La consecuencia para la fase siguiente es concreta: **la campaña nunca corrió un
C₂ contra C₁**, así que no existe estimación del piso de ruido. Sin ese
control-contra-control, cualquier umbral de "no empeorar" sobre una métrica
por semana es una barra fijada a ciegas.

## Qué queda establecido

1. **`high` se queda.** No hay cambio productivo, no hay deploy.
2. `medium` está descartado con evidencia: poca velocidad y degradación de grado.
3. `low` compra ~10% de primera semana y ~8,5% de costo a cambio de calidad
   aproximadamente neutra en score. **No alcanza** la barra congelada del 20%,
   y es la única palanca de esta fase cuya señal fue consistente entre casos y
   escenarios. Consistente, no demostrada: falta el piso de ruido.
4. El instrumento (`--compare` / `--phase2-check`) hizo exactamente su trabajo:
   pareó 12/12 y 42/42 sin huecos ni duplicados, y rechazó mecánicamente.
5. Una campaña completa de 3 corridas cuesta **US$2,59** y toma ~30 min. Medir
   una variante sigue siendo barato frente a quemar el rate limit del owner.

## Salvedad estadística

Sin repetición de C, la consistencia entre casos y escenarios (9/12 y 5/6 para
B) es **evidencia descriptiva** y **no** una afirmación de que el efecto supere
el ruido. Con n=12 planes, `p95` y `p99` son en la práctica el máximo observado.

## Salidas completas

Los dos `--compare` íntegros —incluido el detalle por `caseId`— se reproducen
en cualquier momento sin costo ni credenciales:

```bash
npm run loadtest:plan-builder -- --compare \
  docs/superpowers/experiments/plan-builder-speed-phase-2/phase2-C.json \
  docs/superpowers/experiments/plan-builder-speed-phase-2/phase2-A.json

npm run loadtest:plan-builder -- --compare \
  docs/superpowers/experiments/plan-builder-speed-phase-2/phase2-C.json \
  docs/superpowers/experiments/plan-builder-speed-phase-2/phase2-B.json
```
