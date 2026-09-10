# Separación del rol Coach — identidad, vínculo, autorización y cuota delegada

Fecha: 2026-09-01
Estado: diseño revisado por el owner (ronda 1), pendiente de aprobación
Proyecto 2 de la descomposición abierta en
`2026-09-01-athlete-tier-separation-design.md`, retirada el 2026-09-09 por estar
implementada (`git show 411556a:docs/superpowers/specs/2026-09-01-athlete-tier-separation-design.md`).
Relación con [`2026-07-05-coach-two-sided-foundation-sp1-design.md`](2026-07-05-coach-two-sided-foundation-sp1-design.md):
esta spec **consume** su fundación (`013a/b/c`) y **prevalece** sobre su plan de
rollout. SP1b (invites + UI) sigue sin implementarse y queda fuera de alcance.

## 1. El problema

Hoy "coach" no es un rol: es una allowlist de emails en `VITE_COACH_ACCOUNTS`,
cuyo propio módulo declara que **no es una barrera de seguridad**. La barrera
real es la RLS por `user_id`, que dice "esta cuenta es dueña de estos datos", no
"esta cuenta entrena a este atleta". Las dos frases coinciden por accidente
mientras el coach y el atleta son la misma persona, y dejan de coincidir en
cuanto no lo son.

Consecuencias verificadas en el árbol del 2026-09-01:

- `coach_assistant_message` se gatea como capacidad de atleta `advanced`, porque
  no existe el rol que debería gatearla (deuda declarada en §4.3 del Proyecto 1).
- `/coach` vive dentro del mismo `AppShell` que las rutas de atleta.
- `resolveCapability` acepta `targetAthleteId` y lo ignora a propósito, a la
  espera de esta spec.

## 2. Alcance

**Dentro:**

- Rol de cuenta explícito (`athlete | coach | unknown`) con barrera server-side,
  en reemplazo de `VITE_COACH_ACCOUNTS`.
- Scope de atleta explícito de tres estados, con fallo cerrado.
- Membresía como **única** autoridad de autorización: reconciliación de las
  policies v2 y retiro de las legacy.
- Camino de escritura de membresías, con autorización administrativa propia.
- `resolveCapability` con delegación: coach sobre atleta vinculado consume la
  capacidad y la cuota del coach, con tope adicional por atleta.
- Cuenta coach separada, sin atleta self, con rutas propias.
- Transferencia del roster gestionado a la cuenta coach.

**Fuera, explícito:**

- Monetización del producto Coach. El rol no es un plan.
- SP1b: invitaciones, tokens, expiración, revocación por UI, `claim_self`.
- Cuotas mensuales y cuota por unidad de producto (deuda del Proyecto 1, §7).
- Pasarela de pago.
- Retiro de `owner_account_id`/`linked_account_id` de `athletes`. Se conservan
  como dato; dejan de ser autoridad de acceso.

## 3. Decisiones tomadas y por qué

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **Dos cuentas distintas.** Un `user_id` = un rol. | Una cuenta con dos contextos, o con dos entitlements. | Elimina de raíz la ambigüedad de a quién se le cobra una request y qué scope está activo. El costo —re-sync completo al cambiar de sombrero— es de UX, no de aislamiento (§4.5). |
| **La cuenta actual del owner queda como atleta.** La cuenta coach nace vacía. | Convertir la cuenta actual en coach. | Mueve lo barato (un atleta de prueba) en vez de lo caro e irreversible (historial, planes, Whoop, consentimientos, entitlement). |
| **Vínculo real, invitación después.** | SP1b completo. | La autorización por vínculo es el objetivo; construir un producto de invitaciones no lo es. Hueco declarado en §11. |
| **`account_role` en `user_entitlements`.** | Tabla propia; rol derivado de las membresías. | Es una fila por usuario, service-role only, ya leída en el camino caliente del gate: cero round-trips nuevos. Derivarlo de membresías haría que un coach sin alumnos no exista y no pueda crear el primero. |
| **`quotaSubject`, no bucket compuesto.** | Codificar el atleta dentro de `quotaBucketId`. | `usageGate.ts:211` compara `quotaBucketId` con `bucketForClass(capability).id` por igualdad estricta. Un id compuesto rompe esa comprobación o la obliga a parsear, que es el acoplamiento que la costura existe para evitar. |
| **Entrega 1 en dos modos: auditoría y enforcement.** | Encender la barrera de una vez. | Permite medir qué habría denegado antes de denegarlo. |

## 4. Estado verificado del código y de las migraciones

Contrastado contra el árbol del 2026-09-01. **Los cuatro primeros hallazgos
cambian el alcance o el orden de ejecución.**

### 4.1 `013` no convierte la membresía en barrera

`013b` lo declara textualmente: *"Las policies legacy user_id/owner NO se tocan
(permissive OR; rollback simple)"*. En Postgres varias policies permissive del
mismo comando se **OR**-ean, así que mientras convivan, el acceso se concede si
**cualquiera** coincide. `013c` sólo hace
`alter column authored_by_role set not null` y reconcilia `athlete_coach_notes`;
no retira ninguna policy.

