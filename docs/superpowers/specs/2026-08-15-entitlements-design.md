# Entitlements por plan — diseño

Fecha: 2026-08-15
Estado: aprobado para plan de implementación
Roadmap: §Pre-Lanzamiento, punto 2 (blocker P0)

## 1. Problema

`PricingPage.tsx` publica tres planes con precios reales en CLP —0 / 12.990 /
24.990 mensual— y **los tres CTA llaman a la misma función** (`handleAccess` →
Google sign-in → app completa). No existe ninguna noción de plan, tier ni
suscripción: ni en Dexie, ni en Supabase, ni en los tipos. Cualquiera que se
registre obtiene Plan Builder, Week Creator y chat sin límite real.

Las cinco flags que hay hoy —`VITE_ATHLETE_SCOPE`, `VITE_COACH_ACCOUNTS`,
`VITE_CONSENT_GATE`, `VITE_DEV_TOOLS`, `VITE_SHOW_PLAN_QUALITY`— son flags de
**build** más una allowlist por email. `coachAccess.ts` declara en su propio
comentario no ser una barrera de seguridad. Ninguna sirve como entitlement.

Este diseño cierra el gate de acceso. **No** cierra el contador de cuota
durable, que es el punto 3 del roadmap y va en el bloque siguiente.

## 2. Decisiones tomadas

| Decisión | Valor | Por qué |
|---|---|---|
| Cantidad de tiers | 3: `free` / `weekly` / `advanced` | Las tres features caras ya están partidas por `AIRequestClass`; el gate cae sobre costuras existentes y `/pricing` deja de mentir |
| Alcance del tier | Por cuenta (`user_id`), cubre sus atletas gestionados | Los gestionados no tienen login: son datos de la cuenta. Único modelo consistente con la RLS por `user_id`, que es la barrera real |
| Asignación durante beta | Manual, service role, tras confirmar transferencia | Todos pagan desde el día 1; no hay cortesía ni trial |
| Período de prueba | **Ninguno** | Un Free es un Free indefinido, no un trial vencido |
| Ausencia de fila | `free` | Nadie que backfillear, un registro nuevo no escribe nada, y el fail-closed sale natural |
| Vencimiento | `free`, sin borrar la fila | Queda el registro de que pagó |
| Fallo de lectura | `free` en servidor; en cliente, espejo confirmado y vigente, si no `free` | Fail-closed literal donde está la autoridad. El espejo solo evita castigar a un usuario pago con red mala (§5.1) |
| Forma de la tabla | Una fila por usuario, no log append-only | Solo se consulta el estado actual; el historial de pagos vive en el banco |
| Columna `note` | Interna, fuera del grant al cliente | Es conciliación operacional; no tiene por qué viajar al navegador del usuario del que habla |

**Premisa que cambia el diseño de la UX:** el owner lanzará a chats cercanos de
squash con pago real desde el primer momento, así que **la mayoría de los
usuarios de beta se quedará en Free**. El gate de Free es el camino principal,
no el borde. La experiencia Free tiene que sostenerse sola y el upsell tiene que
leerse como oferta.

## 3. Modelo de datos

### 3.1 `supabase/020_user_entitlements.sql`

```sql
create table if not exists public.user_entitlements (
  user_id    uuid primary key,
  tier       text not null check (tier in ('free','weekly','advanced')),
  expires_at timestamptz,
  source     text not null default 'manual',
  note       text,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `updated_at` no puede depender de que quien escribe se acuerde.
create or replace function public.touch_user_entitlements() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_entitlements_touch on public.user_entitlements;
create trigger user_entitlements_touch
  before update on public.user_entitlements
  for each row execute function public.touch_user_entitlements();

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own on public.user_entitlements
  for select using (auth.uid() = user_id);

-- `note` es comentario operacional interno y NO se expone. RLS filtra filas,
-- no columnas: la restricción por columna es un grant.
revoke all on public.user_entitlements from anon, authenticated;
grant select (user_id, tier, expires_at, source, granted_at, updated_at)
  on public.user_entitlements to authenticated;
```

