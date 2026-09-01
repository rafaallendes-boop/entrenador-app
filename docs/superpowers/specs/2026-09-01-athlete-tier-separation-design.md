# Separación de planes de atleta — Free / Weekly / Advanced

Fecha: 2026-09-01
Estado: diseño aprobado en brainstorming, pendiente de plan de implementación
Reemplaza parcialmente: [`2026-08-15-entitlements-design.md`](2026-08-15-entitlements-design.md)
(§3.3 mapa de clases y §7 buckets). El resto de esa spec sigue vigente.

## 1. Alcance

Este documento cubre **solo el plan del atleta**. Es el Proyecto 1 de una
descomposición en dos.

**Dentro de alcance:**

- Definir qué capacidad tiene cada uno de los tres tiers `free | weekly | advanced`.
- Mover `week_creator` y `chat_action` a `weekly`.
- Separar el gate de entitlement del bucket de cuota para el chat.
- Recalcular las cuotas diarias contra el costo real por request.
- Techo de gasto (`spend cap`) por tier, en vez de un literal único.
- Whoop transversal: sin gate por tier.
- Alinear `/pricing` con lo que el código efectivamente hace cumplir.
- Introducir la costura `resolveCapability` con contexto explícito, aunque en
  esta versión `targetAthleteId` no altere el resultado.

**Fuera de alcance, explícito y hasta después del piloto:**

- Producto Coach como rol o plan comercial propio (`coach_free`, `coach_advanced`).
- Rollout de `013a/b/c` (memberships, invites, RLS v2).
- Reemplazo de `VITE_COACH_ACCOUNTS` por un entitlement `coach_workspace`
  server-side.
- Resolución de entitlements por relación coach–atleta y delegación de cuota.
- Cuotas mensuales (ver §8, límite conocido).
- Pasarela de pago. El cobro del piloto sigue siendo manual.

## 2. Estado verificado del código

Contrastado contra el árbol del 2026-09-01, no contra afirmaciones previas del
roadmap.

- Los tres tiers **ya existen**. `020_user_entitlements.sql` está aplicada y su
  CHECK acepta `('free','weekly','advanced')`. `entitlementPolicy.ts` define
  `TIER_ORDER` con los tres. **Crear la cuenta intermedia es un `update`, no una
  migración.**
- `quotaBuckets.ts` ya tiene límites por tier para los siete buckets.
- **Hoy `weekly` y `advanced` son casi el mismo plan:** los buckets `chat`,
  `import` y `weekly_summary` tienen valores idénticos en ambos. La única
  diferencia real es planificación automática.
- **El entitlement es por cuenta, no por atleta.** `user_entitlements.user_id`
  es el `auth.uid()`; no hay ninguna referencia a `athlete_id` en
  `useEntitlementStore.ts`. Los atletas gestionados no tienen login: son datos
  de la cuenta que los opera.
- **No existe gating fuera del camino de IA.** `grep` de
  `getEntitlementTier`/`isClassAllowed`/`useEntitlementStore` devuelve ocho
  archivos, todos de IA, telemetría o store.
- `VITE_COACH_ACCOUNTS` es un gate de UI, **no una barrera de autorización**. El
  propio módulo lo declara y ninguna Netlify Function lo lee; la barrera real es
  la RLS por `user_id`.

### 2.1 Seis promesas de `/pricing` sin enforcement

| Promesa publicada | Realidad en código |
|---|---|
| "Propuestas automáticas aplicables" solo pagado | `chat_action: 'free'` |
| "Chat con contexto **Completo**" solo pagado | El prompt es idéntico; solo cambia el volumen |
| "Historial 30 días" en Base | Sin enforcement |
| "ACWR, strain, monotonía" solo pagado | Sin enforcement |
| "Export CSV / JSON" solo Avanzado | Sin enforcement |
| "Plan exportable" solo Avanzado | Sin enforcement |