**Por lo tanto: con `013a/b/c` aplicadas, un vínculo revocado no produce 403.**
La RLS v2 es aditiva por diseño. Convertir la membresía en barrera exige retirar
las policies legacy, y eso sí es destructivo y sin rollback trivial.

### 4.2 La RLS v2 no es equivalente a la legacy: le faltan comandos

Éste es el hallazgo que impide alcanzar la equivalencia sólo con backfill.
`013b` §8b–8e instala, para las tablas relevantes:

| Tabla | Policies v2 existentes | Hueco frente a legacy |
|---|---|---|
| `athletes` | `select` por membresía; `update` por coach; `update` por self | **Sin `insert` y sin `delete`.** |
| `coach_proposals`, `training_plans`, `training_plan_weeks` | `for all` con `auth_coach_athlete_ids()` | **El self queda excluido**: `auth_coach_athlete_ids()` filtra `role = 'coach'`, y un self tiene `role = 'self'`. |
| `day_logs`, `week_summaries`, `chat_messages`, `athlete_profiles` | `for all` con `auth_athlete_ids()` | Sin hueco. |
| `sessions` | `insert` por membresía; `update`/`delete` por coach o self self-authored | Sin hueco relevante. |
| `readiness_daily` | `select` por membresía | Sin hueco. |
| `whoop_workouts` | Ninguna policy v2; conserva `whoop_workouts_select` de `012` por owner/linked | **Sin `select` por membresía.** |

Consecuencias si se retirara la legacy sin reconciliar: **un atleta self perdería
el onboarding** (no puede insertar su propia fila en `athletes`) **y el Plan
Builder** (no puede escribir `training_plans` ni `training_plan_weeks`), y el
borrado duro de un atleta gestionado dejaría de funcionar.

Además, WHOOP dejaría un camino de autorización atado al modelo legacy. Antes
del corte, la reconciliación agrega `whoop_workouts_select_membership` de forma
aditiva. Así WHOOP sigue siendo transversal al atleta y su equivalencia puede
observarse antes de retirar la policy de `012`.

Hay además un problema de orden: **la membresía no puede existir antes que el
atleta**, porque referencia su id. Crear atleta y membresía tienen que ocurrir
juntos o ninguno.

### 4.3 El corte no concede visibilidad; hace real la revocación

Corrige una afirmación errónea de la ronda anterior de esta spec. Por el
`permissive OR`, una cuenta coach nueva **con** membresía ya ve el roster antes
del corte: `athletes_select_membership` concede aunque la policy legacy no. Lo
que el corte cambia es que dejar de tener membresía deje de conceder acceso.

El trigger `athletes_no_access_reparent` (`before update`) sigue prohibiendo
cambiar `owner_account_id`/`linked_account_id`, así que la transferencia del
roster se hace **por membresías**, no re-parentando.

### 4.4 `ai_usage_daily` tiene cinco consumidores lógicos, no uno

Ampliar la PK sin tocarlos duplicaría contabilidad. Inventario completo:

| Consumidor | Hoy | Qué le pasa con la PK ampliada |
|---|---|---|
| `increment_ai_usage_if_under_limit` (`021`) | Reserva por `(user, fecha, bucket)` | Debe pasar a reservar una o dos filas según delegación |
| `increment_ai_usage_cost` (`021:85`) | `update … where user_id, usage_date, bucket_id` | **Actualizaría global y subject**: devolvería dos filas y duplicaría el costo. `recordUsageCost` trata la cardinalidad inesperada como respuesta inválida |
| `read_ai_usage_spend` (`021:65`) | `sum(estimated_cost_usd)` sobre todas las filas del día | **Duplicaría el gasto** del spend cap |
| `read_operations_metrics` (`022:136`) | `sum(request_count)` y `sum(estimated_cost_usd)` | **`/ops` reportaría el doble** de requests y de costo |
| `checkUsagePreflight` (`usageGate.ts:263`) | `GET` a PostgREST filtrando `user_id`, `usage_date`, `bucket_id` | Con dos filas **leería una arbitrariamente** |

Cuatro son SQL y el quinto es un `GET` directo desde la Function, pero los cinco
leen o escriben la misma tabla y los cinco cambian de significado con la PK
ampliada. El guard de drift de §8.3 cubre los cinco.

### 4.5 El aislamiento entre cuentas ya está resuelto

`prepareLocalDataForUser` compara el `user_id` firmado con el último y, si
cambió, ejecuta `clearAllLocalAppDataForSync` sobre el anterior. Dos cuentas en
el mismo navegador no se filtran datos locales. El costo es un re-sync completo
por cambio de cuenta, aceptado para esta versión.

### 4.6 `isSelfScopeActive()` adopta legacy cuando no hay atleta activo

```ts
return activeAthleteId === null || activeAthleteId === selfAthleteId
```