**Sin políticas de `insert`, `update` ni `delete`.** Lo que RLS no permite, no
ocurre: solo el service role escribe, así nadie se auto-asciende. Es la misma
postura de `017_user_consents`.

`expires_at` nulo significa sin vencimiento.

`note` guarda la conciliación manual ("transferencia 15-ago, Juan P.") y queda
**fuera del grant**: es texto operacional interno y no tiene por qué viajar al
navegador del usuario del que habla. RLS filtra filas, no columnas, así que la
restricción tiene que ser un `grant` por columna — un `select *` desde el cliente
falla, y por eso el helper del servidor pide columnas explícitas (§4.2).

### 3.2 Orden de tiers

Orden total `free(0) < weekly(1) < advanced(2)`. Toda comparación es
"¿alcanza el mínimo?", nunca igualdad.

### 3.3 Mapa clase → tier mínimo

Vive en un módulo bajo `src/` para que las funciones Netlify lo importen sin
arrastrar código de `netlify/` al bundle del cliente — precedente
`WHOOP_WORKOUT_ZONE_COLUMNS` (§25).

El tipo es **`Record<AIRequestClass, Tier>` exhaustivo**: TypeScript falla en
compilación si se agrega una clase sin entrada.

| Clase | Tier mínimo | Razón |
|---|---|---|
| `chat_general` | `free` | Base promete hablar con el coach |
| `chat_action` | `free` | Ajustes puntuales sobre lo que ya existe |
| `import_extract` | `free` | On-ramp barato; no crea planificación nueva |
| `weekly_summary` | `weekly` | `/pricing` lo lista en Coach Semanal; es generación recurrente |
| `week_creator` | `advanced` | Genera una semana completa; no debe degradarse a sesiones locales para tiers inferiores |
| `plan_builder_week` | `advanced` | |
| `plan_builder_pair` | `advanced` | |

**Clase desconocida se deniega para todo tier, incluido `advanced`.** El
`Record` cubre el tiempo de compilación; una cadena que llegue por la red fuera
de la unión no tiene mínimo definido y `isClassAllowed` devuelve `false` sin
consultar el orden de tiers. El default nunca es permitir, y tampoco es
"permitir al que más paga".

### 3.3.1 Competition Plan: consulta conservada, planificación restringida

Un atleta que baja a Free conserva la consulta de un plan ya materializado:
`/competition-plan` muestra el dashboard y sus accesos a las semanas y al
coach en modo **solo lectura**. No puede editar el evento, iniciar un ciclo
nuevo ni eliminar ciclos archivados. Si no existe un plan activo materializado,
la ruta no muestra el wizard: presenta un CTA de Avanzado antes de pedir datos.
La condición utiliza el mismo requisito de `plan_builder_week`, por lo que el
recorrido no deriva entre Free y Coach Semanal.

### 3.4 Invariante load-bearing: `create_week` fuera de `chat_action`

`responseNormalizer.ts:214` ya filtra `create_week` de las respuestas
`chat_action`. Hoy es una regla de calidad. **Después de este bloque es una
barrera de negocio**, porque es lo que impide que un Free obtenga una semana
generada por la vía del chat.

Va con un test de regresión cuyo nombre declare explícitamente que es una
barrera de negocio, para que nadie lo retire sin entender qué abre.

## 4. Enforcement server-side

### 4.1 Módulo puro compartido

`src/services/entitlements/` expone funciones totales y sin efectos:

- `TIER_ORDER`, `REQUEST_CLASS_MIN_TIER`
- `resolveTier(row, now)` — aplica vencimiento; fila ausente o vencida → `free`
- `isClassAllowed(tier, requestClass)` — deniega clases desconocidas

### 4.2 Helper de servidor

`netlify/functions/_shared/resolveEntitlement.ts`:

- `GET /rest/v1/user_entitlements?select=tier,expires_at` **con el token del
  usuario**. Columnas explícitas, nunca `select=*`: `note` está fuera del grant
  (§3.1) y pedirla haría fallar la consulta entera.
