# Whoop Entrega 3 — zonas de frecuencia cardíaca por entrenamiento

Fecha: 2026-08-07
Estado: diseño aprobado, sin implementar
Migraciones: `019_whoop_workout_zones.sql` (Supabase). **Sin cambio de Dexie.**
Flag de rollout: `WHOOP_ZONES_ENABLED` (server-side, apagado por defecto)
Base: `d91e21e` (Entrega 2 commiteada y pusheada)

---

## 1. Qué problema resuelve

Hoy un entrenamiento registrado por Whoop se describe con duración, strain, FC media/máxima
y distancia. Eso dice *cuánto* y *qué tan cargado*, pero no *cómo se repartió el esfuerzo*.
En squash —el deporte principal del usuario— la diferencia entre un partido de peloteo
sostenido y uno de puntos cortos con pausas largas no aparece en ninguna de esas cifras: los
dos pueden dar 60 minutos y strain parecido.

`zone_durations` responde eso. Whoop reparte la duración del entrenamiento en seis zonas de
frecuencia cardíaca y publica los milisegundos de cada una.

La entrega cubre tres superficies, en este orden: la tarjeta de la sesión, el bloque objetivo
del coach, y el resumen semanal.

## 2. Alcance

**Dentro:**

- Persistir las seis duraciones de zona y `percent_recorded` por entrenamiento.
- Mostrar la distribución en la tarjeta de sesión auto-completada, con detalle desplegable.
- Sumar la intensidad al bloque objetivo del chat.
- Agregar un resumen semanal por día en `WeeklyView`.
- Redactar las versiones nuevas de las publicaciones legales `whoop_biometric` y `privacy`.
- Flag server-side que permita mergear y desplegar **sin ingerir zonas nuevas desde Whoop**
  (§3.4 fija la semántica exacta: es un flag de ingestión, no de visibilidad).

**Fuera, declarado:**

- `kilojoule`, `altitude_gain_meter`, `altitude_change_meter`.
- Objetivos de zona en sesiones planificadas. El producto no los tiene y esta entrega no los
  introduce.
- Comparación persistida entre semanas.
- Backfill histórico más allá de lo que la ventana de sync ya rellena sola.
- **Ingerir zonas para atletas gestionados.** La frase importa entera, porque la anterior
  —"zonas para atletas gestionados"— prometía más de lo que el diseño sostiene. Ver §2.1.
- Publicar los textos legales nuevos. Se redactan acá; se publican después de la revisión
  jurídica.

### 2.1 Qué garantiza exactamente la exclusión de atletas gestionados

Las tres superficies de la Entrega 2 leen por **atleta activo**, no por self:
`DayDetail.tsx:405` consulta `getLocalWhoopWorkoutsInRange(activeAthleteId, …)`,
`ChatCoach.tsx:270` arma el bloque con `athleteIdAtStart`, y `SessionCard.tsx:288` pinta las
métricas de cualquier workout cuyo `workoutId` coincida con el `autoCompletion` de la sesión.
Esta entrega **no las convierte en self-only**, y conviene decir por qué en vez de dejarlo
implícito.

Lo que garantiza la ausencia hoy no es un guard de UI, es que **no existe ruta que escriba
workouts de un gestionado**: el servidor resuelve `resolveSelfAthleteId`
(`whoopSupabase.ts:187`) y estampa ese `athlete_id` en todo upsert, y `pullWorkouts` solo baja
lo que Supabase tiene. La única entrada concebible es un backup fabricado a mano —
`parseWhoopWorkout` (`dataExport.ts:1130`) toma `athleteId` del archivo sin más—, y ese backup
podría traer un workout gestionado **con zonas y con el flag apagado**, coherente con §3.4.

Se decide **no** agregar el guard self-only, por dos razones:

1. No sería un guard de zonas. Recortaría también duración, strain, FC y distancia, que la
   Entrega 2 ya muestra hoy: es un cambio de contrato de una entrega desplegada, metido de
   contrabando en otra.
2. Apunta al lado contrario de SP1. Cuando un atleta con login propio conecte su Whoop, el
   coach **debería** ver esos entrenamientos; un `=== selfAthleteId` cableado en tres
   superficies sería un muro a demoler, no una base.