Este diseño cierra la primera y la última; las otras cuatro se resuelven
**bajando el copy a la verdad**, no agregando gates (ver §9).

## 3. El eje de diferenciación

Los tres planes se separan por **horizonte de tiempo**, no por volumen ni por
acceso a datos:

- **Base** — *hoy*: registra, pregunta, consulta lo que ya existe.
- **Coach Semanal** — *esta semana*: el coach te la arma y te la cierra.
- **Avanzado** — *tu objetivo*: periodización multi-semana hacia una fecha.

Dos principios que se derivan de ahí y que fijan las decisiones dudosas:

1. **Base consulta, pagado modifica.** Es la costura que justifica mover
   `chat_action` a `weekly`.
2. **Los datos del usuario no son el paywall.** Lo que el atleta generó o
   autorizó —su historial, su análisis de carga, sus datos de Whoop— no se
   esconde para forzar un upgrade. Se cobra por lo que el sistema *hace* con
   esos datos, no por dejarlo verlos.

## 4. Matriz de capacidades

| Capacidad | Base | Coach Semanal | Avanzado |
|---|---|---|---|
| Registrar entrenamientos, semana, check-in diario | ✓ | ✓ | ✓ |
| Chat con el coach (`chat_general`) | ✓ | ✓ | ✓ |
| Propuestas aplicables desde chat (`chat_action`) | **✗** | ✓ | ✓ |
| Importar plan PDF/texto (`import_extract`) | ✓ | ✓ | ✓ |
| Resumen y nota semanal (`weekly_summary`) | ✗ | ✓ | ✓ |
| Crear semana completa por IA (`week_creator`) | ✗ | **✓** | ✓ |
| Plan Builder por objetivo (`plan_builder_week`/`pair`) | ✗ | ✗ | ✓ |
| Asistente IA del Coach (`coach_assistant_message`) | ✗ | ✗ | ✓ (ver §4.2) |
| Analytics de carga: ACWR, monotonía, progresión | ✓ | ✓ | ✓ |
| Historial completo | ✓ | ✓ | ✓ |
| Whoop: readiness, auto-complete, zonas FC | ✓ | ✓ | ✓ |
| Respaldo JSON export/import | ✓ | ✓ | ✓ |
| Biblioteca de plantillas de sesión | ✓ | ✓ | ✓ |
| Notificaciones configurables | ✓ | ✓ | ✓ |
| Coach Workspace multi-atleta | fuera de los tiers (§4.3) |

**Ninguna capacidad no-IA se gatea en este proyecto.** El gate sigue viviendo
entero sobre `AIRequestClass`, que es donde está el costo marginal. Esto es una
decisión, no una omisión: gatear historial o analytics agrega superficie de
enforcement en Dashboard, análisis y export a cambio de fricción para el usuario,
sin ahorrar un solo token.

### 4.1 Whoop es transversal

Whoop no se gatea por tier en ningún plano. Es dato que el usuario trae de su
propia cuenta y autoriza con un consentimiento biométrico versionado. El valor
pagado está en **las acciones que ese dato habilita** —ajuste de la semana,
creación de semana, propuestas aplicables—, todas ya gateadas por su clase de
request. Cobrar por ver el propio readiness sería cobrar por el dato, no por el
producto.

Consecuencia deliberada: un Free ve su readiness y no puede pedirle al coach que
ajuste la semana con él. Es coherente con el principio 1 de §3.

### 4.2 `coach_assistant_message` está mal clasificado

Es el Asistente IA del **Coach Workspace**, es decir producto Coach, no una
capacidad del atleta Avanzado. Se conserva en `advanced` en este proyecto
únicamente porque todavía no existe el rol que debería gatearlo. Queda
registrado como deuda de Proyecto 2: al aparecer `coach_workspace`, esta clase
migra a ese gate y sale de `REQUEST_CLASS_MIN_TIER`.

### 4.3 El Coach Workspace no es un cuarto tier

