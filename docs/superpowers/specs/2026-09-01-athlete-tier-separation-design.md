# Separación de planes de atleta — Free / Weekly / Advanced

Fecha: 2026-09-01
Estado: diseño aprobado, revisado por el owner, pendiente de plan de implementación
Relación con [`2026-08-15-entitlements-design.md`](2026-08-15-entitlements-design.md):
**esta spec prevalece ante cualquier conflicto.** Contradice explícitamente su
§3.3 (mapa clase→tier), §5.3 (cuotas por bucket), §6.1 (caminos al upsell), §7
(rollout) y partes de §8 (verificación). Su §3.3.1 (Competition Plan) sobrevive
sin cambios, porque su condición se ancla a `plan_builder_week`, que sigue en
`advanced`. Todo lo demás de esa spec sigue vigente.

## 1. Alcance

Este documento cubre **solo el plan del atleta**. Es el Proyecto 1 de una
descomposición en dos.

**Dentro de alcance:**

- Definir qué capacidad tiene cada tier `free | weekly | advanced`.
- Mover `week_creator` y `chat_action` a `weekly`.
- Volver explícita la invariante de bucket que hoy es posicional.
- Recalcular las cuotas contra el costo por intento.
- Definir la **unidad de consumo** de cada clase y separarla de la unidad de
  producto (§7).
- Techo de gasto por tier, en vez de un literal único.
- Whoop transversal: sin gate por tier.
- Alinear `/pricing` con lo que el código hace cumplir, **sin publicar cifras
  de cuota** (§11).
- Introducir la costura `resolveCapability` con contexto explícito.

**Fuera de alcance, explícito y hasta después del piloto:**

- Producto Coach como rol o plan comercial propio.
- Rollout de `013a/b/c` (memberships, invites, RLS v2).
- Reemplazo de `VITE_COACH_ACCOUNTS` por un entitlement `coach_workspace`.
- Entitlements por relación coach–atleta y delegación de cuota.
- Cuotas por unidad de producto y cuotas mensuales (§8).
- Pasarela de pago. El cobro del piloto sigue siendo manual.

## 2. Fase 0 — medir antes de congelar

**Cerrar el backlog 6 de `OPTIMIZATION_AND_COSTS.md` es la primera tarea del
plan de implementación.** No bloquea la arquitectura ni los gates: bloquea la
congelación de cuotas, caps y cualquier cifra visible al usuario.

Consiste en agregar `coach_requests` sobre una ventana real de uso —una semana
alcanza—. La salida tiene que reportar, **por clase de request**:

- p50, p90 y máximo de tokens de entrada;
- p50, p90 y máximo de tokens de salida;
- p50, p90 y máximo de costo estimado;
- tasa de retry y tasa de fallback, que son lo que convierte un mensaje lógico
  en 1, 2 o 3 unidades de cuota (§7);
- cobertura en **dos** dimensiones —porcentaje de filas y porcentaje de
  tokens—, excluyendo los `estimated_cost_usd = null`.

**Si la muestra resulta insuficiente para esos percentiles, las cuotas siguen
provisionales.** Una ventana corta no autoriza a congelar números; autoriza a
esperar otra semana. Sin esta medición, todos los números de §7 son aritmética
sobre un tamaño de prompt supuesto.

Las cuotas de §7.2 y los caps de §9 son **provisionales por construcción** hasta
que esa medición exista.

## 3. Estado verificado del código

Contrastado contra el árbol del 2026-09-01.

- Los tres tiers **ya existen**. `020_user_entitlements.sql` está aplicada y su
  CHECK acepta `('free','weekly','advanced')`. **Crear la cuenta intermedia es
  un `update`, no una migración.**
- **Hoy `weekly` y `advanced` son casi el mismo plan:** los buckets `chat`,
  `import` y `weekly_summary` tienen valores idénticos en ambos.
- **El entitlement es por cuenta, no por atleta.** `user_entitlements.user_id`
  es el `auth.uid()`. Los atletas gestionados no tienen login: son datos de la
  cuenta que los opera.