En consecuencia, la promesa verificable es la más chica y la verdadera, y está escrita en
términos de **cuenta**, no de atleta, para que siga siendo cierta después de SP1: **la cuenta
del coach no puede sincronizar Whoop en nombre de un atleta distinto de su self**. La
ingestión pertenece siempre al self de la cuenta autenticada; las superficies leen por atleta
activo. El día que un atleta con login propio conecte su Whoop, los workouts existirán bajo su
cuenta y podrá compartirlos con su coach — sin que nada de este spec haya que deshacerlo. El
smoke de §10 confirma hoy ese invariante observando ausencia total bajo un gestionado.

Si el owner prefiere el guard duro, es una decisión aparte que alcanza a la Entrega 2 completa
y hay que tomarla sabiendo que SP1 la revierte.

## 3. Gate legal y orden de rollout — Task 0

### 3.1 La brecha ya existe

Dos publicaciones inmutables enumeran los datos recibidos de Whoop, y ninguna menciona
entrenamientos:

- `src/services/legal/publications/whoop_biometric.2026-07-07.ts:21-28` — cuatro viñetas:
  recovery, HRV y FC en reposo, strain, sueño.
- `src/services/legal/publications/privacy.2026-07-13.ts:54-60` — "usamos recovery, HRV,
  frecuencia cardiaca en reposo, strain y datos de sueño".

Ambas describen además el cliente como si replicara solo un resumen diario de readiness.
Desde Dexie v16 el cliente replica también `whoopWorkouts`.

Es decir: **la brecha la abrió `012`, no esta entrega.** Las zonas la ensanchan porque son el
dato más granular tomado hasta ahora.

### 3.2 Qué se redacta

Versiones nuevas de ambas publicaciones más sus espejos Markdown en `docs/legal/`.
**Las publicaciones existentes no se tocan** — son inmutables por contrato del ledger.

Ambos textos deben explicitar:

- que se reciben entrenamientos, con fecha, deporte, duración, FC media y máxima, distancia,
  **distribución de tiempo por zona de frecuencia cardíaca** y **porcentaje de frecuencia
  cardíaca efectivamente registrado por Whoop durante el entrenamiento**;
- que esos datos se guardan en la nube **y se replican localmente en el dispositivo**;
- que alimentan el contexto objetivo del coach de IA.

La cobertura se enumera aparte de la distribución porque es un dato persistido distinto, no
un atributo de ella.

### 3.3 Por qué hace falta un flag

`hasCurrentWhoopConsent` compara la fila del usuario contra
`getCurrentVersion('whoop_biometric')`, importado del **mismo bundle desplegado**
(`consentEnforcement.ts:1,27`), y `runWhoopCron` lo consulta por usuario antes de sincronizar
(`whoopCron.ts:58`). De ahí se siguen dos cosas incompatibles con "mergear ahora, activar
después":

1. Mientras la publicación vieja siga siendo la vigente, el consentimiento viejo **autoriza**
   la sincronización — y si el código de zonas ya está desplegado, cron y sync manual las
   persisten bajo un consentimiento que nunca las mencionó.
2. `main` se despliega automáticamente, así que no hay una ventana en la que el código esté
   mergeado pero no corriendo.

El flag rompe el acoplamiento: `WHOOP_ZONES_ENABLED`, leído del entorno del servidor y
**apagado por defecto**.

### 3.4 Qué significa exactamente el flag

**Es un flag de ingestión, no de visibilidad.** El contrato es "no incorporar zonas nuevas
desde Whoop", y nada más. Apagado no oculta zonas ya persistidas, no impide que un backup
importado las traiga, y no apaga las superficies. Declararlo así evita que alguien lo use
más adelante como kill switch y descubra que no lo es.

De ahí se sigue una exigencia concreta de implementación: **con el flag apagado, el upsert
omite las siete claves**, no las escribe como `null`. `upsertWorkouts`
(`whoopSupabase.ts:300-315`) construye hoy el payload con todas las claves explícitas, así
que escribir `null` haría que apagar el flag **borrara** zonas ya guardadas — un flag de
ingestión que destruye datos al apagarse es una trampa.

Tests que lo fijan:

- flag off + fila sin zonas → sigue sin zonas;
- flag off + fila **con zonas previas** → las conserva;
- flag on → escribe y actualiza las siete columnas.

### 3.5 Orden de rollout