Un plan `coach_advanced` junto a `free | weekly | advanced` mezclaría dos
propuestas de valor distintas: el plan del atleta compra planificación personal;
el producto Coach compra gestión de cartera, colaboración y capacidad operativa.
Se mantiene fuera de `/pricing` y detrás de `VITE_COACH_ACCOUNTS` durante el
piloto, y se productiza en Proyecto 2.

## 5. Cambios en `REQUEST_CLASS_MIN_TIER`

```
  chat_general:            free       (sin cambio)
  chat_action:             free  →  weekly
  import_extract:          free       (sin cambio)
  weekly_summary:          weekly     (sin cambio)
  week_creator:            advanced  →  weekly
  plan_builder_week:       advanced   (sin cambio)
  plan_builder_pair:       advanced   (sin cambio)
  coach_assistant_message: advanced   (sin cambio; ver §4.2)
```

### 5.1 `week_creator` baja a `weekly`

La spec anterior lo justificaba así: *"Genera una semana completa; no debe
degradarse a sesiones locales para tiers inferiores"*. Ese argumento sigue
siendo válido y **no se contradice**: es una razón para negárselo a Free, no
para negárselo a Weekly. Weekly recibe la versión real, no una degradada.

A favor del cambio:

- El plan se llama "Coach **Semanal**". Un plan semanal que no puede crear una
  semana es una promesa rota en el nombre.
- Es la mayor diferencia de valor percibido entre Base y el primer plan pagado.
- Es barato: `week_creator` corre en `gpt-4.1-mini` tier `priority`, estimado en
  **~US$0,009 por semana**, contra los **US$0,029 medidos** de una semana de
  Plan Builder. Tres veces más barato que la capacidad que define Advanced.

Advanced conserva su diferenciación entera: periodización multi-semana hacia una
fecha objetivo, con fases, reparación y ciclo de plan. Una semana suelta y un
bloque de 12 semanas periodizado no son el mismo producto.

**Sin cambio en el filtro del normalizador.** `responseNormalizer` sigue
filtrando `create_week` emitido dentro de un turno `chat_action` y emitiendo
`filtered_create_week`. Es una barrera de encuadre —esa acción se pide por su
propio camino— y no depende del tier, así que sigue aplicando también a Weekly y
Advanced. `responseNormalizer` no conoce el tier y no debe conocerlo.

### 5.2 `chat_action` sube a `weekly`

Cierra la inconsistencia más visible de §2.1 y materializa el principio "Base
consulta, pagado modifica". Un Free conserva el chat completo, con el mismo
prompt y el mismo contexto; lo que pierde es que el coach escriba en su
calendario.

## 6. Buckets y el arreglo de `bucketLimitForTier`

`chat_general` y `chat_action` **siguen compartiendo el bucket `chat`**. Una
interacción de chat es una interacción de chat, y partir el contador duplicaría
la contabilidad sin cambiar el costo.

Pero al dejar de compartir tier, la implementación actual queda apoyada en una
invariante implícita:

```ts
export function bucketLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  if (!isClassAllowed(tier, bucket.classes[0])) return null   // ← depende del orden
  return bucket.limits[tier] ?? null
}
```

Para un Free consulta `classes[0]` (`chat_general`, permitida) y devuelve 15 —el
resultado correcto—, pero solo porque la clase menos privilegiada quedó primera
en el array. Reordenar el literal cambiaría el comportamiento en silencio.

**No es un agujero de seguridad:** el orden del gate es
`auth → kill switch → entitlement → spend cap → cuota`, así que un `chat_action`
de un Free se rechaza por entitlement antes de que la cuota lo mire. Es
fragilidad, no exposición.

Corrección: la pregunta correcta es si el tier puede usar **alguna** clase del
bucket.

```ts
if (!bucket.classes.some((cls) => isClassAllowed(tier, cls))) return null
```

