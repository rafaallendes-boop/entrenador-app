# Costos y latencia de la IA

**Actualizado**: 9 de agosto de 2026
**Reemplaza** la versión del 24 de abril de 2026, que proyectaba costos de la era
Gemini y subestimaba el Plan Builder en cerca de un orden de magnitud.

> **Regla de este documento:** solo entra lo **medido** o lo **verificado en el
> código**. Las estimaciones van marcadas como tales y con su aritmética a la
> vista. Si una cifra no se puede sostener, se dice que no se midió.

---

## 1. Qué está medido y qué no

| Camino | Instrumentación | Estado |
|---|---|---|
| **Plan Builder async** | `plan_generation_jobs` + `plan_generation_attempts` (`016`), con tokens y `estimated_cost_usd` fechado (`pricing.ts`) | **Medido en producción** (2026-07-26) |
| **Week Creator** | Loadtest propio (`scripts/loadtest-week-creator.mjs`) | Medido en su momento; no hay telemetría continua |
| **Chat general / chat action** | `logCoachRequest` + persistencia en `coach_requests` (`018`) | **`018` aplicada y precios cargados el 2026-08-09.** Las filas nuevas traen `estimated_cost_usd`; las del 05 al 09 se quedan en `null` porque el costo se resuelve al escribir. Falta la agregación sobre una ventana real |
| **Resumen semanal / import** | Ninguna | Sin medir |

No se proyecta un costo mensual total de la app hasta verificar la cobertura
real de `018` y poblar los precios de los modelos que realmente sirven el chat.
Es la parte de mayor volumen (80 requests/día de tope) y cualquier cifra previa
saldría de una cobertura incompleta, no de una medición confiable.

> **`estimated_cost_usd = null` no es cero.** Toda agregación de costo debe
> excluir los nulls y reportar cobertura en **dos** dimensiones: porcentaje de
> filas y porcentaje de tokens cubiertos. Reportar solo filas engaña, porque
> las requests caras suelen ser pocas.

La persistencia de `018` conserva los campos que `logCoachRequest` ya emitía y
agrega `streamed` para segmentar el transporte efectivo. Es **best-effort**:
su completitud y el posible impacto de latencia solo pueden validarse en el
runtime de Netlify, contrastando filas con los eventos
`coach.request.completed` y usando el end-to-end observado por el cliente.

---

## 2. Plan Builder — configuración real

Verificado en código (2026-07-26):

| Parámetro | Valor | Fuente |
|---|---|---|
| Proveedor | Anthropic (directo, no vía `coach.ts`) | `netlify/functions/_shared/anthropicCaller.ts` |
| Modelo | `claude-sonnet-4-6` | `planBuilderRunConfig.ts` (`CLAUDE_MODEL_PLAN_BUILDER_WEEK` lo puede sobrescribir) |
| `temperature` | `0.25` | `DEFAULT_TEMPERATURE` (`asyncGenerationLoop.ts:155`) |
| `max_tokens` | `5000`; reintento por truncamiento a `12000` | `DEFAULT_MAX_TOKENS`, `TRUNCATED_RETRY_MAX_TOKENS` |
| `output_config.effort` | **no se envía** → Sonnet 4.6 lo toma como `high` | `buildClaudeBody()` |
| `thinking` | **no se envía** → en Sonnet 4.6 eso significa apagado | `buildClaudeBody()` |
| `cache_control` | **no se envía** → cero prompt caching (`cache_reads = 0`) | `buildClaudeBody()` |
| Concurrencia | 3 workers sobre cola compartida | `DEFAULT_CONCURRENCY` |
| Intentos por semana | 2 | `MAX_WEEK_ATTEMPTS` |
| Presupuesto del worker | 13 min | `DEFAULT_WORKER_BUDGET_MS` |
| Límite diario cliente | 12 semanas/día | `DEFAULT_DAILY_AI_LIMITS.plan_builder_week` |

Que `effort` no se envíe **no es neutro**: Anthropic documenta el default `high`
como trampa de migración precisamente por su costo en latencia y tokens. Es la
primera palanca de la fase de velocidad.

## 3. Precios vigentes (por 1M de tokens)

De la tabla oficial de Anthropic, contrastada con `src/services/planBuilder/pricing.ts`:

| Modelo | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| **Sonnet 4.6** (actual) | $3,00 | $15,00 | $0,30 | $3,75 |
| Sonnet 5 | $3,00 (intro **$2,00** hasta 2026-08-31) | $15,00 (intro **$10,00**) | — | — |

Dos advertencias sobre Sonnet 5, ya registradas en el handoff de latencia:

1. El precio de lista es **idéntico** al de 4.6. El intro vence el **31-08-2026**.
2. Sonnet 5 usa un tokenizer nuevo que produce **~30% más tokens** para el mismo
   texto. Después del intro, el mismo trabajo cuesta **~30% más** que en 4.6.
   Migrar por ahorro no se sostiene; migrar por calidad o por la frontera
   calidad/latencia, sí.

`pricing.ts` está fechado a propósito: sin fecha, cualquier costo calculado
después del 31-08-2026 quedaría mal.

## 4. Costo medido del Plan Builder

Smoke de producción del 2026-07-26
(`docs/superpowers/smokes/2026-07-25-quality-v2-production-smoke.md`), una
corrida real verificada en `plan_generation_jobs`:

| Métrica | Valor |
|---|---|
| Semanas generadas | 4 / 4 |
| `estimated_cost_usd` | **0,115128** |
| Costo por semana | **≈ $0,029** |
| `variant_id` | `s46-q2-00ftsagu` |
| `quality_version` | 2 |

**Proyección** (aritmética explícita, no medición):

| Escenario | Semanas/mes | Costo/mes |
|---|---|---|
| Un plan de 4 semanas | 4 | ≈ $0,12 |
| Dos planes de 8 semanas | 16 | ≈ $0,46 |
| Tope del rate limit sostenido (12/día × 30) | 360 | ≈ **$10,44** |

El tope importa para fijar el precio del piloto: un usuario que use el límite
completo todos los días cuesta ~$10/mes **solo en Plan Builder**, sin contar
chat. La versión anterior de este documento proyectaba **$0,15/mes para toda la
app** — de ahí el orden de magnitud de diferencia.

Para una corrida completa del loadtest (12 planes / 42 semanas) **la telemetría
estimó US$0,92** a partir del uso observado — no extrapolado desde producción:
es el `estimated_cost_usd` del propio artefacto de control. Como todo en esta
sección, es una estimación derivada de tokens y tabla de precios, **no
facturación observada**. Eso da **≈$0,022 por semana**, por debajo de los $0,029
de producción. La brecha no está explicada; las hipótesis razonables son que los
planes sintéticos del manifest son más baratos que el caso real, o que la
corrida de producción incluyó reintentos. **No mezclar las dos cifras**: para
presupuestar una ventana experimental vale $0,92 por corrida; para proyectar
costo por usuario vale $0,029 por semana.

Que una ventana experimental completa cueste menos de un dólar es lo que hace
que medir variantes en el loadtest salga barato frente a quemar el rate limit
del owner.

## 5. Latencia medida del Plan Builder

Línea base de producción (misma corrida del 2026-07-26):

| Métrica | Valor |
|---|---|
| Hasta la primera semana visible | **24,2 s** |
| Plan completo (4 semanas) | **43,9 s** |
| Concurrencia | 3 |

El control congelado del loadtest —12 planes / 42 semanas, SHA-256
`6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a`— **permanece
como procedencia de la calibración de `quality_version = 2`**, y no como
comparator de variantes: se generó con `quality_version = 1`, y las
penalizaciones de reparación de v1 y v2 no ponen `planScore` en la misma escala.
La Fase 2 de velocidad corre su **propio control q2 contemporáneo**
(`docs/superpowers/specs/2026-07-26-plan-builder-speed-phase-2-design.md`).

**`max_tokens` no es un driver de latencia** en Anthropic: es un techo, no un
objetivo. Bajar el cap de 5.000 (máximo observado ~1.506) es higiene de
guardrail, no una optimización de velocidad.

### `effort` — medido y descartado (2026-07-27)

La Fase 2 corrió su control q2 contemporáneo más dos variantes sobre el mismo
SHA limpio (`f349ae4`), 12 planes / 42 semanas cada una. Resultado:
**ninguna variante aceptada; `high` se queda**. `PLAN_BUILDER_EFFORT` y
`PLAN_BUILDER_THINKING` quedan sin definir en producción.

| Variante | Primera semana (mediana pareada) | Plan completo | Costo | Tokens salida | Veredicto |
|---|---|---|---|---|---|
| C `high` (control) | — | — | US$0,8975 | 41.374 | referencia |
| A `medium` | −4,9% (7/12 casos) | −2,0% | −2,5% | −3,6% | rechazada (además `score.min = −7`) |
| B `low` | **−10,2%** (9/12 casos, 5/6 escenarios) | **−13,6%** | **−8,5%** | **−12,3%** | rechazada (barra pedía −20%) |

Campaña completa: **US$2,5941** y ~30 min. Detalle, artefactos y SHA-256 en
`docs/superpowers/experiments/plan-builder-speed-phase-2/`.