`019` tiene que aplicarse **antes del primer deploy del código**, aunque el flag esté apagado:
`pullWorkouts.ts:91` hace un `SELECT` con lista explícita de columnas, y pedir columnas
inexistentes devuelve 400 en cada pull.

Además, Netlify captura las variables de entorno de Functions **por deploy**, así que cambiar
`WHOOP_ZONES_ENABLED` no basta: hay que crear un deploy nuevo.

0. **Preflight:** confirmar `CONSENT_GATE_ENABLED=true` y `VITE_CONSENT_GATE=true`. Todo el
   fail-closed está condicionado a esas flags (`whoopCron.ts:58`, `ConsentGate.tsx:20`); con
   una apagada, el resto del orden no protege nada.
1. Aplicar `019` en producción. Columnas vacías, nada cambia.
2. **Deploy 1:** código de zonas y publicaciones nuevas **registradas pero no vigentes**
   —`currentVersion` sigue apuntando a las anteriores— con `WHOOP_ZONES_ENABLED=false`.
3. Aprobación jurídica del paquete de dos publicaciones.
4. **Deploy 2:** cambiar ambos `currentVersion` a las publicaciones nuevas.
5. Reaceptación: `privacy` para **todas las cuentas**, `whoop_biometric` solo para cuentas con
   Whoop conectado.
6. **Deploy 3:** `WHOOP_ZONES_ENABLED=true`.

**Consecuencia esperada del deploy 2, no un fallo:** en cuanto la publicación nueva es la
vigente, el consentimiento anterior deja de satisfacer `hasCurrentWhoopConsent` y la
sincronización de Whoop se detiene para quien no haya reaceptado. Es el diseño fail-closed
funcionando. Conviene cerrar el ciclo **antes del piloto**: con una cuenta es un clic, con
clientes es fricción.

## 4. Definiciones y autoridades compartidas

### 4.1 Zona alta

**Zona alta = Z4 + Z5**, es decir lo que está estrictamente por encima de Z3.

Vive en `src/services/readiness/workoutMetrics.ts`, que ya es la autoridad única de
elegibilidad de ritmo:

```ts
export function resolveHighZoneDurationMs(workout: WhoopWorkout): number | null
```

Devuelve `zoneDurations.z4 + zoneDurations.z5` **en milisegundos, sin redondear**, o `null` si
no hay distribución. Las tres superficies lo consumen; ninguna recalcula la definición ni
convierte antes de tiempo.

Los milisegundos son la unidad de autoridad. Cada superficie convierte y redondea **una sola
vez**, en su borde de presentación.

**Por qué una sola declaración:** el hallazgo #4 del code review de la Entrega 2 fue
`WINDOW_DAYS` declarado dos veces en módulos distintos — la ventana que se consultaba y la
que se filtraba eran constantes independientes, y ampliar una sola habría truncado en
silencio sin que ningún test lo notara. La misma trampa aplica acá con más consecuencia: tres
superficies con tres umbrales distintos de "duro" darían tres respuestas a la misma pregunta.

### 4.2 Cobertura de medición

```ts
export const LOW_HR_CAPTURE_NOTICE_THRESHOLD = 90

export type HrCaptureState =
  | { kind: 'unknown' }                     // con zonas, sin percentRecorded
  | { kind: 'full' }                        // >= 100
  | { kind: 'high'; percent: number }       // >= 90 y < 100
  | { kind: 'low'; percent: number }        // < 90

export function resolveHrCaptureState(workout: WhoopWorkout): HrCaptureState | null
```

**Devuelve `null` cuando no hay `zoneDurations`**, aunque `percentRecorded` esté presente. Son
tres ramas, en este orden:

1. sin distribución → `null`;
2. con distribución y sin porcentaje → `unknown`;
3. con distribución y con porcentaje → `full` / `high` / `low`.

La cobertura **se persiste** de forma independiente de la distribución (§5.2, §6.1); lo que
depende de la distribución es **presentarla**, porque la cobertura califica un reparto y sin
reparto no califica nada. Si la función devolviera `unknown` ante la mera ausencia de
porcentaje, todo entrenamiento anterior al flag —que no tiene zonas ni porcentaje— caería en
esa rama, y por §7.2 el coach le agregaría `· cobertura no informada` a entrenamientos que ni
siquiera tienen distribución. `null` en la firma es lo que hace que esa regla no dependa de
que cada superficie se acuerde de mirar `zoneDurations` primero; es también lo que sostiene la
paridad de contenido de §7.1 sin una condición extra.