`activeAthleteId === null` significa hoy "todavía no hidraté" y —bajo el modelo
nuevo— también "esta cuenta no tiene atleta self". Una cuenta coach caería en la
primera rama y adoptaría filas legacy/unscoped como propias. Hay 27 archivos que
leen `getSelfAthleteId()`.

### 4.7 El rol y el scope se hidratan en paralelo

`App.tsx` tiene dos `useEffect` independientes con la misma dependencia
`[userId]`: uno hidrata el entitlement (`:182`) y otro el scope de atleta
(`:198`). No hay orden garantizado, así que el scope puede resolverse antes de
saber el rol.

### 4.8 El repo no es la autoridad de qué policies existen

`007` crea las policies de las tablas hijas dentro de un bloque `do $$` dinámico
y borra selectivamente variantes previas; `013b` también genera policies por
bucle. **La enumeración exacta de lo que rige en producción sólo puede salir de
`pg_policies`.**

## 5. Identidad y rol

`user_entitlements` gana `account_role text not null default 'athlete'` con
`check (account_role in ('athlete','coach'))`. Sólo service role escribe, igual
que `tier`.

**El rol no es un plan.** `account_role` decide *qué producto usa* la cuenta;
`tier` decide *cuánto puede hacer*. Conviven en la misma tabla por costo de
lectura, no por equivalencia conceptual: cuando el producto Coach se monetice,
su plan será una columna aparte y `account_role` seguirá significando lo mismo.

### 5.1 Los tres estados y qué los produce

| Estado | Se produce cuando | Efecto |
|---|---|---|
| `athlete` | La fila existe con ese valor, **o se confirma que no hay fila** | Comportamiento actual completo |
| `coach` | La fila existe con ese valor | Producto Coach; nunca scope `self` |
| `unknown` | La lectura **falla** y no hay espejo local válido | Fallo cerrado, reintentable |

La distinción entre "ausencia confirmada" y "fallo de lectura" es el punto
central: hoy la spec anterior las colapsaba, y para una cuenta coach interpretar
un fallo de red como `athlete` reabriría exactamente la adopción self que §6
existe para prohibir.

En `unknown`: scope `none`, sin onboarding, sin backfill y **sin sync de datos
de entrenamiento**. No es una denegación permanente sino un estado de espera,
presentado como tal —el mismo patrón que ya usa el gate de consentimiento— y
reintentable.

> **Superado para el cliente por la enmienda §6.1 (2026-09-04).** En cliente
> `unknown` sigue el camino de `athlete` y el bootstrap no se detiene; sólo un
> rol `coach` confirmado cierra el scope. En servidor este párrafo sigue
> vigente tal cual.

**El servidor también necesita `unknown`.** `resolveEntitlementTier`
(`resolveEntitlement.ts:52`) declara literalmente *"Fail-closed literal:
cualquier error devuelve 'free'. Nunca lanza"*: red caída, `!response.ok`, JSON
ilegible o `expires_at` inválido resuelven **`free`**, no `503`.

Esa degradación es correcta para el **tier**, porque `free` es el valor menos
capaz: degradar sólo puede quitar. **Para el rol no lo es**, y ésta es la
asimetría que hay que ver: el rol no ordena de menos a más capaz, sino que
selecciona un producto distinto. Un coach cuyo rol no se pueda leer y degrade a
`athlete` queda **denegado** para lo suyo —`coach_assistant_message`, la
delegación— pero **habilitado** para capacidades de atleta que sólo exigen
`free`, como `chat_general` e `import_extract`. Degradar identidad **concede**,
no sólo quita.

Regla fijada, en servidor:

| Resultado de la lectura | Rol | Efecto |
|---|---|---|
| Fila presente | Su valor | Normal |
| **Ausencia confirmada** de fila (respuesta OK, cero filas) | `athlete` | Default de compatibilidad; es el caso de toda cuenta anterior a `M0` |
| **Fallo de lectura** (red, `!response.ok`, JSON ilegible, valor fuera de la unión) | `unknown` | **`503 server_error`**, sin llamar al proveedor y sin consumir cuota |

Sólo la ausencia **confirmada** aplica el default. Un fallo nunca se convierte
en un rol.

**Consecuencia de implementación:** el rol no puede leerse por el camino actual
de `resolveEntitlementTier`, que colapsa ambos casos en `free` y nunca lanza. La
lectura del rol devuelve un resultado discriminado —presente / ausente
confirmada / fallo— y el gate traduce el tercero a `503`. El tier conserva su
degradación actual sin cambios: son dos preguntas distintas sobre la misma fila.

En cliente, `unknown` no produce 503 sino scope `none` (§6): ahí el daño no es
denegar sino adoptar scope self por error (§4.6).

### 5.2 Bootstrap único y ordenado

Los dos efectos paralelos de §4.7 se reemplazan por **una sola secuencia**:

1. **Limpiar la frontera de cuenta** — `prepareLocalDataForUser(userId)`.
2. **Resolver el rol** — hidratar el entitlement.
3. **Hidratar el scope** — atleta activo, según el rol ya conocido.