- **El gating de IA vive entero sobre `AIRequestClass`.** La única excepción es
  Competition Plan (§4.1).
- `VITE_COACH_ACCOUNTS` es un gate de UI, **no una barrera de autorización**. El
  módulo lo declara y ninguna Netlify Function lo lee; la barrera real es la RLS
  por `user_id`.

### 3.1 Promesas de `/pricing` sin enforcement

| Promesa publicada | Realidad en código |
|---|---|
| "Propuestas automáticas aplicables" solo pagado | `chat_action: 'free'` |
| "Chat con contexto **Completo**" solo pagado | El tier no modifica el prompt |
| "Historial 30 días" en Base | Sin enforcement |
| "ACWR, strain, monotonía" solo pagado | Sin enforcement |
| "Export CSV / JSON" solo Avanzado | Sin enforcement |
| "Plan exportable" solo Avanzado | Sin enforcement |

**Precisión sobre la segunda fila.** No es cierto que el prompt sea idéntico
entre clases: `PROMPT_TARGET_TOKENS` fija `chat_general: 3500` y
`adjust_session: 6000`. Lo que es cierto —y es lo que hace falsa la promesa— es
que **el tier no modifica el prompt de una misma clase**. Un Free y un Advanced
que mandan un `chat_general` reciben exactamente el mismo contexto.

De las seis, **la primera se cierra mediante enforcement** —`chat_action` sube a
`weekly` (§5.2)—; **las cinco restantes se cierran bajando el copy** a la verdad
(§11), porque la decisión de producto es no gatear datos del usuario.

## 4. El eje de diferenciación

Los tres planes se separan por **horizonte de tiempo**:

- **Base** — *hoy*: registra, pregunta, consulta lo que ya existe.
- **Coach Semanal** — *esta semana*: el coach te la arma y te la cierra.
- **Avanzado** — *tu objetivo*: periodización multi-semana hacia una fecha.

Dos principios derivados:

1. **Base consulta, pagado modifica.** Justifica mover `chat_action` a `weekly`.
2. **Los datos del usuario no son el paywall.** Su historial, su análisis de
   carga y sus datos de Whoop no se esconden para forzar un upgrade. Se cobra
   por lo que el sistema *hace* con esos datos.

### 4.1 Matriz de capacidades

| Capacidad | Base | Coach Semanal | Avanzado |
|---|---|---|---|
| Registrar entrenamientos, semana, check-in diario | ✓ | ✓ | ✓ |
| Chat con el coach (`chat_general`) | ✓ | ✓ | ✓ |
| Propuestas aplicables desde chat (`chat_action`) | **✗** | ✓ | ✓ |
| Importar plan PDF/texto (`import_extract`) | ✓ | ✓ | ✓ |
| Resumen y nota semanal (`weekly_summary`) | ✗ | ✓ | ✓ |
| Crear semana completa por IA (`week_creator`) | ✗ | **✓** | ✓ |
| Plan Builder por objetivo (`plan_builder_week`/`pair`) | ✗ | ✗ | ✓ |
| Asistente IA del Coach (`coach_assistant_message`) | ✗ | ✗ | ✓ (§4.3) |
| Consultar un plan competitivo ya materializado | ✓ | ✓ | ✓ |
| Editar evento, iniciar ciclo, eliminar ciclo archivado | ✗ | ✗ | ✓ |
| Analytics de carga: ACWR, monotonía, progresión | ✓ | ✓ | ✓ |
| Historial completo | ✓ | ✓ | ✓ |
| Whoop: readiness, auto-complete, zonas FC | ✓ | ✓ | ✓ |
| Respaldo JSON export/import | ✓ | ✓ | ✓ |
| Biblioteca de plantillas de sesión | ✓ | ✓ | ✓ |
| Notificaciones configurables | ✓ | ✓ | ✓ |
| Coach Workspace multi-atleta | fuera de los tiers (§4.4) |