**El umbral es visual y solo visual.** No descarta zonas, no excluye entrenamientos, no altera
ningún agregado y no participa de ninguna decisión de validez. La API oficial expone
`percent_recorded` y las seis duraciones, pero **no documenta ningún umbral** que convierta
ese porcentaje en válido o inválido; el nombre de la constante lo dice para que nadie lo
reutilice como criterio de calidad.

**El valor es `float`, no entero.** La clasificación usa el valor **crudo**; la presentación
lo **trunca** a un decimal con `Math.floor(percent * 10) / 10`.

El truncamiento no es un detalle de formato, es la única operación que preserva la
clasificación. Redondear `89.96` daría `90,0` y volvería a producir la contradicción que la
separación existe para evitar: un aviso de cobertura baja junto a una cifra que dice 90. Al
truncar, se muestra `89,9%` y el aviso es coherente con lo que se lee.

El copy es `Cobertura de medición Whoop: 89,9%`. No se usa "captó 89,9% de la FC": eso
atribuye una semántica que Whoop no publica.

**Los cuatro estados se resuelven en las tres superficies, pero no todos se muestran.** La
matriz aplica solo cuando hay distribución; `null` no tiene fila porque no produce copy en
ninguna superficie. Está congelada, para que una omisión sea siempre deliberada y no un
olvido:

| Estado | Tarjeta | Coach | Semana |
|---|---|---|---|
| `full` | — | — | — |
| `high` | dato en el desplegable | — | — |
| `low` | aviso cálido bajo la barra | `· cobertura 72.4%` | conteo en el subtítulo |
| `unknown` | dato en el desplegable | `· cobertura ?` | conteo **separado** |

`high` se omite en coach y semana a propósito: entre 90 y 100 la distribución es utilizable y
gastar tokens o espacio en decirlo no cambia ninguna lectura. `low` y `unknown` sí llegan a
las tres, porque avisar solo en la tarjeta permitiría que el coach y el resumen semanal
traten una distribución parcial como completa.

`unknown` **no se oculta**. Si hay zonas pero falta el porcentaje, callarlo hace que las tres
superficies no puedan distinguir "cobertura completa" de "no sabemos". Debería ser raro
—el contrato oficial declara `percent_recorded` requerido dentro de `WorkoutScore`— y
justamente por eso, si aparece, conviene verlo.

**Enmienda (2026-08-08, decisión del owner durante la implementación).** En el coach,
`unknown` emite `· cobertura ?` y no `· cobertura no informada`. La medición del bloque
armado dio +70/+120 tokens contra los ~40 que este spec presupuestaba, y el literal largo
puede repetirse en las ocho líneas: son ~22 tokens por request solo para decir lo que el
signo de pregunta dice al lado de una métrica ya nombrada. **Aplica solo a esta línea.**
La guardia se probó corta por el mismo motivo y **se revirtió al texto completo**: perdía la
premisa de que las zonas son distribución *medida*, sin la cual el modelo puede leer los
minutos por zona como una prescripción. La tarjeta y el resumen semanal conservan el texto
en prosa: ahí el costo es espacio, no tokens por request.

## 5. Modelo de datos

### 5.1 Supabase — `019_whoop_workout_zones.sql`

Siete columnas nullable sobre `whoop_workouts`:

| Columna | Tipo |
|---|---|
| `zone_zero_milli` … `zone_five_milli` | `bigint` |
| `percent_recorded` | `numeric` |

Cinco restricciones `CHECK`:

1. **Todo o nada** — las seis columnas de zona son todas nulas o todas presentes.
2. **No negatividad** — cada zona `>= 0`.
3. **Suma positiva** — zonas nulas, o `zone_zero_milli + … + zone_five_milli > 0`.
4. **Rango** — `percent_recorded` entre 0 y 100.
5. **Solo con score** — zonas y `percent_recorded` solo pueden ser no nulas cuando
   `score_state = 'SCORED'`.