Ningún paso empieza antes de que el anterior termine. El paso 3 nunca corre con
rol `unknown`.

### 5.3 `coach_assistant_message`

La versión anterior de esta spec decía a la vez que la clase salía de
`REQUEST_CLASS_MIN_TIER`, que el rol no concede capacidad y que pasaba a exigir
sólo rol coach. Las tres no pueden coexistir, y además sacarla del mapa la
rompería: `isClassAllowed` deniega toda clase desconocida y `bucketLimitForTier`
la consulta con `.some(...)`, así que su cuota quedaría en `null`.

Regla fijada, **provisional y declarada como tal**:

- La clase **permanece** en `REQUEST_CLASS_MIN_TIER`, con requisito `free`, para
  que la resolución de cuota siga funcionando sin casos especiales.
- Se agrega una **precondición de rol**: exige `account_role === 'coach'`, que
  se evalúa antes que el tier.
- **Durante el piloto, toda cuenta coach recibe la capacidad.** Cuando el
  producto Coach se monetice, el requisito se mueve a su plan propio, no al tier
  del atleta.

Cambio de comportamiento declarado: un atleta `advanced` deja de tener acceso.
Es intencional — nunca fue una capacidad del atleta.

## 6. Scope explícito de tres estados

`scope` pasa a ser `self | managed | none`, y **el rol se resuelve antes que la
hidratación de atletas** (§5.2). Ése es el punto que evita la ambigüedad de
§4.6: `none` es alcanzable sin depender de que la hidratación haya terminado.

| `account_role` | Scope posible | Adopción de filas legacy/unscoped |
|---|---|---|
| `athlete` | `self`, `managed` | Sólo en `self`, incluida la rama de pre-hidratación actual |
| `coach` | `managed`, `none` | **Nunca** |
| `unknown` | igual que `athlete` (ver enmienda abajo) | Sólo en `self` |

`none` falla cerrado: devuelve conjunto vacío y bloquea escritura, no cae a un
default. **El camino del atleta no cambia**, deliberadamente: preservar la rama
de pre-hidratación para `athlete` mantiene intacta la política legacy self-only
y acota el cambio a la superficie nueva.

### 6.1 Enmienda del 2026-09-04 — `unknown` no cierra el scope del cliente

La versión original de §6 mapeaba `unknown → none` también en cliente. La
revisión de código posterior a la implementación mostró que la premisa —«un rol
ilegible es un fallo de lectura, y por tanto raro»— es falsa en una app
local-first:

- En el arranque **offline** la lectura remota siempre falla, y el espejo de
  Dexie escrito por bundles anteriores no tiene `account_role`.
- Una **ausencia confirmada** de fila borra el espejo (`db.entitlements.delete`),
  así que toda cuenta sin fila en `user_entitlements` —hoy casi todas— resuelve
  `unknown` en el siguiente arranque sin red.

El efecto observado era que `getSessionsForWeek`, `getDayLogsForWeek`,
`getWeekSummary` y `getAthleteProfile` devolvían vacío, y que
`runSessionBootstrap` abortaba antes de `runFullSync` — dejando la sesión sin
sincronizar hasta el siguiente evento `online`/`focus`.

**Decisión (owner, 2026-09-04):** en cliente el scope se cierra sólo con
evidencia **positiva** de rol `coach`; `unknown` sigue el camino de `athlete`.
La invariante que motivaba §6 se conserva: un coach nunca adopta filas
legacy/unscoped, porque para tenerlas su cuenta habría tenido que ser atleta
antes en ese mismo dispositivo, y ninguna entrega anterior a 1b cambia el rol de
una cuenta existente.

**Esto no relaja nada en servidor.** `resolveCapability` sigue denegando con
`denialReason: 'identity'` ante `unknown` en la ruta role-aware, y
`readEntitlementRecord` sigue distinguiendo `absent` de `unreadable`. La
frontera de seguridad real es la RLS y el gate del servidor; el scope del
cliente es un filtro de lectura local. Autoridad única del predicado:
`roleOwnsLegacySelfData` en `athleteScopeKind.ts`.

## 7. Autorización por membresía

El trabajo son **tres etapas separadas**, no una migración.

### 7.1 Etapa A — reconciliar las policies v2 (`M2`)

Cierra los huecos de §4.2. Sin esto, la equivalencia es inalcanzable por
construcción.

**RPC atómica de alta de atleta**, `security definer`: crea la fila en
`athletes` **y** su membresía en la misma transacción. Resuelve a la vez el
hueco de `insert` y el orden de dependencia (la membresía referencia al atleta,
así que no puede existir antes).

Son **dos caminos con modelos de ejecución distintos**, no una RPC con dos
ramas. La versión anterior de esta spec afirmaba a la vez que la RPC se invoca
con service role y que deriva el usuario de `auth.uid()`; las dos cosas no
pueden ser ciertas, porque con service role no hay `auth.uid()` del usuario.

