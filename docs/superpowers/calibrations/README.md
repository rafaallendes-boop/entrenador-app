# Controles de calibración del Plan Builder

Artefactos de loadtest **aceptados** que respaldan una constante de calibración.
Los resultados crudos viven en `loadtest-results/`, que está gitignoreado; acá se
versiona la copia que una constante puede citar por ruta y SHA-256 desde
cualquier checkout.

Un archivo entra acá solo si su corrida fue aceptada por `evaluateAcceptance` y
el árbol estaba limpio (`git.dirty: false`). La copia es byte a byte idéntica al
artefacto original: el SHA que cita la constante es el mismo que produjo el
driver.

## `plan-builder-v2-control-2026-07-25.json`

| | |
|---|---|
| SHA-256 | `6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a` |
| Git SHA de la corrida | `7da37f94d656448810be0bb8cad240195814a372` (limpio) |
| Variante | `s46-q1-01bxcrr9` — claude-sonnet-4-6, effort omitted, temp 0.25, maxTokens 5000, quality v1, concurrency 3 |
| Muestra | 12/12 planes completos, 42/42 semanas objetivo, 42 semanas puntuables |
| Costo estimado | US$0,92 (`estimated_cost_usd`, no facturación observada) |

Control del que se calibra la penalización de reparación de `quality_version = 2`
(spec `2026-07-25-plan-builder-loadtest-and-quality-v2-activation.md`, §3.7-§3.9).

Se generó con `quality_version = 1` —el flip a v2 ocurre después— así que su
`variant_id` lleva `q1`. Por eso el guard de procedencia compara el **request
fingerprint** y no el `variant_id`: exigir igualdad contra el `variant_id`
productivo posterior al flip sería insatisfacible por construcción.

Distribuciones que respalda:

| Métrica | n | p50 | p90 | p99 | max |
|---|---|---|---|---|---|
| `countRepairsV2` por semana puntuable | 42 | 2 | 5 | 6 | 6 |
| `countRepairsV2` por plan completo | 12 | 7 | 14 | 17 | 17 |
| `corrective + structural` por semana | 42 | 2 | 4 | 5 | 5 |

Advertencias que deben viajar con cualquier lectura de este control:

- **n=12 planes.** p95 y p99 de plan son prácticamente el máximo observado.
  Baseline inicial conservadora, no un p95 estable.
- **Seis configuraciones con dos réplicas.** Los pares `#1`/`#2` comparten
  fixture salvo el título del plan, que entra al prompt. No son doce muestras
  independientes.
- **`corrective + structural` es 0 en todas las semanas de running y ciclismo.**
  Sus reparaciones son enteramente `moved`/`dropped`, así que el warning —que
  lee solo esas dos dimensiones— nunca se dispara en esos escenarios,
  cualquiera sea el umbral.
- **El costo es estimado**, calculado con `src/services/planBuilder/pricing.ts`,
  cuyo encabezado pide verificar las tarifas contra la página oficial antes de
  confiar en la cifra.

Reproducir o comparar exige repetir **el mismo manifest congelado**, que viaja
embebido en el propio artefacto (`manifest.cases`, con perfil y wizard config
por caso).