Las restricciones 3 y 5 son las que evitan que la base admita estados que el normalizador
compartido rechaza. El tipo `WhoopWorkout` **no** los rechaza —admite cualquier combinación de
`scoreState` y zonas, y por eso §5.3 mete `scoreState` en la firma del normalizador—; el
`CHECK` es la única barrera que alcanza a una escritura que no pase por ahí. Sin la 3, una
distribución vacía —seis ceros— se podría guardar por otro camino aunque el normalizador la
descarte. La 5 traslada a la base el contrato oficial: `WorkoutScore` solo
existe cuando el entrenamiento está `SCORED`.

Las cinco se agregan sin `not valid`: todas las filas existentes tienen las siete columnas en
`null`, así que satisfacen la rama nula y la validación inmediata no puede fallar.

El invariante existe **en la base además de en el normalizador compartido**. Una escritura
futura por otro camino —un script, una corrección manual, un backfill— no pasa por el
normalizador y, como el tipo tampoco la frena, el `CHECK` es lo único que le impide producir
un estado inválido.

### 5.2 TypeScript y Dexie

```ts
export interface WhoopZoneDurations {
  z0: number; z1: number; z2: number
  z3: number; z4: number; z5: number   // milisegundos
}

export interface WhoopWorkout {
  // …campos existentes
  zoneDurations?: WhoopZoneDurations
  percentRecorded?: number
}
```

Un objeto opcional con seis campos **requeridos**, no seis campos opcionales sueltos. Así el
todo-o-nada deja de ser una convención que hay que recordar en cada consumidor y pasa a ser
una garantía del tipo: no existe forma de representar una distribución parcial.

`percentRecorded` va aparte porque **es independiente**: un entrenamiento puede tener
cobertura válida y zonas descartadas, o zonas completas y cobertura ausente. Descartar las
zonas nunca descarta la cobertura.

**Sin Dexie v20.** Dexie versiona índices, no propiedades. `zoneDurations` y `percentRecorded`
no se indexan, así que `stores()` no cambia y no hay migración local ni test de upgrade.

**Backup: sin cambio de versión, con cambio de parser.** La exportación arrastra los campos
nuevos sola, porque usa `db.whoopWorkouts.toArray()` crudo. La **importación no**:
`parseWhoopWorkout` (`dataExport.ts:1130-1150`) es un allowlist campo por campo y descarta en
silencio lo que no enumera. Sin extenderlo, un round-trip de backup borra las zonas sin
error. Agregar campos opcionales es compatible en ambos sentidos, así que la versión del
backup queda en 4.

### 5.3 Normalizador compartido

Módulo nuevo `src/services/readiness/whoopZoneDurations.ts`, puro y sin dependencias de
entorno:

```ts
export function normalizeWorkoutScoreData(input: {
  scoreState: unknown
  zones: { z0: unknown; z1: unknown; z2: unknown
           z3: unknown; z4: unknown; z5: unknown }
  percentRecorded: unknown
}): { zoneDurations?: WhoopZoneDurations; percentRecorded?: number }
```

**Una sola función devuelve los dos campos juntos, y recibe `scoreState`.** El `CHECK` de
`019` garantiza "solo con `SCORED`" en Supabase, pero el tipo `WhoopWorkout` admite cualquier
combinación: un backup manipulado con `PENDING_SCORE` y seis zonas válidas pasaría un
normalizador que no mira el estado y quedaría en Dexie, donde ninguna restricción lo alcanza.
Con `scoreState` dentro de la firma, la regla no se puede olvidar en un borde.

Si el estado no es `SCORED`, devuelve ambos campos ausentes. Los dos siguen siendo
independientes **dentro** de `SCORED`: ahí una distribución descartada no descarta la
cobertura.

Los tres bordes —normalizador del servidor, pull del cliente, parser de import— **solo
adaptan nombres** al vocabulario de su origen (`score.zone_durations.zone_zero_milli` en la
API, `zone_zero_milli` en la columna, `z0` en el backup) y delegan la decisión. Ninguno
valida a mano, siguiendo la misma doctrina que `normalizeSupersetGroups`.

Netlify ya importa módulos puros desde `src/` —`consentEnforcement.ts:1` lo hace con
`consentDocuments`— así que ubicarlo ahí no agrega infraestructura.

## 6. Normalización y bordes

### 6.1 Regla única

La distribución se descarta **completa** si:

- el `scoreState` no es `SCORED`;
- falta cualquiera de las seis claves;
- alguna **no es un entero seguro** (`Number.isSafeInteger`);
- alguna es negativa;
- **las seis suman cero.**

El requisito es entero seguro, no solo número finito. El origen y la columna son `int64`
—el OpenAPI de Whoop declara las seis duraciones como `integer/int64` y las columnas son
`bigint`—, así que un `1.5` produciría un objeto perfectamente válido en Dexie e
incompatible con la base a la que después se sincroniza.

El último caso es una **distribución vacía**: seis ceros son sintácticamente válidos y no
describen nada. No equivalen a un entrenamiento en reposo —eso sería `z0` con la duración
completa— sino a un entrenamiento del que no se midió ninguna zona.

Descartar la distribución **no** descarta `percentRecorded`, que se valida por separado
(finito, entre 0 y 100).

### 6.2 Redondeo

Los milisegundos se guardan crudos y se convierten solo al presentar.

Quitar una fila "Total" no alcanza para evitar la discrepancia, porque **`Zona alta` ya es un
total visible** de Z4+Z5. Con Z4 = 4:29 y Z5 = 4:29, filas redondeadas a minuto darían
`4 min` y `4 min` junto a un titular de `9 min`.

Por eso las unidades se separan por rol:

- **Filas de detalle: `m:ss`**, con precisión de un segundo — los milisegundos se redondean al
  segundo más cercano. No es el dato intacto (Whoop puede mandar valores no divisibles por
  1000), pero conserva cada minuto entero, que es lo que la comparación entre filas y titular
  necesita.
- **Titulares (`Zona alta`, titular semanal): minutos**, redondeados una vez desde los
  milisegundos crudos, nunca desde los segundos ya redondeados.

`4:29 + 4:29 → 9 min` se lee naturalmente como un resumen, y nada invita a sumar dos enteros
que no cierran.

## 7. Superficies

### 7.1 Tarjeta de sesión

Sobre `WhoopWorkoutMetrics`, que ya existe:

- Métricas en **grilla**: 2 columnas en móvil, 4 en escritorio. Reemplaza el `flex-wrap`
  actual, que con cuatro métricas deja una huérfana colgando.
- Métrica nueva **`Zona alta`**, en color cálido, para que se lea como el titular del recuadro.
- **Barra apilada** de seis segmentos con escala `Z0 → Z5` debajo.
- **Desplegable** separado por divisor, con las seis filas (zona, barra proporcional, `m:ss`)
  en orden Z5 → Z0.
- Cobertura: `low` muestra el aviso cálido bajo la barra; `high` y `unknown` muestran el dato
  neutral dentro del desplegable (`Cobertura de medición Whoop: 92,4%` / `Cobertura de
  medición no informada`); `full` no muestra nada.

**Paridad, definida con precisión.** El cambio de `flex` a `grid` aplica a **todas** las
tarjetas, tengan zonas o no, así que la paridad *visual* estricta es imposible y prometerla
sería falso. Lo que se congela con test es paridad **de contenido**: mismas métricas, mismos
valores, mismo copy, mismo orden, y ningún elemento de zonas presente. La alternativa
—grilla solo cuando hay zonas— se descarta: dejaría dos layouts que mantener y una tarjeta
que se reacomoda sola cuando Whoop termina de puntuar.

**Accesibilidad.** El desplegable es un `<button>` con `aria-expanded`, no un `div`
clickeable. Las barras son decorativas y llevan texto accesible equivalente, de modo que la
distribución sea legible sin ver los colores.

### 7.2 Coach

En `whoopWorkoutContext.ts`, la línea existente suma un dato entre strain y FC:

```
- 05-08 squash · 62 min · strain 12.4 · FC 142/181 · 10 min zona alta → sesion planificada: …
```

**Separador decimal: punto, no coma.** El bloque del coach ya emite `strain 12.4` vía
`metric.value.toFixed(1)` (`whoopWorkoutContext.ts:50`), y esta entrega no cambia la
localización de un texto que va al prompt. La coma queda reservada para la UI (§7.1, §7.3),
que sí escribe en español. El ejemplo de arriba es normativo en ese punto: un plan que copie
`12,4` introduciría un cambio incidental en un formato existente.

Los dos segmentos nuevos son **independientes entre sí y ambos condicionales**:

- `· 10 min zona alta` aparece solo si `resolveHighZoneDurationMs` devuelve un valor.
- `· cobertura 72.4%` aparece solo con `low`; `· cobertura no informada`, solo con `unknown`.
  En `full`, `high` y `null` no se agrega nada — en los dos primeros porque no cambia la
  lectura, en el tercero porque no hay distribución que calificar (§4.2).

Un entrenamiento sin zonas produce entonces **exactamente la línea de la Entrega 2**.

Costo estimado: ~40 tokens sobre los ~280 actuales del bloque.

La guardia se amplía. Además de "strain es carga fisiológica medida, no el esfuerzo declarado",
queda explícito que las zonas son **distribución medida** y que el coach **no debe proponer
objetivos por zona**: el producto no tiene sesiones con objetivo de zona, y prescribirlas
inventaría una función que no existe.

### 7.3 Resumen semanal

Tarjeta nueva en la columna "Resumen semanal" de `WeeklyView`, alimentada por un módulo puro
nuevo que agrega los entrenamientos de la semana visible por día y por zona.

**Contenido:**

- Kicker: `Carga medida por Whoop`. **No** "tu semana": un entrenamiento que Whoop no registró
  no aparece, y llamarlo "tu semana" convertiría una ausencia de dato en una afirmación falsa
  sobre lo que se entrenó.
- Titular: **`24 min registrados en zona alta`**. La palabra "registrados" no es adorno: con
  cobertura parcial el valor observado es un mínimo, no necesariamente el total real.
- Subtítulo: `5 entrenamientos · 230 min registrados · 1 con cobertura menor a 90%`. El último
  segmento aparece solo si hay alguno, y lleva un conteo **separado** para `unknown`
  (`· 1 sin cobertura informada`), que no se mezcla con el de cobertura baja.
- Siete columnas apiladas, una por día, con leyenda de **las seis zonas**. El mockup dibujaba
  seis segmentos y nombraba cuatro; los segmentos inferiores quedaban sin identificar.

**Agregación:**

- Solo entrenamientos `SCORED` **con** `zoneDurations`. Los demás no participan de ninguna
  cifra, ni siquiera del conteo de entrenamientos.
- Varios entrenamientos del mismo día se **suman** por zona.
- Los minutos registrados del subtítulo se derivan de **la suma de zonas**, no de la duración
  de los entrenamientos, para que titular y columnas no puedan discrepar.

**Accesibilidad.** Vale la misma regla que en la tarjeta (§7.1), y acá hay siete gráficos, no
uno: los segmentos son decorativos y **cada columna** lleva texto accesible propio con su
fecha y su reparto por zona —`Miércoles 6 de agosto: 12 min zona 2, 8 min zona 3, …`—, o una
lista equivalente oculta visualmente. Los días sin entrenamientos con zonas anuncian
`sin datos Whoop`, no una columna vacía sin nombre: una columna de altura cero es
indistinguible de una columna ausente para quien no ve el gráfico.

**Escala del gráfico:** las siete columnas comparten una escala única,
`max(totalMsByDay) = 100%`. Normalizar cada día por separado haría que un día de 20 minutos y
uno de 90 se vieran igual de altos, ocultando exactamente la diferencia de volumen que el
gráfico existe para mostrar.

**Guard de scope y semana.** El estado se identifica por `{ athleteId, weekStart, rows }`, se
consulta solo cuando `activeAthleteId === selfAthleteId`, y un resultado que llega con
identidad distinta a la vigente se **descarta**.

La razón principal es la **navegación entre semanas**, no el cambio de atleta:
`AppShell.tsx:17` envuelve el `<Outlet/>` en `<main key={activeAthleteId ?? 'legacy'}>`, así
que cambiar de atleta ya desmonta y remonta la página con estado limpio. `setCurrentWeekStart`
no toca esa key, así que una lectura de la semana N que resuelve después de que el usuario
pasó a la N+1 sí puede pintar datos de la semana equivocada — el mismo hallazgo que el code
review de la Entrega 2 encontró en `DayDetail`. La identidad por `athleteId` se conserva como
defensa en profundidad, redundante con el remount a propósito.

Tests mínimos: cambio de semana con la lectura pendiente, y self→managed.

Si ningún entrenamiento de la semana visible tiene zonas, la tarjeta no se monta.

## 8. Ventanas de datos