| Camino | Invocado por | Autorización exigida | Membresía creada |
|---|---|---|---|
| `create_self_athlete` | El **usuario autenticado**, con su propio JWT. `security definer`, deriva `auth.uid()` | `account_role = 'athlete'` **y** ausencia de membresía `self` | `role = 'self'` |
| Alta **managed** y toda mutación administrativa de membresías | **Service role**, desde el endpoint de §7.4 | Autorización administrativa del endpoint, más `account_role = 'coach'` de la cuenta destino | `role = 'coach'` |

Exigir `account_role = 'athlete'` en el alta self es obligatorio y no
redundante: la condición "no tiene membresía `self`" la cumple **también** una
cuenta coach recién creada, así que por sí sola dejaría a un coach fabricarse un
atleta self y romper la invariante de §6.

El índice `athlete_memberships_one_self_per_account` respalda la unicidad **en la
base**, no sólo en la RPC.

**Comparación con la policy legacy.** `athletes_insert` (`007:25`) sólo exigía
`auth.uid() = owner_account_id`: cualquier cuenta podía crear cuantos atletas
quisiera y declararse dueña. La RPC es **estrictamente más restrictiva** —un
atleta self por cuenta, y altas managed sólo para coaches—, y esa asimetría es
deliberada. Por eso la comparación de equivalencia de §7.2 puede arrojar
diferencias legítimas en `INSERT`: se registran como **restricciones
intencionales**, con su caso enumerado, y no se "corrigen" ensanchando la RPC.

Mientras la legacy siga vigente (Entrega 1a), la RPC **estampa
`owner_account_id = auth.uid()`**, para que el atleta nuevo sea visible por
ambas vías y la equivalencia de `SELECT` no se rompa durante la ventana.

**Camino de borrado — decidido, no diferido.** `athletes` no tiene `delete` por
membresía, y §7.2 exige equivalencia de `DELETE`, así que dejarlo abierto sería
una contradicción. Se resuelve con una **RPC de borrado** simétrica a la de
alta:

- Exige membresía `role = 'coach'` del invocador sobre ese atleta.
- **Rechaza el borrado de un atleta con membresía `self`**: eliminar la propia
  identidad de atleta no es una operación de roster sino de cuenta, y tiene su
  propio flujo.
- Es el punto de entrada del borrado duro de roster que ya existe, con su
  tombstone, barrera y purga transaccional; no los reemplaza.

La equivalencia de `DELETE` se evalúa entonces contra **el camino RPC**, no
contra una policy, y así queda registrado en la comparación.
- **Ampliar la escritura self** en `coach_proposals`, `training_plans` y
  `training_plan_weeks`, hoy restringidas a `auth_coach_athlete_ids()`, para que
  un self conserve Plan Builder y propuestas sobre su propio atleta.

### 7.2 Etapa B — backfill y equivalencia

- **Backfill idempotente**, que sólo escribe membresías. No borra, no
  transfiere, no re-parenta.
- **Comparación simétrica, por par (tabla, comando).** Dos consultas que deben
  devolver **cero filas**: accesos que la legacy concede y la membresía no, y
  accesos que la membresía concede y la legacy no concedía. La segunda dirección
  detecta que se concedió de más. La comparación es por comando porque `013b`
  usa conjuntos distintos según el comando; una comparación global daría un falso
  cero.
- **Cobertura de `SELECT`, `INSERT`, `UPDATE` y `DELETE`, incluida la cláusula
  `WITH CHECK`.**
- **`INSERT` y `DELETE` sobre `athletes` se comparan contra las RPC de §7.1, no
  contra una policy**, y sus diferencias pueden ser **restricciones
  intencionales** (un self por cuenta; altas managed sólo para coaches; borrado
  vetado sobre un atleta self). Cada una se enumera y se firma como tal. Una
  diferencia sin caso enumerado sigue siendo un bloqueante.

### 7.3 Etapa C — el corte (`M3`)

Retira las policies legacy. Después, "tener acceso" significa exactamente "tener
una fila en `athlete_memberships`".

Precondiciones, todas obligatorias. **`M3` no se ejecuta si alguna falla o si
aparece un caso ambiguo.**

1. Etapa A aplicada.
2. Backfill idempotente ejecutado.
3. **Cero diferencias inexplicadas** en las dos consultas de equivalencia, para
   las cuatro operaciones. Para `INSERT` y `DELETE` sobre `athletes`, que las RPC
   de §7.1 reemplazan con un contrato **más restrictivo**, la diferencia
   observada debe **coincidir exactamente** con la lista de restricciones
   enumeradas y aprobadas: ni una de más, ni una de menos. Una diferencia sin
   caso enumerado, o un caso enumerado que no aparece, es bloqueante por igual.
4. **Código ya desplegado** de rol, scope de tres estados y autorización por
   membresía. La base no se corta contra un bundle que no la entiende.
5. **Copia exacta de las policies vigentes extraída de `pg_policies`** —no del
   repo (§4.8)— y una migración de rollback (`M4`) que las restaure literalmente.