**Competition Plan es la única capacidad no-IA gateada, y es preexistente.**
La spec anterior la definió en su §3.3.1 y el trabajo está en el árbol local sin
commitear: un Free conserva la **consulta** de un plan ya materializado en modo
solo lectura, y pierde editar el evento, iniciar un ciclo nuevo y eliminar
ciclos archivados. La condición se ancla al requisito de `plan_builder_week`,
así que Free y Coach Semanal se comportan igual y el recorrido no deriva. Este
proyecto **no la modifica ni la extiende**: es la excepción declarada a la regla
de que el gate vive sobre `AIRequestClass`.

Ninguna otra capacidad no-IA se gatea. Es una decisión: gatear historial o
analytics agrega superficie de enforcement a cambio de fricción, sin ahorrar un
solo token.

### 4.2 Whoop es transversal

Whoop no se gatea por tier en ningún plano. Es dato que el usuario trae de su
propia cuenta y autoriza con consentimiento biométrico versionado. El valor
pagado está en **las acciones que ese dato habilita**, todas ya gateadas por su
clase de request. Cobrar por ver el propio readiness sería cobrar por el dato.

Consecuencia deliberada: un Free ve su readiness y no puede pedirle al coach que
ajuste la semana con él. Coherente con el principio 1.

### 4.3 `coach_assistant_message` está mal clasificado

Es el Asistente IA del **Coach Workspace** —producto Coach—, no una capacidad
del atleta Advanced. Se conserva en `advanced` únicamente porque todavía no
existe el rol que debería gatearlo. Deuda de Proyecto 2: al aparecer
`coach_workspace`, esta clase migra a ese gate y sale de
`REQUEST_CLASS_MIN_TIER`.

### 4.4 El Coach Workspace no es un cuarto tier

Un plan `coach_advanced` junto a `free | weekly | advanced` mezclaría dos
propuestas de valor: el plan del atleta compra planificación personal; el
producto Coach compra gestión de cartera, colaboración y capacidad operativa. Se
mantiene fuera de `/pricing` y detrás de `VITE_COACH_ACCOUNTS` durante el
piloto.

## 5. Cambios en `REQUEST_CLASS_MIN_TIER`

```
  chat_general:            free       (sin cambio)
  chat_action:             free  →  weekly
  import_extract:          free       (sin cambio)
  weekly_summary:          weekly     (sin cambio)
  week_creator:            advanced  →  weekly
  plan_builder_week:       advanced   (sin cambio)
  plan_builder_pair:       advanced   (sin cambio)
  coach_assistant_message: advanced   (sin cambio; §4.3)
```

### 5.1 `week_creator` baja a `weekly`

La spec anterior lo justificaba así: *"Genera una semana completa; no debe
degradarse a sesiones locales para tiers inferiores"*. Ese argumento sigue
válido y **no se contradice**: es una razón para negárselo a Free, no a Weekly.
Weekly recibe la versión real, no una degradada.

A favor:

- El plan se llama "Coach **Semanal**". Un plan semanal que no puede crear una
  semana es una promesa rota en el nombre.
- Es la mayor diferencia de valor percibido entre Base y el primer plan pagado.
- Es barato: estimado en ~US$0,009 por generación, contra los **US$0,029
  medidos** de una semana de Plan Builder.

Advanced conserva su diferenciación entera: periodización multi-semana con
fases, reparación y ciclo de plan. Una semana suelta y un bloque de 12 semanas
periodizado no son el mismo producto.

**Sin cambio en el filtro del normalizador.** `responseNormalizer` sigue
filtrando `create_week` dentro de un turno `chat_action` y emitiendo
`filtered_create_week`. Es una barrera de encuadre —esa acción se pide por su
propio camino— y no depende del tier.

### 5.2 `chat_action` sube a `weekly`

Materializa "Base consulta, pagado modifica". Un Free conserva el chat completo,
con el mismo prompt y el mismo contexto de su clase; pierde que el coach escriba
en su calendario.

## 6. La invariante posicional de `bucketLimitForTier`

