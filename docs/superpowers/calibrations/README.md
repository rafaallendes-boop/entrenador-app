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
(spec de la Entrega 2, §3.7-§3.9; retirado tras el cierre, historial en git).

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

### Valores congelados (owner, 2026-07-25)

| Contrato | Valor | Efecto sobre este control |
|---|---|---|
| Penalización semanal | divisor `1`, tope `10` | media 2,1 pts · max 6 |
| Penalización de plan | divisor `4`, tope `8` | media 1,5 pts · max 4 |
| `highRepairWarningThreshold` | `5` | dispara en 3 de 42 semanas (7%) |

Razones que deben sobrevivir al commit:

- **Divisor 1 en semana, no el `/2` heredado de v1.** Con `/2` la reparación
  quedaba en media 0,86 puntos y máximo 3 sobre 100: una semana con 5
  reparaciones y otra con 0 se separaban por 2 puntos. Una métrica que no mueve
  el score no cambia ninguna decisión.
- **Los topes quedan POR ENCIMA del máximo observado.** Con tope 6 —el máximo
  del control— una variante degradada que reparase 15 veces por semana
  puntuaría igual que la peor semana del control: el tope saturaría justo donde
  empieza lo que la fase existe para detectar. Tope 10 deja 4 puntos de cabecera.
- **El plan penaliza más suave que la semana.** La reparación ya entra en cada
  score semanal y `scorePlan` promedia esos scores antes de restar su propia
  penalización; un divisor agresivo a nivel plan cobraría dos veces el mismo
  hecho.
- **Umbral 5 y no 4.** Con 5 dispara en el 7% de las semanas, raro y por lo
  tanto accionable; con 4 saltaba al 21%, que es ruido.

**Nunca recalibrar por variante** (§5.3). Comparar contra otra variante exige
repetir este mismo manifest y contrastar contra estos valores, no derivar
valores nuevos: hacerlo normalizaría una degradación real.