6. **`M3` transaccional**, seguida de inmediato por sus smokes: self permitido,
   coach vinculado permitido, coach no vinculado 403, membresía revocada 403,
   escritura sobre atleta ajeno rechazada.

**Qué significa una diferencia distinta de cero.** Puede ser defecto del
backfill —falta una membresía— **o de la policy v2** —le falta un comando o un
conjunto—. Las dos causas son posibles y se diagnostican por separado: una se
corrige escribiendo membresías, la otra volviendo a la Etapa A.

**Lo que el corte no hace:** no cambia **quién** debería tener acceso. Reemplaza
el fundamento técnico de una autorización equivalente.

### 7.4 El escritor de membresías

`athlete_memberships` no tiene policies de escritura, así que **toda** mutación
pasa por RPC `security definer`. Pero no todas se invocan igual, y confundirlo
fue un error de la ronda anterior:

| Mutación | Invocación | Cómo se autoriza |
|---|---|---|
| `create_self_athlete` (§7.1) | El usuario, con su JWT | Dentro de la RPC, desde `auth.uid()`: rol `athlete` y ausencia de self |
| Alta managed, vínculo coach–atleta, revocación | Service role | **Por el endpoint que la invoca**, no por la RPC |

**El service role protege la tabla, no al invocador.** El camino que invoque las
RPC administrativas debe tener autorización propia — herramienta operacional
fuera de la app, o endpoint con allowlist explícita siguiendo el patrón de
`OPERATIONS_ADMIN_USER_IDS`, incluida su limitación conocida de que revocar
exige redeploy.

La RPC que corre con el JWT del usuario es la excepción deliberada: es la única
mutación que un usuario puede pedir sobre sí mismo, su autorización es
verificable dentro de la propia función, y por eso no necesita endpoint
privilegiado.

## 8. Cuota delegada

### 8.1 La decisión

`quotaBucketId` **sigue siendo canónico** (`chat`, `plan_builder_week`, …), así
que la comprobación de `usageGate.ts:211` queda intacta.

```ts
/**
 * Delegación activa y su tope. `null` = no hay tope por atleta, sea porque el
 * actor obra sobre sí mismo o porque el bucket no declara `perSubjectLimits`.
 * Nunca se usa `null` para decir "clase no permitida": eso lo dice `limit`.
 */
quotaSubject: { athleteId: string; limit: number } | null
```

La unión explícita resuelve la ambigüedad de la ronda anterior, donde `null`
significaba dos cosas. `limit` dentro de `quotaSubject` es **siempre** un entero
positivo. **El gate no re-resuelve el tope por atleta**: lo consume de la
decisión, igual que ya hace con `quotaBucketId` y `limit`.

| Actor | `entitlementSource` | `quotaOwnerUserId` | `quotaSubject` |
|---|---|---|---|
| Atleta sobre sí mismo | `self` | actor | `null` |
| Coach sobre atleta vinculado, bucket con tope | `coach` | coach | `{ athleteId, limit }` |
| Coach sobre atleta vinculado, bucket sin tope | `coach` | coach | `null` |
| Coach sobre atleta **no** vinculado | — | — | denegado |

### 8.1.1 Cómo `resolveCapability` conoce el vínculo sin dejar de ser pura

`resolveCapability` es un módulo puro que importan tanto las Functions como el
cliente; no puede consultar la base. La relación entra por parámetro, **ya
verificada por el llamador**, exactamente como hoy entra `entitlement`:

```ts
export interface ResolveCapabilityInput {
  actorUserId: string
  targetAthleteId: string | null
  capability: AIRequestClass
  now: number
  entitlement: EntitlementRow | null
  accountRole: AccountRole
  /**
   * Membresía del actor sobre `targetAthleteId`, resuelta por el llamador.
   * En servidor sale de la base; en cliente, del espejo local y la decisión es
   * advisoria, igual que la de entitlement. `null` = no hay vínculo conocido.
   */
  membership: { athleteId: string; role: MembershipRole } | null
}
```

Reglas que la función aplica y que la mantienen honesta:

- Si `targetAthleteId` no es `null` y `membership` es `null` → **denegado**. La
  ausencia de vínculo nunca se interpreta como "actúa sobre sí mismo".
- Si `membership.athleteId !== targetAthleteId` → **denegado**. Impide que un
  llamador pase una membresía sobre otro atleta.
- La delegación exige `accountRole === 'coach'` **y** `membership.role === 'coach'`.

**El servidor es la única autoridad.** La decisión del cliente sirve para
mostrar la oferta antes de gastar una request; nunca para autorizar. Es la misma
división que ya rige para entitlements.

### 8.2 Reserva

`ai_usage_daily` extiende su PK a
`(user_id, usage_date, bucket_id, subject_athlete_id)`, con
`subject_athlete_id text not null default ''`. La fila global es la de
`subject_athlete_id = ''`; las filas delegadas llevan el id del atleta.

- **`quotaSubject === null`** → se reserva **sólo** la fila global. Es
  exactamente el comportamiento de hoy.