`chat_general` y `chat_action` **siguen compartiendo el bucket `chat`**. Una
interacción de chat es una interacción de chat.

Al dejar de compartir tier, la implementación actual queda apoyada en una
invariante implícita:

```ts
if (!isClassAllowed(tier, bucket.classes[0])) return null   // ← depende del orden
```

Para un Free consulta `classes[0]` (`chat_general`, permitida) y devuelve su
límite —el resultado correcto—, pero solo porque la clase menos privilegiada
quedó primera en el array. Reordenar el literal cambiaría el comportamiento en
silencio.

**No es un agujero de seguridad:** el orden del gate es
`auth → kill switch → entitlement → spend cap → cuota`, así que un `chat_action`
de un Free se rechaza por entitlement antes de que la cuota lo mire. Es
fragilidad, no exposición.

Corrección — la pregunta correcta es si el tier puede usar **alguna** clase:

```ts
if (!bucket.classes.some((cls) => isClassAllowed(tier, cls))) return null
```

Independiente del orden, y con un test que falla si se reintroduce la
dependencia posicional.

## 7. Unidades: qué cuenta una cuota

**Esta sección corrige el error más grave de la versión anterior de este spec,
que trataba las cuotas como si contaran acciones de producto.** No lo hacen.

`assertUsageGate` se llama **inmediatamente antes de cada llamada real al
proveedor**, y su propio contrato lo declara. No hay reembolso: ningún camino
del código decrementa. Entonces:

| Clase | Unidad de producto | Unidad que la cuota consume | Factor |
|---|---|---|---|
| `chat_general` / `chat_action` | un mensaje | un intento del proveedor | **1–3** |
| `import_extract` | una importación | un intento | 1–3 |
| `weekly_summary` | un resumen | un intento | 1–3 |
| `week_creator` | una semana generada | un intento | 1–3 |
| `plan_builder_week` | una semana solicitada | un intento | **1–2** |
| `plan_builder_pair` | **dos** semanas | un intento | 1–2 |
| `coach_assistant_message` | un borrador | un intento | 1 (sin fallback) |

El factor del chat sale de `coach.ts`: `maxAttempts` es 3 cuando hay retry
técnico y un fallback distinto del primario, 2 con retry sin fallback, 1 sin
retry. El de Plan Builder sale de `MAX_WEEK_ATTEMPTS = 2`.

Tres consecuencias, todas materiales:

**(a) El máximo de semanas por día no es el límite de `plan_builder_week`.**
Son dos buckets independientes: `plan_builder_week` a 12 y `plan_builder_pair`
a 6, y cada `pair` produce dos semanas (`{ actions: [create_week, create_week] }`).
El techo combinado es **32 semanas/día** con los límites de §7.2 —no 12— y por lo tanto
**960/mes**. La proyección de costo de §8 casi se triplica respecto de lo que
decía la versión anterior de este documento.

**(b) Los límites tienen que llevar holgura de retry, o un fallo técnico rompe
la capacidad central de Advanced.** Con un límite igual al largo del plan, la
semana 13 —que puede ser el segundo intento de la semana 4— se rechaza por cuota
y el plan queda incompleto. El peor caso teórico son 24 intentos para 12 semanas.

*Mitigación de este proyecto:* **holgura provisional**. `plan_builder_week` va a
16 y `plan_builder_pair` a 8 (§7.2), lo que tolera cuatro retries en estrategia
individual o dos en pares sobre un plan de 12 semanas.

La holgura se dimensiona contra evidencia, no contra el peor caso teórico:

- Las dos corridas del control de ruido del 2026-08-09 —12 planes y 42 semanas
  cada una— reportan **cero reintentos y cero fallbacks** en ambas.
- El smoke de producción del 2026-07-26 registró **4 semanas pedidas / 4
  exitosas / 0 fallidas**.

No garantiza completar siempre: 16 no cubre el peor caso de 24. Pero evita que
**un solo** retry técnico rompa un plan de 12 semanas, que es el escenario
realista. La reanudación al día siguiente queda como **recuperación residual**,
no como la mitigación normal.

