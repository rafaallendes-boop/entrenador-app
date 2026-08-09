# Plan Builder — piso de ruido: control contra control

**Ejecutado:** 2026-08-09
**Pedido por:** la Fase 2 de velocidad, que cerró dejando explícito que faltaba
un control-contra-control «antes de la próxima fase de velocidad».

## Veredicto

**La regla de aceptación de la Fase 2 rechaza un control comparado consigo mismo.**

Se corrieron dos controles idénticos —mismo SHA, mismo manifiesto congelado,
misma variante, misma configuración— y se los comparó con el mismo comando que
evalúa una variante. Resultado: `VEREDICTO: RECHAZADA`, con **5 checks en falla**.

Un control no puede ser peor que sí mismo. Lo que falló no es la corrida: es la
regla. Toda variante evaluada bajo esta barra iba a ser rechazada, incluida una
que no cambiara nada.

## Procedencia

| | |
|---|---|
| SHA | `ce32d48b` |
| Árbol | **`dirty: true`** — ver «Limitación» abajo |
| Modelo | `claude-sonnet-4-6` en ambas |
| `variant_id` | `s46-q2-00ftsagu` en ambas |
| `effort` / `thinking` | `omitted` / `omitted` (config productiva) |
| Manifest | congelado, 6 escenarios × 2 planes / 42 semanas |
| Concurrencia | 3 |
| Costo | C₁ US$0,8880 + C₂ US$0,9058 = **US$1,7938** |

| Corrida | Artefacto | SHA-256 |
|---|---|---|
| C₁ | `control-c1.json` | `a4181339868a9211792e4f3df795630dcfa3f76f86eef6535bf4a716c91fadde` |
| C₂ | `control-c2.json` | `94ed242b73b4a40ba38df62a5b78c3cbf569739bd957ba79b22cfd1bd0842734` |

Ambas dieron 12/12 planes y 42/42 semanas puntuables, cero reintentos, cero
fallbacks y cero fallos de harness. «Control aceptable para calibración» en las
dos.

## El ruido medido

Ratios pareados por caso, C₂ respecto de C₁ (n=12):

| Métrica | mín | máx | rango | p50 | SD |
|---|---|---|---|---|---|
| Primera semana | **−13,5%** | **+13,9%** | 27,5 pts | −0,2% | 8,7% |
| Plan completo | **−12,6%** | **+26,0%** | 38,5 pts | +2,5% | 10,0% |

El ruido solo «mejoró» **7 de 12 casos** y **2 de 6 escenarios**.

## Los cinco checks que fallan sobre ruido puro

```
[FALLA] firstWeekReady.p50:            0.9826 <= 0.8
[FALLA] firstWeekReady.improvedCases:  7 >= 10
[FALLA] firstWeekReady.improvedScenarios: 2 >= 5
[FALLA] score.min:                     -13 >= -5
[FALLA] weekCountRepairsV2.p90:        1 <= 0
[FALLA] weekWarningInput.p90:          1 <= 0
[FALLA] planCountRepairsV2.p90:        2 <= 0
```

Los tres `p90 ≤ 0` de reparaciones son los que la Fase 2 anotó como
«plausiblemente inalcanzable bajo ruido de generación — **no medido**». Quedan
medidos: **son inalcanzables por construcción**, porque el ruido solo ya los
rompe.

## Qué reinterpreta de la Fase 2

El veredicto de la Fase 2 —ninguna variante aceptada, `high` se queda— **sigue
siendo el correcto**. Lo que cambia es que dos de sus razones no eran evidencia:

- **`low` se rechazó por −10,2% (primera semana) y −13,6% (plan completo).** Los
  dos caen dentro de la banda de ruido medida acá. Su «señal consistente entre
  casos y escenarios» es indistinguible de azar.
- **`medium` se rechazó en parte por `score.min = −7`.** Dos controles idénticos
  dieron **−13**: el caso `dobles#2` perdió 13 puntos y bajó de grado `good` a
  `needs_review` sin que cambiara una línea de código.

También la taxonomía de issues es ruidosa: `dobles#1` reportó
`quality.squash.title_mismatch` en una corrida y no en la otra, y
`semana_parcial#1` cambió `quality.squash.low_drill_variety` por
`plan.load.jump` + `quality.load.progression_jump` entre corridas idénticas.

## Dato lateral: el harness no representa producción

`firstWeekReadyMs` p50 = **15,0 s** y `planCompleteMs` p50 = **20,8 s**, contra
la línea base de producción del 2026-07-26 de **24,2 s** y **43,9 s**. El
manifiesto sintético corre casi al doble de velocidad que el caso real, así que
optimizar contra él puede no transferir. Conviene resolverlo antes de invertir
en velocidad.

## Limitación: árbol sucio

Los dos artefactos registran `dirty: true`. Las corridas se lanzaron con el árbol
limpio, pero durante C₁ se editó `src/services/planBuilder/pricing.ts` —que está
en el grafo de dependencias del loadtest vía `asyncGenerationLoop.ts:16`— para un
trabajo paralelo de precios. `readGit()` se llama al inicio, tras cada caso y al
cierre, y acumula el flag con OR, así que la edición quedó registrada en ambas.

Node carga el módulo una sola vez al arrancar el proceso, de modo que **C₁
ejecutó el `pricing.ts` commiteado** y **C₂ el modificado**. Formalmente eso las
hace no elegibles bajo el gate de la Fase 2, y así queda anotado.

**Por qué no cambia la conclusión:** `estimateCostUsd` es aritmética pura que
corre *después* de cada intento para guardar un número; no participa de la
generación, la calidad ni las reparaciones, y la fila de Sonnet quedó idéntica.
Nada en ese cambio puede producir un swing de ±13% en latencia ni −13 puntos de
score. El hallazgo —que el ruido rompe la regla— es más fuerte que el gate que lo
observó.

Aun así, si el registro formal importa, repetir el par sobre un árbol limpio
cuesta ~US$1,80.

## Qué hacer con esto

**No gastar en más corridas de variantes bajo la regla actual.** Cualquier
resultado sería ininterpretable. Antes hay que rediseñar el método, y eso no
cuesta API:

1. **Recalibrar las barras contra el ruido medido.** Pedir que 10 de 12 casos
   mejoren, cuando el ruido solo ya mejora 7, no es una barra exigente: es una
   barra imposible.
2. **Reemplazar los tres `p90 ≤ 0` de reparaciones** por algo que tolere la
   varianza observada.
3. **Hacer el cálculo de potencia.** Con SD de 9-10% por caso y n=12, detectar un
   efecto real del 10% exige más casos pareados o repeticiones del mismo caso.
   Es aritmética, no gasto.
4. **Decidir si el manifiesto sintético sigue siendo el instrumento**, dado que
   corre al doble de velocidad que producción.

## Reproducir

```bash
npm run loadtest:plan-builder -- --compare \
  docs/superpowers/experiments/plan-builder-noise-floor-2026-08-09/control-c1.json \
  docs/superpowers/experiments/plan-builder-noise-floor-2026-08-09/control-c2.json
```

El modo `--compare` es puro: no llama al proveedor ni exige credenciales.