- **`quotaSubject !== null`** → se reservan global y subject **atómicamente**:
  una sola sentencia con dos filas, cada una con su guard de límite.

**Agotar la cuota no es un error del servidor.** La versión anterior de esta
spec convertía "no volvieron dos filas" en excepción, y toda excepción de la RPC
se traduce hoy a `503 server_error`: eso habría transformado un
`429 quota_exceeded` legítimo en una caída, perdiendo el mensaje correcto para
el usuario y ensuciando la telemetría de errores.

La separación queda así:

Un SQLSTATE de PostgreSQL tiene **exactamente cinco caracteres**, así que
`quota_exceeded:account` no puede serlo. El código y el scope viajan separados:

```sql
raise exception using
  errcode = '45001',            -- clase 45: definida por el usuario, sin uso en PostgreSQL
  message = 'quota_exceeded',
  detail  = 'account';          -- o 'subject'
```

| Situación | Mecanismo | Respuesta |
|---|---|---|
| Un guard de límite no concedió | `RAISE` con `errcode = '45001'` y el scope en `DETAIL` | **`429 quota_exceeded`**, con el scope tomado de `DETAIL` |
| Cardinalidad imposible, RPC ausente, red caída, JSON ilegible, cualquier otro SQLSTATE | Excepción no reconocida o fallo de transporte | `503 server_error` |

**La clasificación se hace sobre el cuerpo de error de PostgREST, no sobre el
status HTTP.** PostgREST devuelve `code`, `message`, `details` y `hint`; la
Function compara `code === '45001'` y lee el scope de `details`. Apoyarse en el
status que PostgREST elija sería frágil y ajeno a nuestro contrato.

Un `45001` con `DETAIL` ausente o distinto de `account`/`subject` **no** se
adivina: es `503`. Un código que no reconocemos nunca se degrada a 429.

**El rollback es el mecanismo; la clasificación viene del código, no del hecho
de que haya lanzado.** Lanzar es lo que garantiza el both-or-neither: la
transacción de la función se revierte y no queda ninguna fila incrementada. El
llamador distingue por el código reservado y nunca por la mera presencia de una
excepción.

Propiedades conservadas: **both-or-neither sin ventana** (no existe "cobré el
global y falló el del atleta"), **sin reembolso ni cobro fantasma** (un rechazo
revierte y no incrementa nada), y **fail-closed** para todo lo que no sea un
rechazo de cuota tipado.

El scope del rechazo importa para el copy: agotar el tope **del atleta** no es
lo mismo que agotar el **del coach**, y el mensaje debe decir cuál fue.

### 8.3 Contabilidad: sólo la fila global

Para no duplicar nada (§4.4), la fila subject es **un limitador de tasa, no una
fila contable**:

- **El costo se registra únicamente en la fila global.** `increment_ai_usage_cost`
  filtra `subject_athlete_id = ''`. Las filas subject conservan costo `0`.
- **El spend cap lee sólo la fila global.** `read_ai_usage_spend` filtra igual.
- **Las métricas leen sólo la fila global.** `read_operations_metrics` filtra
  igual, o `/ops` reportaría el doble.
- **El preflight comprueba ambos contadores.** Es lectura y su propósito es
  evitar encolar un job que el worker rechazará; si ignorara el tope por atleta,
  dejaría pasar justo el caso que la delegación introduce.

Doble protección deliberada: el costo se escribe sólo en la global **y** los
lectores filtran. Un defecto en un lado no corrompe el otro.

**Guard de drift:** una lista única de consumidores de `ai_usage_daily`, con un
test que falla si aparece uno que no filtra por `subject_athlete_id` —mismo
precedente que `WHOOP_WORKOUT_ZONE_COLUMNS`.

### 8.4 De dónde sale cada límite

El **global del coach** es el límite de su bucket para su tier, tal como hoy:
`bucketLimitForTier(bucket, tier)`. Sin lógica nueva.

El **tope por atleta** es un valor nuevo y **provisional por construcción**,
igual que el resto de las cuotas mientras la Fase 0 del Proyecto 1 siga abierta.
`QuotaBucket` gana `perSubjectLimits?: Partial<Record<Tier, number>>`; si un
bucket no lo declara, `quotaSubject` es `null` y sólo rige el global. Dos reglas
estructurales, independientes del número elegido:

- **El tope por atleta es estrictamente menor que el global.** Un valor `>=` es
  error de configuración, no un permiso más amplio; hay un test que lo prohíbe.
- **`null` en `limit` sigue significando "el plan no permite la clase"**, nunca
  `0`. La regla del Proyecto 1 se conserva sin cambios.

Fijar los números concretos es trabajo de la Fase 0, no de esta spec.

### 8.5 Lo que esto no resuelve

Sigue contando **intentos del proveedor**, no unidades de producto. La deuda del
Proyecto 1 §7 continúa abierta y es requisito antes de self-serve, no antes del
piloto.

## 9. Migraciones