Queda independiente del orden y expresa la intención. Se acompaña de un test que
falla si se reintroduce la dependencia posicional.

## 7. Cuotas diarias

### 7.1 Costo por request

**`plan_builder_week` es medición; el resto es estimación con la aritmética a la
vista.** El tamaño real del prompt del chat no está medido: ese es el pendiente
del backlog 6 de `OPTIMIZATION_AND_COSTS.md`, y cerrarlo es lo que permitiría
reemplazar estas estimaciones por números.

| Clase | Modelo | Cálculo | Costo/request |
|---|---|---|---|
| `chat_general` / `chat_action` | `gemini-2.5-flash` | 8.000 × 0,30/1M + 700 × 2,50/1M | ~US$0,004 (est.) |
| `weekly_summary` | `gemini-2.5-flash` | similar | ~US$0,004 (est.) |
| `import_extract` | `gemini-2.5-flash` | similar | ~US$0,004 (est.) |
| `week_creator` | `gpt-4.1-mini` tier `priority` | 6.000 × 0,70/1M + 1.800 × 2,80/1M | ~US$0,009 (est.) |
| `coach_assistant_message` | `gemini-2.5-flash`, `maxTokens 260` | 3.000 × 0,30/1M + 260 × 2,50/1M | ~US$0,002 (est.) |
| `plan_builder_week` | `claude-sonnet-4-6` | telemetría de producción, 2026-07-26 | **US$0,029 (medido)** |
| `plan_builder_pair` | `claude-sonnet-4-6` | dos semanas por request | ~US$0,058 (est.) |

### 7.2 El desajuste que motiva el recálculo

El tope actual de **120 chats/día cuesta ~US$14,5/mes** (120 × 0,004 × 30),
mientras Coach Semanal se publica a 12.990 CLP ≈ **US$13,7/mes**. El peor caso
sostenido del chat solo ya supera el precio del plan intermedio. El valor de 120
nunca se calibró contra el precio: la spec anterior lo fijó en `80 + 40` para
preservar la capacidad previa al unificar los dos contadores.

### 7.3 Cuotas propuestas

| Bucket | free | weekly | advanced |
|---|---|---|---|
| `chat` (`chat_general` + `chat_action`) | 15 | **40** | 120 |
| `import` (`import_extract`) | 3 | 10 | 10 |
| `weekly_summary` | — | **5** | 10 |
| `week_creator` | — | **3** | 8 |
| `plan_builder_week` | — | — | 12 |
| `plan_builder_pair` | — | — | 6 |
| `coach_assistant` | — | — | 20 |

`—` significa **clase no permitida por entitlement**, nunca cuota cero. Esa
distinción ya está en `bucketLimitForTier` y se conserva: un `null` produce la
oferta de plan, un `0` produciría un mensaje de límite diario. No son lo mismo.

Weekly queda en 40 chats/día porque es un tope de abuso, no un presupuesto: 40
mensajes al coach en un día ya es un uso extremo para una app de entrenamiento.

### 7.4 Margen modelado

| Plan | Precio/mes | Peor caso sostenido | COGS |
|---|---|---|---|
| Base | US$0 | 15×0,004 + 3×0,004 ≈ US$0,072/día → ~US$2,2/mes | — |
| Coach Semanal | ~US$13,7 | 40×0,004 + 5×0,004 + 3×0,009 + 10×0,004 ≈ US$0,25/día → ~US$7,4/mes | ~54% |
| Avanzado | ~US$26,3 | 120×0,004 + 10×0,004 + 8×0,009 + 10×0,004 + 12×0,029 + 6×0,058 + 20×0,002 ≈ US$1,37/día → ~US$41/mes | **>150%** |

Conversión ~950 CLP/USD, aproximada.

**Avanzado queda con margen negativo en el peor caso teórico, y se acepta a
propósito.** Dos causas de tamaño parecido, no una: el chat a 120/día aporta
~US$14,4/mes y Plan Builder —`week` + `pair`— aporta ~US$20,9/mes. Ninguna de
las dos se materializa en uso realista, y el respaldo es el spend cap. Ver §8.