Subir hasta 24 para garantizar la generación no se hace: no resuelve la causa
—contar intentos en vez de producto— y empuja el techo de costo de Advanced sin
comprar nada que la evidencia justifique.

**(c) "40 mensajes al día" es una afirmación falsa.** Son 40 intentos del
proveedor, que en el peor caso son ~14 mensajes lógicos. Por eso §11 no publica
cifras.

**Destino (Proyecto 2, no ahora):** separar cuota de producto de control de
costo. La cuota cuenta unidades de producto —`week = 1`, `pair = 2`— sobre un
bucket **mensual** de semanas ponderadas; el control de costo sigue contando
intentos reales del proveedor. Son dos preguntas distintas y hoy comparten un
solo contador.

### 7.1 Costo por intento

**Solo `plan_builder_week` está medido.** El resto es aritmética con el cálculo
a la vista, y depende de un tamaño de prompt que nadie midió (§2).

| Clase | Modelo | Cálculo | Costo/intento |
|---|---|---|---|
| `chat_general` / `chat_action` | `gemini-2.5-flash` | 8.000 × 0,30/1M + 700 × 2,50/1M | ~US$0,004 (est.) |
| `weekly_summary` | `gemini-2.5-flash` | similar | ~US$0,004 (est.) |
| `import_extract` | `gemini-2.5-flash` | similar | ~US$0,004 (est.) |
| `week_creator` | `gpt-4.1-mini` tier `priority` | 6.000 × 0,70/1M + 1.800 × 2,80/1M | ~US$0,009 (est.) |
| `coach_assistant_message` | `gemini-2.5-flash`, `maxTokens 260` | 3.000 × 0,30/1M + 260 × 2,50/1M | ~US$0,002 (est.) |
| `plan_builder_week` | `claude-sonnet-4-6` | telemetría de producción, 2026-07-26 | **US$0,029 (medido)** |
| `plan_builder_pair` | `claude-sonnet-4-6` | dos semanas por request | ~US$0,058 (est.) |

Tarifas verificadas contra las páginas oficiales: Gemini 2.5 Flash $0,30/$2,50 y
Sonnet 4.6 $3/$15 por 1M.

**Los 700 tokens de salida del chat son un supuesto optimista.** Los caps son
2.400 para `chat_general` y 4.200 para `chat_action`. Una respuesta al cap
costaría ~US$0,013, más de **3×** la estimación. Esa es la sensibilidad que la
Fase 0 tiene que cerrar.

### 7.2 Cuotas propuestas

Son **límites internos provisionales en intentos del proveedor**, no promesas de
producto.

| Bucket | free | weekly | advanced |
|---|---|---|---|
| `chat` (`chat_general` + `chat_action`) | 15 | **40** | 120 |
| `import` (`import_extract`) | 3 | 10 | 10 |
| `weekly_summary` | — | **5** | 10 |
| `week_creator` | — | **3** | 8 |
| `plan_builder_week` | — | — | **16** |
| `plan_builder_pair` | — | — | **8** |
| `coach_assistant` | — | — | 20 |

`—` significa **clase no permitida por entitlement**, nunca cuota cero. Un `null`
produce la oferta de plan; un `0` produciría un mensaje de límite diario.

### 7.3 Escenario de cuota completa

No es un "peor caso": es el costo de agotar todas las cuotas todos los días, con
**costos estimados** y con el supuesto optimista de 700 tokens de salida (§7.1).

| Plan | Precio/mes | Cuota completa sostenida | Ratio |
|---|---|---|---|
| Base | US$0 | 15×0,004 + 3×0,004 ≈ US$0,07/día → ~US$2,2/mes | — |
| Coach Semanal | ~US$13,7 | 40×0,004 + 5×0,004 + 3×0,009 + 10×0,004 ≈ US$0,25/día → ~US$7,4/mes | ~54% |
| Avanzado | ~US$26,3 | 120×0,004 + 10×0,004 + 10×0,004 + 8×0,009 + 16×0,029 + 8×0,058 + 20×0,002 ≈ US$1,60/día → ~US$48/mes | **>180%** |