- RLS filtra por `auth.uid()`, así que la llamada no necesita conocer el `userId`
  de antemano: corre en `Promise.all` con el `GET /auth/v1/user` que las tres
  funciones ya hacen. **Latencia añadida ≈ 0.**
- Cualquier error de red, parse, timeout o tabla ausente → `free`.

### 4.3 Puntos de enganche

Son **tres**, no dos:

| Función | Dónde | Detalle |
|---|---|---|
| `coach.ts` | Después de `resolveAuthContext` y `enforceRateLimit`, antes del proveedor | Cubre las 7 clases |
| `enqueue-plan-generation.ts` | **Antes** de escribir el `jobId` | Para no dejar jobs huérfanos |
| `generate-plan-background.ts` | Inmediatamente después de `resolveAuthContext`, antes de cualquier llamada al proveedor | Exige `advanced`; ver §4.3.1 para la terminalización |

**Por qué el tercero es obligatorio y no defensa en profundidad.**
`generate-plan-background` acepta llamadas autenticadas directas y **acuña su
propio `jobId`** cuando el payload no trae uno; el comentario en el código lo
declara como ruta soportada ("only mint a new one when invoked directly (e.g.
legacy path / local tooling)"). Su única barrera hoy es `resolveAuthContext`, que
solo verifica que haya sesión válida. Gatear únicamente el enqueue dejaría el
gate con una puerta trasera documentada: un `POST` directo con un token de
cualquier cuenta Free dispara la generación completa.

Para un Free que intenta Plan Builder, esta lectura ahorra una corrida completa
de generación.

### 4.3.1 El worker rechazado tiene que terminalizar el job

Dos chequeos independientes sobre el mismo flujo abren una carrera que hay que
cerrar explícitamente.