## 8. Límite conocido: solo hay cuotas diarias

`ai_usage_daily` está indexada por `(user_id, usage_date, bucket_id)`. **Todas
las cuotas son diarias, y para Plan Builder ese es el modelo equivocado.**

Plan Builder es una acción **ráfaga**: alguien genera un bloque de 12 semanas una
vez y no lo vuelve a tocar en tres meses. Un tope diario de 12 permite consumir
360 semanas al mes —US$10,44— mientras el uso realista consume 12 una sola vez,
US$0,35. El control correcto sería una cuota **mensual**, no diaria.

**No se implementa en este proyecto.** Agregar una dimensión mensual toca el
esquema de `ai_usage_daily` y las tres RPC, y el piloto es de 1–3 personas
acompañadas donde el peor caso teórico no se va a materializar. Queda registrado
como el trabajo que hay que hacer **antes de abrir self-serve**, momento en el
que el peor caso deja de ser hipotético.

Mientras tanto, el respaldo real es el spend cap de §9.

## 9. Spend cap por tier

`spendCapPolicy.ts` tiene hoy dos literales: `ACCOUNT_DAILY_SPEND_CAP_USD = 3` y
`GLOBAL_DAILY_SPEND_CAP_USD = 5`. Un cap de US$3/día son US$90/mes: no protege el
margen de ningún plan, solo detiene un incidente.

Pasa a resolverse por tier, conservando la firma pura y sin I/O del módulo:

| Tier | Cap diario | Múltiplo del peor caso modelado |
|---|---|---|
| `free` | US$0,30 | ~4× |
| `weekly` | US$0,80 | ~3× |
| `advanced` | US$3,00 (sin cambio) | ~2× |

El cap es un **breaker**, no un presupuesto: debe estar cómodamente por encima
del uso legítimo más intenso y disparar solo cuando algo está mal —un bucle de
reintentos, un prompt inflado, un abuso—. Por eso se dimensiona como múltiplo
del peor caso modelado y no como fracción del precio.

Advanced queda con el múltiplo más ajustado (~2×) a propósito: es el único tier
cuyo peor caso modelado ya es deficitario (§7.4), así que ahí el breaker cumple
además de tope de pérdida mientras no existan cuotas mensuales (§8).

`GLOBAL_DAILY_SPEND_CAP_USD` se conserva en US$5 para el piloto de 1–3 personas.
**Debe revisarse antes de pasar a 10–20 cuentas**, o un solo Advanced que agote
su cap dejaría al resto del padrón sin servicio.

Sin cambios en el orden del gate ni en el kill switch, que sigue siendo
independiente de todo lo demás.

## 10. La costura: `resolveCapability`