Conversión ~950 CLP/USD, aproximada.

**Avanzado queda deficitario en cuota completa, y se acepta a propósito.** Plan
Builder —`week` + `pair`— aporta ~US$27,8/mes y el chat ~US$14,4/mes. La holgura
de retry de §7 (b) agrega ~US$7/mes a este escenario: es el precio de que un
fallo técnico no rompa un plan, y solo se paga si alguien agota la holgura todos
los días, cosa que la evidencia de cero retries hace improbable.

## 8. Límite conocido: cuotas diarias que cuentan intentos

`ai_usage_daily` está indexada por `(user_id, usage_date, bucket_id)`. **Todas
las cuotas son diarias y todas cuentan intentos del proveedor.** Para Plan
Builder ambas cosas son el modelo equivocado.

Plan Builder es una acción **ráfaga**: alguien genera un bloque de 12 semanas una
vez y no lo vuelve a tocar en tres meses. El techo diario combinado de 32 semanas
permite consumir **960 semanas al mes** —~US$27,8— mientras el uso realista
consume 12 una sola vez, ~US$0,35. Son casi dos órdenes de magnitud entre el
techo y el uso.

**No se implementa acá.** Agregar una dimensión mensual y una ponderación por
producto toca el esquema de `ai_usage_daily` y las tres RPC. El piloto es de 1–3
personas acompañadas donde ese techo no se va a materializar.

Destino, para que Proyecto 2 no lo re-derive: **bucket mensual de semanas
ponderadas**, con `plan_builder_week = 1` y `plan_builder_pair = 2` unidades de
producto, conviviendo con el contador de intentos que sigue sirviendo al control
de costo.

## 9. Spend cap por tier

`spendCapPolicy.ts` tiene hoy dos literales: `ACCOUNT_DAILY_SPEND_CAP_USD = 3` y
`GLOBAL_DAILY_SPEND_CAP_USD = 5`. Un cap de US$3/día son US$90/mes: no protege el
margen de ningún plan.

Pasa a resolverse por tier, conservando la firma pura y sin I/O del módulo:

| Tier | Cap diario | Múltiplo de la cuota completa |
|---|---|---|
| `free` | US$0,30 | ~4× |
| `weekly` | US$0,80 | ~3× |
| `advanced` | US$3,00 (sin cambio) | ~1,9× |

### 9.1 Qué NO es el spend cap

Es un **breaker adicional, con overshoot y cobertura incompleta**. No es un
respaldo del margen ni un tope de pérdida, y por sí solo no justifica aceptar el
déficit de §7.3. Tres razones verificadas en el código:

- **El costo se registra después de una respuesta exitosa y es best-effort.**
  `recordUsageCost` sale temprano si `costUsd <= 0` —que incluye el caso de
  precio desconocido para el modelo— y también si no queda presupuesto de
  wall-clock (`timeoutMs <= 0`, la ruta que `coach.ts` usa bajo el corte
  síncrono de Netlify). Un intento con timeout, con modelo sin precio en
  `MODEL_PRICES` o al final del presupuesto **no suma nada al acumulado**.
- **Hay overshoot por lectura-antes-de-gasto.** `evaluateGatePreamble` lee el
  gasto y evalúa el cap *antes* de llamar al proveedor. Varias requests
  concurrentes pueden leer todas un total bajo el cap y quedar en vuelo a la
  vez. Es un límite conocido y aceptado por diseño en la spec de límites de uso.
- **El agregado server-side no reemplaza la factura del proveedor.**

Advanced queda con el múltiplo más ajustado (~2×) porque es el único tier cuya
cuota completa ya es deficitaria; ahí el breaker acota la pérdida sin
garantizarla.