Tres ventanas distintas, con valores distintos:

| Camino | Días | Fuente |
|---|---|---|
| Servidor → Supabase | 14 + 2 de margen (~16) | `whoopClient.ts:164-165` |
| Cliente → Dexie | 14 | `pullWorkouts.ts:65` |
| Bloque del coach | 7 | `whoopWorkoutContext.ts:13` |

**No hay backfill.** El sync ya re-consulta su ventana y hace upsert por `workout_id`, así que
tras encender el flag los entrenamientos dentro de la ventana se llenan solos con el primer
sync. Los anteriores quedan sin zonas de forma permanente, y todas las superficies lo toleran
por diseño.

El spec **no promete 16 días visibles localmente**: Supabase puede rellenar ~16, pero el
cliente baja 14. Ni el coach de 7 días ni la semana en curso se ven afectados.

**Riesgo de nombres, heredado:** tres constantes distintas se llaman
`WHOOP_WORKOUT_WINDOW_DAYS`, con valores 14, 14 y 7, en tres módulos. Esta entrega **no
agrega una cuarta** y no renombra las existentes; se deja anotado porque es el terreno exacto
donde ya apareció un bug.

## 9. Entregas

| # | Contenido | Verificable por |
|---|---|---|
| 0 | Textos legales nuevos (`whoop_biometric`, `privacy`) + espejos Markdown | Revisión del owner; gate de rollout |
| 1 | `019`, flag, tipos, `whoopZoneDurations.ts`, sync, pull, parser de import, export, borrado y wipe local | Tests + consulta SQL post-flag |
| 2 | Tarjeta de sesión | Smoke con una sesión real |
| 3 | Bloque del coach | Test de payload + inspección del prompt |
| 4 | Resumen semanal | Smoke con la semana en curso |

Cada una se puede detener sin dejar nada a medias: sin la 2, la 1 solo guarda datos que nadie
muestra; sin la 4, las tres primeras son un producto completo.

## 10. Verificación

- Suite completa verde, más tests nuevos por entrega.
- Paridad de contenido congelada: un entrenamiento sin `zoneDurations` muestra las mismas
  métricas, valores y copy que en `d91e21e`.
- Flag apagado: un sync completo no escribe ninguna de las siete columnas **ni borra las
  existentes**.
- Round-trip de backup: exportar, borrar datos locales, importar, confirmar que las zonas
  vuelven **y** que un backup manipulado se importa sin zonas en vez de con zonas falsas, en
  cinco variantes — distribución parcial, negativa, vacía, no entera, y
  `PENDING_SCORE`/`UNSCORABLE` con zonas y porcentaje válidos. En este último caso el
  entrenamiento se conserva y **ambos** datos se descartan.
- Las cinco `CHECK` de `019` rechazan sus estados inválidos, verificado contra la base.
- Consulta de auditoría post-flag, sobre datos reales: cuántos entrenamientos `SCORED`
  quedaron sin zonas, agrupado por deporte. Responde de una vez si squash recibe distribución
  o si el valor de la entrega se concentra en running.
- Un entrenamiento **con** `percentRecorded` y **sin** `zoneDurations` no produce copy de
  cobertura en ninguna de las tres superficies (`resolveHrCaptureState` → `null`, §4.2).
- Smoke manual con sesión real, cubriendo las tres superficies y la ausencia total bajo un
  atleta gestionado. Lo que verifica es que **no hay workouts** en ese scope (§2.1), no que una
  superficie los filtre.

## 11. Decisiones abiertas

1. **El umbral de 90% es provisional.** Nadie lo respalda: Whoop no lo documenta. Queda como
   umbral visual hasta que haya datos reales suficientes para elegirlo con criterio.
2. **La cobertura de zonas por deporte no está medida.** El schema declara `zone_durations` y
   `percent_recorded` como requeridos dentro de `WorkoutScore`, y `WorkoutScore` solo existe
   con `score_state = SCORED`. El diseño es robusto a la ausencia, así que la respuesta no
   bloquea nada, pero si squash no recibe zonas el valor de la entrega cae mucho, y conviene
   saberlo temprano — por eso la consulta de auditoría está en §10.
3. **La revisión jurídica del paquete de dos publicaciones no tiene fecha.** Es el único
   bloqueante duro para encender el flag.