`enqueue-plan-generation` escribe el plan como `generating` con su `jobId`
**antes** de invocar al worker (comentario en el código: *"Durable write BEFORE
kicking off the worker"*), y su `catch` limpia únicamente si `invokeBackground`
falla. Una vez que Netlify responde 202, el enqueue devuelve 200 y deja de
observar. Si el worker rechaza por entitlement, **nadie marca el plan**: queda en
`generating` hasta que el detector de stalled lo levante a los 5 minutos.

Y esto no requiere mala fe ni un cambio de tier entre las dos llamadas: como la
lectura de entitlement es fail-closed (§4.2), **un error transitorio de red en el
worker basta** para que un usuario `advanced` legítimo quede con un plan colgado.

Contrato del worker en el camino de rechazo:

1. Puede crear el writer, pero **solo para terminalizar un job ya encolado** —
   nunca para iniciar trabajo.
2. Si el entitlement rechaza y `body.jobId` **coincide** con el
   `generationSummary.jobId` del plan persistido, marca ese plan `failed` con
   `completedAt`, y no llama al proveedor.
3. Si no hay `body.jobId`, o no coincide con el plan persistido, o no hay plan:
   **no escribe nada**. Es el caso de la invocación directa de §4.3, y escribir
   ahí le daría a un atacante una primitiva para marcar planes ajenos.
4. La comparación exige leer el plan (`getPlan`), lo cual está permitido: la
   restricción es sobre escribir, no sobre leer.

El patrón es el mismo que el bloque `durableWrite` que `enqueue-plan-generation`
ya usa en su `catch`, así que no introduce una forma nueva de limpieza.

**Fuera de alcance, declarado:** no se agrega un outcome nuevo a la taxonomía de
`plan_generation_jobs` (`016`) para el rechazo por entitlement. El estado del
plan es lo que el cliente consulta, y ampliar la taxonomía arrastra el guard de
drift de la migración. Queda en el log de consola.

### 4.4 Orden de chequeos — no negociable

```
1. auth
2. entitlement: ¿el tier alcanza el mínimo de la clase?   → no: 403 entitlement_required
3. cuota diaria de la clase permitida                     → no: 429 daily_quota
4. proveedor
```

**La cuota solo se evalúa sobre clases ya permitidas.** Representar una clase
bloqueada como cuota `0` produciría `daily_quota` —"alcanzaste tu límite de
hoy"— cuando el mensaje correcto es "esto está en Avanzado". El usuario recibiría
una oferta equivocada y volvería mañana esperando que se hubiera renovado.

### 4.5 Contrato del error

`403` con código tipado nuevo `entitlement_required` en `TechnicalErrorCode`.
Se eligió 403 sobre 402 porque el cliente ya rutea por `errorCode` y 402 tiene
soporte irregular.

El error transporta **metadata tipada**, no texto:

```ts
EntitlementRequiredError · { requestClass, requiredTier, currentTier }
```

Productor y consumidor **comparten módulo**, igual que `dailyQuotaError.ts`
(§28): el acoplamiento por string ya causó un defecto en este proyecto y no se
repite. Cambios necesarios:

- `makeError` gana un `detail` opcional que se serializa en el body del 403.
- `ProxyProvider` lo parsea y lo cuelga de `AIProviderError`.
- `enqueue-plan-generation` y `generate-plan-background` devuelven la misma forma.

### 4.6 Dos puntos aplanan el 403, y hay que arreglar los dos

Hoy `normalizeError` (`coach.ts:496`) hace:

```ts
if (statusCode === 401 || statusCode === 403) {
  return makeError(message, statusCode, 'unauthorized')
}
```

Eso **descarta el `errorCode` original y cualquier `detail`**. Sin cambiarlo, un
`entitlement_required` sale del servidor convertido en `unauthorized`, que el
cliente rutea como sesión inválida: el usuario Free vería un error de sesión al
tocar Plan Builder, y la metadata tipada de §4.5 nunca llegaría. La feature
quedaría rota en silencio, sin fallar ningún test que hoy exista.

El requisito es explícito: `normalizeError` **preserva** `errorCode` y `detail`
cuando ya vienen definidos, y solo cae a `unauthorized` para un 401/403 sin
código propio.

**El cliente tiene el mismo defecto, de forma independiente.**
`ProxyProvider.throwHttpError` (`ProxyProvider.ts:325`) hace:

```ts
if (res.status === 401 || res.status === 403) {
  throw createProviderError('gemini', data.errorCode === 'misconfigured' ? 'misconfigured' : 'unauthorized', message)
}
```

Es decir: aunque el servidor preserve `entitlement_required` correctamente, el
cliente lo vuelve a aplanar a `unauthorized` al recibirlo. **Arreglar solo el
servidor no produce ningún cambio observable.** Los dos puntos se corrigen
juntos o el trabajo no sirve.

Ambos van con test dedicado, porque son puntos donde un refactor futuro puede
volver a aplanarlos sin que nada más se rompa. `AIErrorCode` (cliente) y
`TechnicalErrorCode` (servidor) suman `entitlement_required` como valor.

## 5. Cliente

### 5.1 Espejo local

**Dexie v20**, tabla `entitlements: 'userId'` — una fila, espejo de lo que el
servidor confirmó. Nunca se escribe un tier que no vino de Supabase.

El espejo **conserva `expiresAt`** y la resolución local aplica el vencimiento:
un registro vencido resuelve a `free` sin necesidad de red. Sin eso, un espejo
rancio otorgaría el tier para siempre.

Hidratación en el bootstrap autenticado, junto a la del consentimiento.

### 5.1.1 Reconciliación — las tres respuestas son distintas

Un espejo que solo sabe escribir se vuelve mentira en cuanto alguien baja de
plan. La hidratación distingue tres casos y **ausencia remota no es lo mismo que
fallo de lectura**:

| Respuesta remota | Acción sobre el espejo | Tier resuelto |
|---|---|---|
| 200 con fila | Escribir/actualizar | El de la fila, aplicando vencimiento |
| 200 **sin fila** | **Borrar** el espejo de ese `userId` | `free` |
| Error de red / timeout / 5xx | **Conservar** el espejo | El del espejo, aplicando vencimiento |

El segundo caso es el que cierra el downgrade: si dejo el espejo intacto ante una
ausencia confirmada, alguien que dejó de pagar conserva su tier en ese dispositivo
para siempre. Es el mismo razonamiento que §28 aplicó al borrado de atletas —
ausencia remota **confirmada** sí es señal; ausencia por falta de respuesta no lo
es— con la diferencia de que acá el riesgo es de ingreso, no de datos, así que no
hace falta un registro durable de identidades reconocidas.

### 5.1.2 Estado neutro durante la hidratación

El selector expone `{ tier, loading, source: 'remote' | 'mirror' | 'default' }`.

Mientras `loading` es `true` y **no hay espejo**, la UI muestra estado neutro —
no una oferta. Presentar "esto está en Avanzado" durante la hidratación y luego
reemplazarlo por el contenido real es peor que un placeholder: le dice a un
usuario pago que no pagó. El precedente es el flash de "Verificando tus
consentimientos", que el roadmap ya aceptó como comportamiento correcto.

Si hay espejo, se usa de inmediato y la hidratación lo reconcilia después: ahí no
hay estado neutro porque no hay ambigüedad.

### 5.2 El cliente gatea la affordance, el servidor gatea la acción

`triggerBackgroundGeneration.ts` y `ProxyProvider.ts` no bloquean nada — solo
deciden qué se muestra. Si el espejo se desincroniza, la peor consecuencia es un
botón visible que el servidor rechaza con una oferta; nunca una generación no
pagada.

### 5.3 Cuotas locales por bucket

`DEFAULT_DAILY_AI_LIMITS` pasa de constante a buckets resueltos por tier. Un
bucket agrupa clases que comparten un contador.

| Bucket | Clases | free | weekly | advanced |
|---|---|---|---|---|
| `chat` | `chat_general`, `chat_action` | **15 compartidos** | 120 | 120 |
| `import` | `import_extract` | 3 | 10 | 10 |
| `weekly_summary` | `weekly_summary` | — | 10 | 10 |
| `week_creator` | `week_creator` | — | — | 8 |
| `plan_builder_week` | `plan_builder_week` | — | — | 12 |
| `plan_builder_pair` | `plan_builder_pair` | — | — | 6 |

Un bucket con una sola clase es simplemente un contador por clase; el concepto
de bucket existe solo para el chat, que es el único caso donde dos clases
comparten cupo. `plan_builder_week` y `plan_builder_pair` conservan contadores
independientes, como hoy.

Los 15 de Free son **un bucket compartido**, no 15 + 10: el usuario tiene 15
interacciones de chat por día, sin importar si producen acción o no.

Las celdas `—` significan **clase no permitida por entitlement**, no cuota cero.
Nunca se evalúan como cuota (§4.4).

El bucket de chat pagado queda en 120 = 80 + 40, que preserva la capacidad total
de hoy. Es la única cifra de esta tabla que cambia de forma respecto del
comportamiento actual, y se elige para no introducir una regresión.

**Los números de Free (15 y 3) no salen de ningún dato medido.** Están
calibrados a ojo para que la app se sienta viva sin regalar el producto.
Revisarlos con uso real de la beta.

### 5.4 La cuota local tiene que ser account-scoped

`getDailyAIUsage` cuenta filas de `aiRequestLogs` **sin filtrar por usuario**, y
`AITechnicalResult` no tiene campo `userId`. Cerrar sesión tampoco limpia la
tabla. Consecuencia: dos cuentas en el mismo navegador comparten el contador, y
un Free que entra después de un usuario pago hereda su consumo — o al revés,
un pago encuentra su cupo ya gastado por otro.

Hoy eso es un defecto menor porque el límite es informativo. Con tiers pasa a ser
la diferencia entre planes, así que el bucket **tiene que incluir `userId`**:

- `AITechnicalResult` gana `userId` opcional, estampado al crear la fila.
- `getDailyAIUsage` y `assertDailyAIRequestLimit` filtran por el usuario activo.
- Las filas legacy sin `userId` **no cuentan para nadie**. Es lo contrario del
  criterio de athlete scope, donde legacy pertenece al self: acá contar filas
  ajenas castiga a un usuario por consumo que no hizo, y el costo de no contarlas
  es una ventana única de cupo extra tras el deploy.

Esto es cuota **local y provisional**; el contador durable del punto 3 la
reemplaza. Se arregla igual porque una cuota que se confunde de cuenta es peor
que una cuota floja.

## 6. UX del upsell

Un solo componente, alimentado por `{ requestClass, requiredTier }`: qué hace la
función, en qué plan está, y CTA a `/pricing`. **Nunca un toast rojo.**

- **Plan Builder en Free:** la tarjeta de entrada muestra la oferta en lugar del
  botón. No se llega al error.
- **Chat en Free pidiendo la semana:** la respuesta es la tarjeta dentro del
  hilo.

### 6.1 Dos caminos distintos hacia la misma tarjeta

Hay que distinguirlos porque solo uno produce un 403:

| Camino | Qué pasa | Señal |
|---|---|---|
| El router clasifica "armame la semana" como `week_creator` | `WeekCreatorEngine.sendWeekCreate` llama al servidor con `requestClass: 'week_creator'` | **403 `entitlement_required`** |
| El modelo emite `create_week` por su cuenta en un turno `chat_action` | El normalizador lo filtra antes de que llegue a ejecutarse; el servidor ya respondió 200 | **`filtered_create_week`** (diagnóstico neutro) |

El primero es el camino habitual. El segundo no puede producir 403 porque
`chat_action` **es** una clase Free: el servidor no tiene nada que rechazar.

**El normalizador no conoce el tier, y no debe conocerlo.** `responseNormalizer`
es una función pura de normalización de respuestas; darle acceso al entitlement
lo acoplaría al estado de sesión y volvería su salida dependiente de quién
pregunta. Así que la responsabilidad se parte en dos:

- **`responseNormalizer` emite `filtered_create_week`**, un diagnóstico neutro y
  sin opinión comercial, en el mismo punto donde ya filtra la acción. Lo emite
  **siempre**, para todo tier — es un hecho sobre la respuesta, no sobre el
  usuario.
- **La capa de presentación** lo traduce a la tarjeta de oferta **solo si el tier
  resuelto está por debajo de `advanced`**. Para un usuario pago elegible el diagnóstico se
  ignora y la experiencia es idéntica a la de hoy.

El test correspondiente verifica que **un usuario `advanced` no ve la tarjeta** —
no que el normalizador deje de emitir el diagnóstico. Testear lo segundo
congelaría la violación de capas que este diseño evita.

### 6.2 El 403 no puede llegar crudo al chat

`formatError` (`useChatStore.ts:921`) reexpone `Error.message` tal cual en el
hilo. Ese camino **ya mordió antes**: es el defecto que §21 documenta, cuando un
usuario vio `Ejercicio de fuerza inexistente: xyz`. El código
`entitlement_required` se intercepta antes de llegar ahí, y va con test.

## 7. Rollout

`VITE_*` es build-time en Vite, así que el flag del cliente no se puede
"flipear" sin rebuild. Para que el estado intermedio sea seguro **y** presentable,
el comportamiento del cliente se parte en dos:

- **Reactivo — siempre encendido, sin flag.** Manejar `entitlement_required` y
  traducir `filtered_create_week` a la tarjeta cuando corresponda. No otorga
  nada; solo convierte un rechazo del servidor en una oferta legible.
- **Proactivo — detrás de `VITE_ENTITLEMENTS`.** Ocultar el botón de Plan
  Builder y demás affordances antes de que el usuario las toque.

Con esa partición, el orden seguro es:

1. Aplicar `020_user_entitlements.sql` a mano en producción.
2. **Asignarse `advanced`.** Sin esto, al encender el gate el owner pierde Plan
   Builder en su propia cuenta.
3. Desplegar el bundle con el manejo reactivo incluido y `VITE_ENTITLEMENTS`
   apagada. `ENTITLEMENTS_ENABLED` (servidor, runtime) también apagada: el
   comportamiento es idéntico al de hoy.
4. Encender `ENTITLEMENTS_ENABLED` en el servidor. El gate queda vivo y las
   ofertas ya se renderizan bien por el camino reactivo.
5. Redesplegar con `VITE_ENTITLEMENTS` encendida para sumar el ocultamiento
   proactivo.

**Nunca cliente antes que servidor.** Con el cliente gateando y el servidor
permisivo, la UI oculta el botón pero una llamada directa a la función pasa: el
gate sería cosmético.

## 8. Verificación

No negociables:

- **Guard de drift sobre `AIRequestClass`**: recorre el tipo y falla si una clase
  nueva no tiene entrada en el mapa. Sin esto, agregar una clase la dejaría
  implícitamente en `free`, que es el peor default posible.
- **Regresión de `create_week` en `chat_action`**, con el nombre del test
  declarando que es una barrera de negocio (§3.4).
- Matriz 3 tiers × 7 clases = 21 casos sobre la función pura.
- Clase desconocida → denegada.
- Vencimiento: `expires_at` en el pasado resuelve a `free`, en servidor y en el
  espejo local.
- Orden de chequeos: un Free que toca `plan_builder_week` recibe
  `entitlement_required`, **nunca** `daily_quota`.
- El bucket de chat es compartido: 15 mensajes de `chat_general` agotan también
  `chat_action`.
- El 403 no llega crudo al chat.
- Upgrade Dexie v19 → v20 abriendo primero una base legacy con datos, como exige
  CLAUDE.md.
- **Invocación directa a `generate-plan-background` con token de una cuenta
  Free** → rechazada sin escribir nada y sin llamar al proveedor. Es el test que
  cierra la puerta trasera de §4.3.
- **Enqueue aceptado + fallo de entitlement en el worker** → el plan queda
  `failed` (terminal), cero llamadas al proveedor, y el cliente no depende del
  detector de stalled. Es el test de la carrera de §4.3.1.
- **Rechazo en el worker con `jobId` que no coincide con el plan persistido** →
  no escribe nada: no se puede marcar `failed` un plan ajeno ni uno de otra
  corrida.
- **`normalizeError` preserva `entitlement_required` y su `detail`** en un 403,
  y sigue cayendo a `unauthorized` para un 403 sin código propio (§4.6).
- **`ProxyProvider.throwHttpError` preserva `entitlement_required`** en un 403
  en vez de aplanarlo a `unauthorized`, y sigue aplanando un 403 sin código
  propio. Test de extremo a extremo: un 403 con `detail` sale del servidor y
  llega al cliente con `requiredTier` intacto (§4.6).
- Reconciliación del espejo, los tres casos por separado: fila presente escribe,
  ausencia confirmada **borra**, error de red **conserva** (§5.1.1).
- Hidratación en curso sin espejo → estado neutro, no oferta (§5.1.2).
- Cuota account-scoped: dos usuarios en el mismo navegador no comparten
  contador, y las filas legacy sin `userId` no cuentan para nadie (§5.4).
- Un usuario `advanced` **no ve la tarjeta** ante un `filtered_create_week`,
  mientras el normalizador sí sigue emitiendo el diagnóstico (§6.1).

## 9. Fuera de alcance

Declarado explícitamente para que no se cuele:

- **Contador de cuota durable server-side** — punto 3 del roadmap, bloque
  siguiente. Durante este bloque un Free que borre IndexedDB recupera su cupo de
  chat; se acepta porque el chat corre en `gemini-2.5-flash` y **lo caro queda
  cerrado desde el servidor desde el día 1**.
- Webhook de pago, prorrateo, autogestión de plan, downgrade automático al
  vencer (hoy simplemente deja de resolver y cae a `free`).
- Historial/auditoría de cambios de tier. Si hace falta, tabla aparte sin tocar
  ésta.
- Período de prueba.