La resolución de entitlement pasa a una función con contexto explícito. En esta
versión `targetAthleteId` **no altera el resultado**, y eso es deliberado: el
objetivo es que agregar la regla de coach en Proyecto 2 sea cambiar el cuerpo de
una función, no rastrear tiers por toda la aplicación.

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
  entitlementSource: 'self'      // Proyecto 2 agrega 'coach' | 'delegated'
  quotaOwnerUserId: string
  limit: number | null           // null = clase no permitida, nunca 0
  tier: Tier
  requiredTier: Tier | null
}
```

Reglas de esta versión: `entitlementSource` es siempre `'self'`,
`quotaOwnerUserId` es siempre `actorUserId`, y `targetAthleteId` se acepta,
se registra y se ignora.

**`actorUserId` nunca se acepta desde el cliente como autoridad.** En las tres
Netlify Functions se deriva del JWT verificado, igual que hoy. El cliente llama
al mismo módulo puro para su gate preventivo de UI, pero esa llamada es
**consultiva**: decide si mostrar la oferta de plan antes de gastar una request,
y no sustituye la decisión del servidor. Es el mismo split que ya existe entre
`VITE_ENTITLEMENTS` y `ENTITLEMENTS_ENABLED`, y por eso el módulo se mantiene
puro —sin red, sin Dexie, sin React—, como `entitlementPolicy.ts`.

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

Esto reemplaza la regla `max(tier_coach, tier_atleta)` que se consideró y se
descartó: hereda capacidad sin definir quién paga, y permite que un atleta vacíe
el cupo de su coach.

## 11. Alineación de `/pricing`

Cuatro de las seis promesas de §2.1 se resuelven bajando el copy, porque la
decisión de producto es no gatear datos:

| Fila actual | Queda |
|---|---|
| "Semana completa generada por IA" — · — · ✓ | — · **✓** · ✓ |
| "Propuestas automáticas aplicables" — · ✓ · ✓ | correcto tras §5.2, sin cambio |
| "Chat con contexto: ✓ / Completo / Completo" | volumen explícito: **15 / 40 / 120 por día** |
| "Historial: 30 días / Completo / Completo" | **Completo** en los tres |
| "ACWR, strain, monotonía" — · ✓ · ✓ | **✓** en los tres |
| "Export CSV / JSON" y "Plan exportable" — · — · ✓ | **✓** en los tres |

Se agregan filas para Whoop (✓ en los tres) y para las cuotas de creación de
semana (— / 3 / 8) y Plan Builder (— / — / 12 semanas al día).

El aviso "Beta cerrada · sin cobro todavía" se conserva: este proyecto alinea lo
publicado con lo aplicado, no habilita cobro automático.

## 12. Riesgos

1. **Las estimaciones de costo pueden estar equivocadas por un factor de 2–3.**
   Solo `plan_builder_week` está medido. Si el prompt del chat resulta ser de
   20k tokens en vez de 8k, el margen de Coach Semanal empeora. **Mitigación:**
   cerrar backlog 6 —la agregación de `coach_requests` sobre una ventana real—
   antes de fijar precio definitivo, y tratar las cuotas de §7.3 como
   provisionales hasta entonces.
2. **Un Free existente pierde `chat_action` al desplegar.** En el piloto actual
   el único afectado es la cuenta del owner, que está en `free` a propósito para
   el smoke. **Mitigación:** verificar el padrón de `user_entitlements` antes del
   deploy y comunicar el cambio si hay alguien más.
3. **Weekly baja de 120 a 40 chats/día.** Nadie está hoy en `weekly`, así que no
   hay regresión real; el riesgo es que 40 resulte bajo con uso real.
   **Mitigación:** es un literal en `quotaBuckets.ts` y subirlo no requiere
   migración.
4. **El peor caso de Advanced es deficitario** mientras las cuotas sean solo
   diarias (§8). Aceptado para un piloto acompañado; bloqueante antes de
   self-serve.

## 13. Rollout

Se conserva el invariante de la spec anterior: **nunca encender el cliente antes
que el servidor.**

1. Desplegar el bundle con `VITE_ENTITLEMENTS` apagada y `ENTITLEMENTS_ENABLED`
   apagada. Confirmar que no cambia nada.
2. Encender `ENTITLEMENTS_ENABLED` en servidor. Smoke con la cuenta del owner en
   `free`: `chat_general` pasa, `chat_action` da 403 `entitlement_required`,
   `week_creator` da 403.
3. `update public.user_entitlements set tier = 'weekly' where user_id = '<UUID>'`.
   Smoke: `chat_action` pasa, `week_creator` pasa, `plan_builder_week` da 403 con
   oferta de Avanzado.
4. Volver a `advanced` y confirmar que Plan Builder pasa.
5. Encender `VITE_ENTITLEMENTS` para el gate preventivo de UI.
6. Publicar el `/pricing` alineado.

Ningún paso requiere migración de Supabase ni de Dexie.