Lo aprovechable para la fase siguiente: `low` es la única palanca que mostró
señal consistente, y su mecanismo es visible —12,3% menos tokens de salida—, no
una coincidencia de latencia. Lo que faltaba para poder afirmar que ese efecto
supera el ruido era un **control contra control** (C₂ vs C₁), que esa campaña
no corrió.

### El control contra control se corrió (2026-08-09) y rechaza la regla

`docs/superpowers/experiments/plan-builder-noise-floor-2026-08-09/`, US$1,7938.

**Dos controles idénticos comparados entre sí dan `VEREDICTO: RECHAZADA`**, con
cinco checks en falla. Un control no puede ser peor que sí mismo: lo que falló es
la regla, no la corrida.

Ruido pareado por caso (n=12), C₂ respecto de C₁:

| Métrica | mín | máx | rango | SD |
|---|---|---|---|---|
| Primera semana | −13,5% | +13,9% | 27,5 pts | 8,7% |
| Plan completo | −12,6% | +26,0% | 38,5 pts | 10,0% |

Consecuencias directas sobre la tabla de arriba:

- **El −10,2% / −13,6% de `low` cae dentro de la banda de ruido.** No es señal
  demostrable con este instrumento.
- **El `score.min = −7` que descartó a `medium` tampoco era evidencia:** dos
  controles idénticos dieron **−13**.
- **Los tres checks `*.p90 ≤ 0` de reparaciones fallan sobre ruido puro.** La
  Fase 2 los anotó como «plausiblemente inalcanzable — no medido»; quedan
  medidos e inalcanzables por construcción.

El veredicto de la Fase 2 —`high` se queda— sigue siendo correcto. Lo que se
invalida es el método que lo produjo.

**No correr más variantes bajo esta regla:** el resultado sería ininterpretable.
El trabajo pendiente es de diseño y no cuesta API — recalibrar barras contra el
ruido medido, reemplazar los `p90 ≤ 0`, y hacer el cálculo de potencia para
saber cuántos casos pareados hacen falta para detectar un 10% real.

**Y una advertencia sobre el instrumento:** el manifiesto sintético da 15,0 s de
primera semana y 20,8 s de plan completo, contra 24,2 s y 43,9 s de producción.
Corre casi al doble de velocidad que el caso real, así que optimizar contra él
puede no transferir.

## 6. Prompt caching: por qué todavía no aplica

`buildClaudeBody()` no manda `cache_control`, y `cache_reads = 0` lo confirma. El
orden de render es `tools` → `system` → `messages`, así que el prefijo estable
entre las N semanas de un plan es `tools` + `system`. El problema es el tamaño:

- Mínimo cacheable en Sonnet 4.6 **y** en Sonnet 5: **1.024 tokens**.
- El prefijo reutilizable real (tool schema + system prompt) mide ~1.923
  caracteres ≈ **~480 tokens**: aproximadamente **2× por debajo del umbral**. Hoy
  no cachearía aunque se marcara.
- Con concurrencia 3, las tres primeras solicitudes salen en paralelo y una
  entrada de caché solo queda legible cuando la primera respuesta **empieza a
  emitirse**. Sin prewarming, esas tres semanas pagarían precio completo igual.

Conclusión: caching es una optimización de **costo posterior**, condicionada a
(a) medir el prefijo real con Token Counting contra el modelo destino —no por
caracteres/4—, (b) separar contexto estable del contenido variable de la semana,
(c) resolver prewarming vs concurrencia, y (d) confirmar
`cache_read_input_tokens > 0`. No es una ventana automática.

## 7. Timeouts (verificado en código)

Netlify Pro corta funciones síncronas a 26 s. El proxy baja su wallclock a 24 s
para dejar margen de serialización.

| Constante | Valor | Fuente |
|---|---|---|
| `MAX_FUNCTION_WALLCLOCK_MS` | 24.000 | `netlify/functions/coach.ts:196` |
| `MIN_PROVIDER_ATTEMPT_MS` | 4.000 | `netlify/functions/coach.ts:197` |

Timeouts y caps por clase de request (`src/services/ai/requestPolicy.ts`):

| Clase | `timeoutMs` | `maxTokens` | `temperature` |
|---|---|---|---|
| `chat_general` | 15.000 | 2.400 | 0,55 |
| `chat_action` | 18.000 | 4.200 | 0,45 |
| `weekly_summary` | 18.000 | 1.600 | 0,25 |
| `week_creator` | 23.000 | 2.500 (4.000 en contrato `detailed`) | 0,40 |
| `plan_builder_week` | 22.000 | 3.500 | 0,35 |
| `plan_builder_pair` | 23.000 | 4.200 | 0,35 |
| `import_extract` | 18.000 | 2.000 | 0,10 |