Numeración **simbólica** hasta el plan de implementación, que asigna los números
reales a partir de `028` (el repo llega a `027`). Lo que no puede cambiar es el
orden.

| Símbolo | Contenido | Entrega |
|---|---|---|
| `M0` | `account_role` en `user_entitlements` | 1a |
| `M1` | PK ampliada de `ai_usage_daily` + los cinco consumidores de §4.4 + RPC de reserva dual con rechazo tipado | 1a |
| `M2` | Reconciliación de policies v2 (§7.1) + RPC atómica de alta **y** de borrado de atleta | 1a |
| `M3` | Corte: retiro de las policies legacy | 1b |
| `M4` | Rollback literal de `M3`, escrito antes de aplicarlo | 1b |

## 10. Entregas

### Entrega 1a — auditoría, sin cambiar quién tiene acceso

`M0`, `M1`, `M2`. Rol de tres estados, bootstrap ordenado, scope explícito,
`resolveCapability` con delegación y camino de escritura de membresías.
`COACH_AUTHZ_MODE = 'audit'`: la decisión por membresía se calcula y se
registra, pero la decisión efectiva sigue siendo la de hoy. Backfill idempotente
y las dos consultas de equivalencia.

Salida: evidencia de qué habría denegado la barrera nueva, y equivalencia con
**cero diferencias inexplicadas** en las cuatro operaciones — entendiendo por
inexplicada toda la que no coincida exactamente con las restricciones
intencionales enumeradas y aprobadas de §7.1.

### Entrega 1b — corte

`M3` con sus seis precondiciones cumplidas y `M4` escrita de antemano.
`COACH_AUTHZ_MODE = 'enforce'` y los cinco smokes de §7.3.6. **No transfiere el
roster ni cambia quién debe tener acceso.**

### Entrega 2 — experiencia

Cuenta coach nueva y vacía, onboarding sin atleta self, rutas separadas
(`/coach/*` fuera del shell de atleta), selector de atleta gestionado sobre
`coachScopedReads`/`coachScopedWrites`, y transferencia del roster por
membresías. Retiro de `VITE_COACH_ACCOUNTS`.

## 11. Verificación

Además del gate local habitual (lint, tests, `tsc -b`, build, `git diff --check`):

- **Precondición de `013`**: confirmar en producción que las tablas existen y
  que las policies de `013b` están **activas** en `pg_policies`, no sólo escritas.
- Tests de `resolveCapability` para las cuatro filas de §8.1, incluido que un
  `targetAthleteId` sin membresía deniega.
- Test de que `quotaBucketId` sigue siendo canónico y de que el gate no
  re-resuelve el tope por atleta.
- Test de que el tope por atleta es estrictamente menor que el global.
- Guard de drift de los consumidores de `ai_usage_daily` (§8.3), verificado **no
  vacuo**.
- Test de que una cuenta `coach` nunca alcanza scope `self` ni adopta filas
  legacy, y de que `none` y `unknown` fallan cerrado.
- Test de que un fallo de lectura del rol produce `unknown` **en cliente**, y de
  que en servidor la degradación a `athlete` deniega toda capacidad de coach y
  toda delegación (§5.1).
- Tests de `resolveCapability` sobre la relación: `membership` en `null` con
  `targetAthleteId` presente deniega; `membership.athleteId` distinto del
  objetivo deniega; delegación exige rol coach **y** membresía coach (§8.1.1).
- **Test de que agotar la cuota devuelve `429`, no `503`**, en los dos scopes
  (`account` y `subject`), y de que un fallo sin código reservado sí es `503`
  (§8.2). Verificado no vacuo.
- Test de que la RPC de borrado rechaza un atleta con membresía `self`.
- Las dos consultas de equivalencia, por par (tabla, comando), con **cero
  diferencias inexplicadas**: correspondencia exacta y bidireccional entre lo
  observado y las restricciones intencionales enumeradas de §7.1.
- Test de que `create_self_athlete` rechaza a una cuenta `coach` (§7.1).
- Test de que un fallo de lectura del rol produce `503` en servidor y **nunca**
  habilita capacidades de tier `free` (§5.1).
- Los cinco smokes post-`M3`.

## 12. Huecos declarados

1. **El atleta con cuenta propia no consiente el acceso dentro de la app.** Los
   vínculos a cuentas reales se crean por el camino administrativo durante el
   piloto. Aceptable mientras el único atleta vinculado sea el propio owner;
   deja de serlo con el primer cliente externo, y ahí entra SP1b.
2. **La cuota sigue contando intentos, no producto** (§8.5).
3. **`M3` no tiene rollback trivial.** La mitigación es `M4`, no la
   reversibilidad del corte.
4. **El re-sync completo al cambiar de cuenta** es un costo de UX aceptado.
5. **`GLOBAL_DAILY_SPEND_CAP_USD` sigue en US$5**, dimensionado para 1–3
   personas y sin revisar para un coach con cartera.
6. **La capacidad del Asistente para todo coach es provisional** (§5.3) y se
   revisa cuando el producto Coach tenga plan propio.