`GLOBAL_DAILY_SPEND_CAP_USD` se conserva en US$5 para el piloto de 1–3 personas.
**Debe revisarse antes de pasar a 10–20 cuentas**, o un solo Advanced que agote
su cap dejaría al resto sin servicio.

Sin cambios en el orden del gate ni en el kill switch, que sigue siendo
independiente.

## 10. La costura: `resolveCapability`

La resolución pasa a una función con contexto explícito. En esta versión
`targetAthleteId` **no altera el resultado**, y eso es deliberado: el objetivo es
que agregar la regla de coach en Proyecto 2 sea cambiar el cuerpo de una función,
no rastrear tiers por toda la aplicación.

```ts
export function resolveCapability(input: {
  actorUserId: string        // SIEMPRE derivado del JWT en servidor
  targetAthleteId: string | null
  capability: AIRequestClass
  now: number
  entitlement: EntitlementRow | null
}): CapabilityDecision

export interface CapabilityDecision {
  allowed: boolean
  tier: Tier
  requiredTier: Tier | null
  /** Quién aporta la capacidad. Proyecto 2 agrega 'coach' | 'delegated'. */
  entitlementSource: 'self'
  /** De quién es el entitlement que se está usando. */
  entitlementOwnerUserId: string
  /** Contra quién se contabiliza la cuota. */
  quotaOwnerUserId: string
  /** Bucket a incrementar; evita re-resolverlo fuera de esta función. */
  quotaBucketId: string | null
  /** Unidades que consume esta llamada. Hoy siempre 1 (§7). */
  consumptionUnits: number
  /** null = clase no permitida. Nunca 0. */
  limit: number | null
}
```

Reglas de esta versión: `entitlementSource` es siempre `'self'`;
`entitlementOwnerUserId` y `quotaOwnerUserId` son ambos `actorUserId`;
`consumptionUnits` es siempre `1`, porque hoy la cuota cuenta intentos y cada
llamada es un intento; `targetAthleteId` se acepta, se registra y se ignora.

`quotaBucketId` y `consumptionUnits` existen desde ahora **precisamente para que
Proyecto 2 no tenga que resolver bucket y unidades fuera de esta función**, que
es donde hoy se resuelven y donde se perdería la coherencia al introducir la
ponderación de §8.

**`actorUserId` nunca se acepta desde el cliente como autoridad.** En las tres
Netlify Functions se deriva del JWT verificado. El cliente llama al mismo módulo
puro para su gate preventivo de UI, pero esa llamada es **consultiva**: decide si
mostrar la oferta antes de gastar una request, y no sustituye la decisión del
servidor. Es el mismo split que ya existe entre `VITE_ENTITLEMENTS` y
`ENTITLEMENTS_ENABLED`, y por eso el módulo se mantiene puro —sin red, sin Dexie,
sin React—, como `entitlementPolicy.ts`.

### 10.1 Regla destino (Proyecto 2, documentada acá para no perderla)

Cuatro conceptos separados: quién actúa, sobre qué atleta, quién aporta la
capacidad y a quién se le cobra la cuota.

- **Atleta sobre sí mismo:** su plan, su cuota.
- **Coach sobre un atleta vinculado:** plan y cuota del coach, con un tope por
  atleta para que uno solo no consuma la cartera.
- **Atleta viendo o ejecutando una planificación creada por su coach:**
  permitido como funcionalidad base. **Consumir una planificación y generar una
  planificación son capacidades distintas.**
- **Atleta pidiendo una acción de IA nueva:** su propio plan. Solo podría
  consumir cuota del coach mediante una delegación explícita futura.

Reemplaza la regla `max(tier_coach, tier_atleta)` que se consideró y se descartó:
hereda capacidad sin definir quién paga, y permite que un atleta vacíe el cupo de
su coach.

## 11. Alineación de `/pricing`

**No se publica ninguna cifra de cuota.** Las cuotas cuentan intentos del
proveedor, no acciones de producto (§7), así que "40 mensajes al día" o "12
semanas al día" serían promesas que el sistema no cumple. Hasta que exista la
contabilidad por unidad de producto, la página describe **capacidades**, no
volúmenes, y usa "uso justo" donde antes iría un número.