> **Ojo con la doble fuente.** El Plan Builder **async** no pasa por
> `requestPolicy.ts`: llama a `callAnthropicForWeek` directamente con
> `DEFAULT_MAX_TOKENS = 5000` y `temperature 0.25`. Las filas
> `plan_builder_week` / `plan_builder_pair` de arriba aplican al camino síncrono
> vía `coach.ts`. No unificar las dos sin revisar ambos consumidores.

El cap de `week_creator` en contrato `detailed` (4.000) existe porque el cap
original de 2.500 se dimensionó midiendo solo el contrato esqueleto y truncaba
(`finishReason=length`) en las cohortes médicas.

## 8. Proveedores por clase de request

`resolvePrimaryProvider()` (`netlify/functions/coach.ts:527`) resuelve el
proveedor por env var, con fallback en cascada:
`AI_PROVIDER_<CLASE>` → `AI_PROVIDER` → `'gemini'` como default del código.

**Mapa efectivo de producción** (confirmado por el owner el 2026-08-09):

| Clase | Proveedor | Modelo efectivo | Tier |
|---|---|---|---|
| `chat_general` | gemini | `gemini-2.5-flash` | — |
| `chat_action` | gemini | `gemini-2.5-flash` | — |
| `weekly_summary` | gemini | `gemini-2.5-flash` | — |
| `import_extract` | gemini | `gemini-2.5-flash` | — |
| `week_creator` | openai | `gpt-4.1-mini` | **`priority`** |
| `plan_builder_week` | claude | `claude-sonnet-4-6` | — |
| `plan_builder_pair` | claude | `claude-sonnet-4-6` | — |

`GEMINI_MODEL` no está definida, así que las cuatro clases Gemini caen al default
del código, `gemini-2.5-flash` (`coach.ts:159`). `OPENAI_MODEL=gpt-5-mini` existe
pero hoy **ninguna clase lo usa**: `week_creator` es la única clase OpenAI y tiene
su propio `OPENAI_MODEL_WEEK_CREATOR`.

**El hallazgo que corrige una suposición vieja de este documento:** el chat —la
ruta de mayor volumen, con tope de 80 requests/día— **no corre en Claude**. Corre
en Gemini 2.5 Flash, que es entre 6× y 10× más barato por token que Sonnet 4.6.
Cualquier proyección previa que asumiera Sonnet para el chat sobreestimaba.

**El tier importa.** `OPENAI_SERVICE_TIER_WEEK_CREATOR=priority` hace que
`week_creator` cueste ~1,75× el precio estándar del mismo modelo. `MODEL_PRICES`
distingue las dos filas por `serviceTier` desde el 2026-08-09; antes de eso la
tabla no tenía forma de separarlas y habría subestimado esa clase en ~75%.

### Precios cargados (verificados el 2026-08-09)

| Modelo | Tier | Input | Output | Cache read |
|---|---|---|---|---|
| `gemini-2.5-flash` | — | $0,30 | $2,50 | $0,03 |
| `gpt-4.1-mini` | — | $0,40 | $1,60 | $0,10 |
| `gpt-4.1-mini` | `priority` | $0,70 | $2,80 | $0,175 |
| `gpt-5-mini` | — | $0,25 | $2,00 | $0,025 |

`effectiveFrom` es la fecha de **verificación**, no la de vigencia real del precio,
que no consta en las páginas oficiales. Como el costo se calcula al escribir la
fila, esto solo afecta hacia adelante.

### Lo que todavía NO se puede afirmar

**No hay un costo mensual del chat todavía, y no se va a estimar acá.** Las filas
que `018` guardó entre el 2026-08-05 y el 2026-08-09 tienen
`estimated_cost_usd = null` y **se quedan así**: el costo se resuelve al escribir,
no al leer. Con los precios cargados, las filas nuevas sí traen número.

Para cerrar backlog 6 falta correr la agregación sobre una ventana real y reportar
cobertura en **dos** dimensiones —porcentaje de filas y porcentaje de tokens—,
excluyendo los nulls. Una semana de uso normal alcanza.

## 9. Qué hacer con este documento

- Actualizarlo cuando cambie `pricing.ts`, cuando venza el intro de Sonnet 5
  (31-08-2026), o cuando una fase de velocidad mueva `effort`, `thinking`,
  modelo o concurrencia.
- **Antes de fijar el precio del piloto**, mirar la sección 4: el tope de
  ~$10/mes por usuario en Plan Builder es el número que importa, no el promedio.
- Cuando el chat se instrumente (backlog 6), agregar su sección medida acá y
  recién entonces proyectar un costo mensual de la app completa.