| Fila actual | Queda |
|---|---|
| "Semana completa generada por IA" — · — · ✓ | — · **✓** · ✓ |
| "Propuestas automáticas aplicables" — · ✓ · ✓ | correcto tras §5.2, sin cambio |
| "Chat con contexto: ✓ / Completo / Completo" | ✓ en los tres, con nota de uso justo |
| "Historial: 30 días / Completo / Completo" | **Completo** en los tres |
| "ACWR, strain, monotonía" — · ✓ · ✓ | **✓** en los tres |
| "Export CSV / JSON" y "Plan exportable" — · — · ✓ | **✓** en los tres |

Se agregan filas para Whoop (✓ en los tres) y para Competition Plan, distinguiendo
consultar un plan (✓ en los tres) de crear o editar uno (solo Avanzado).

El aviso "Beta cerrada · sin cobro todavía" se conserva.

## 12. Riesgos

1. **Las estimaciones de costo pueden estar equivocadas por un factor de 2–3.**
   Solo `plan_builder_week` está medido, y el supuesto de 700 tokens de salida
   está lejos de los caps de 2.400/4.200. **Mitigación:** Fase 0 (§2) bloquea la
   congelación de cuotas, caps y copy numérico.
2. **Un Free existente pierde `chat_action` al desplegar.** En el piloto el
   único afectado es la cuenta del owner, hoy en `free` para el smoke.
   **Mitigación:** revisar el padrón de `user_entitlements` antes del deploy.
3. **Weekly baja de 120 a 40 intentos/día.** Nadie está en `weekly` hoy, así que
   no hay regresión real. **Mitigación:** es un literal en `quotaBuckets.ts`.
4. **La holgura de retry de 16/8 no cubre el peor caso teórico de 24 intentos**
   (§7 (b)). Cubre el escenario realista y está dimensionada contra dos corridas
   con cero reintentos. Si aparece un plan incompleto por cuota, la señal es que
   la tasa de retry real no es cero y hay que medirla, no subir el número a
   ciegas. **Mitigación residual:** el Plan Builder es reanudable por semana.
5. **La cuota completa de Advanced es deficitaria** mientras las cuotas cuenten
   intentos y sean diarias (§8), y el spend cap no lo compensa (§9.1).

## 13. Rollout

Se conserva el invariante: **nunca encender el cliente antes que el servidor.**

Estado de producción según el último smoke: `ENTITLEMENTS_ENABLED=true`,
`AI_USAGE_LIMITS_ENABLED=true`, `AI_KILL_SWITCH_ENABLED=false` y
`VITE_ENTITLEMENTS` **apagada**. El servidor ya gatea; lo que falta es el gate
preventivo de UI.

1. **Verificar ese estado antes de tocar nada.** Confirmar los cuatro valores en
   el contexto Production de Netlify. Si alguno no coincide, detenerse: el resto
   del rollout supone servidor gateando.
2. Desplegar el bundle con los cambios de tier y cuotas, con `VITE_ENTITLEMENTS`
   todavía **apagada**. El servidor aplica el corte nuevo; la UI sigue sin gate
   preventivo.
3. Smoke con la cuenta del owner en `free`: `chat_general` pasa, `chat_action`
   da 403 `entitlement_required`, `week_creator` da 403, `/competition-plan`
   muestra el plan existente en solo lectura.
4. `update public.user_entitlements set tier = 'weekly' where user_id = '<UUID>'`.
   Smoke: `chat_action` pasa, `week_creator` pasa, `plan_builder_week` da 403 con
   oferta de Avanzado.
5. Volver a `advanced` y confirmar que Plan Builder pasa.
6. Encender `VITE_ENTITLEMENTS` para el gate preventivo de UI. Netlify exige
   redeploy para que una variable nueva surta efecto.
7. Publicar el `/pricing` alineado.

Ningún paso requiere migración de Supabase ni de Dexie.
