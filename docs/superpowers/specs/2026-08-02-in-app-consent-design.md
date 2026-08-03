# Consentimiento in-app versionado

Fecha: 2026-08-02
Base: `33d585f`
Migraciones: Supabase **`017`**, Dexie **v19**

## 1. Problema

Whoop está operativo en producción y trae datos biométricos, pero no existe
registro de que nadie haya consentido nada. El único consentimiento visible hoy
es un `useState(false)` en `WhoopConnection.tsx:243`: bloquea el botón durante
esa sesión, no se persiste y desaparece al recargar. El propio código lo declara
provisorio en la línea 239 —`TODO: replace with onboarding consent once
client-readiness legal consent lands`—, así que no hay evidencia de nada.

Es el único desarrollo que bloquea el piloto pagado: sin registro de
consentimiento no se puede onboardear a un tercero aunque la revisión jurídica
termine mañana.

## 2. Decisiones tomadas

| Decisión | Resuelto |
|---|---|
| Sujeto que consiente | La **cuenta** (`auth.users.id`). Un atleta gestionado no consiente: no usa la app, es dato de un tercero que el titular procesa, y esa relación se resuelve en los términos |
| Dureza del gate | **Bloqueante al entrar.** Sin consentimiento vigente no se renderiza la app autenticada |
| Granularidad de versión | **Por documento.** Cambia privacidad, se re-pide solo privacidad |
| Almacenamiento | Log **append-only** en Supabase + espejo Dexie de aceptaciones confirmadas |
| Backfill | **No.** Nadie tiene consentimiento previo; inventarlo sería falsificar la evidencia que la tabla existe para guardar |

**La IA no es un documento aparte.** Está cubierta dentro de términos y
privacidad (verificado en `docs/legal/`). Los documentos son cuatro: `terms`,
`privacy`, `health` al entrar, y `whoop_biometric` en su propio punto.

## 3. Modelo de datos

### 3.1 Supabase — `017_user_consents.sql`

```sql
create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document text not null,          -- 'terms' | 'privacy' | 'health' | 'whoop_biometric'
  version text not null,           -- identificador de publicación, no descripción del contenido
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);
```

- **Append-only por ausencia de política**, no por convención: RLS concede
  `insert` y `select` sobre filas propias (`auth.uid() = user_id`) y **no
  declara `update` ni `delete`**. Lo que no está permitido no ocurre.
- `accepted_at` lo **fuerza un trigger**, no un default:

```sql
create function public.force_consent_timestamp() returns trigger as $$
begin
  new.accepted_at := now();
  return new;
end;
$$ language plpgsql;

create trigger user_consents_force_timestamp
  before insert on public.user_consents
  for each row execute function public.force_consent_timestamp();
```

  `default now()` solo aplica cuando el cliente **omite** la columna; con
  `default` a secas, un cliente puede enviar la fecha que quiera y el registro
  legal queda fechado por quien consiente, que es exactamente lo que no puede
  pasar. El espejo Dexie usa la fila **retornada** por Supabase
  (`.insert(...).select().single()`), nunca el objeto que se envió.
- El `unique (user_id, document, version)` convierte cualquier reintento en un
  `23505` en vez de una fila duplicada.

**Sin FK a `auth.users`.** Es deliberado y es el punto 8.1: `on delete cascade`
respondería "sí, el borrado de cuenta se lleva la evidencia" antes de que el
abogado opine, y `on delete restrict` rompería la rutina de borrado que ya
existe. Sin FK, el borrado deja de ser semántica de base y pasa a ser un paso
explícito y nombrado de la rutina de cuenta. RLS no depende de la FK.

### 3.2 Dexie v19 — espejo `consentAcceptances`

Clave primaria: el `id` remoto (uuid), para que el espejo sea trazable fila a
fila contra Supabase. Índice **único** `&[userId+document+version]`, que impide
duplicar localmente lo que el `unique` remoto ya impide arriba. Campos:
`id`, `userId`, `document`, `version`, `acceptedAt`.

- Solo se escribe con filas que Supabase **devolvió**: la del `insert` propio
  confirmado, o las que trae la hidratación de §6. Nunca guarda intenciones ni
  objetos construidos por el cliente.
- **Toda lectura filtra por `userId`.** Dexie es local al dispositivo y
  compartida entre cuentas: sin ese filtro, la aceptación de otra persona en el
  mismo navegador abriría el gate. Es la regla dura de esta tabla.
- Migración v18→v19 con test de upgrade real (`db.close(); await db.delete();
  await db.open()` por test, patrón del proyecto).

### 3.3 Manifiesto de versiones — `src/services/legal/consentDocuments.ts`

Declara los cuatro documentos con su versión vigente y su ruta pública. Es la
única fuente: alimenta el gate, la pantalla de aceptación, el pie de la página
legal y el cron de Whoop.

**Lo importan también las funciones de Netlify.** Ya lo hacen con otros módulos
de `src/` (`enqueue-plan-generation.ts:3`) y `tsconfig.node.json` incluye
`netlify/functions`, así que cliente y servidor leen el mismo archivo. No hay
copia que pueda derivar. El módulo es **datos puros, sin imports**: nada de
Dexie, Zustand ni nada que solo exista en el navegador, o el cron no podría
importarlo.

### 3.4 Cada publicación es un artefacto inmutable

Un ledger de ids no sirve, y un ledger de hashes tampoco: el hash prueba que el
texto cambió, pero si el TSX se sobrescribió, el contenido que ese hash
representaba **ya no existe** en ninguna parte. No se puede exhibir lo que se
aceptó.

Y el texto hoy vive en TSX editable, no en los `.md`, que ya son una copia
obsoleta: `TermsPage.tsx:20` declara `updatedAt="2026-07-13"` mientras
`terminos-y-condiciones.md:4` dice `2026-06-20` y conserva el marcador
`[[NOMBRE DEL RESPONSABLE]]` que el TSX resuelve con `LEGAL_CONTROLLER_NAME`.

**El contenido legal pasa a ser dato versionado, no componente.** Cada
publicación es un archivo que se escribe una vez y no se edita nunca:

```
src/services/legal/publications/terms.2026-07-13.ts
src/services/legal/publications/privacy.2026-07-13.ts
…
```

Cada uno exporta un `LegalDocumentContent`: un arreglo de bloques
(`heading` / `paragraph` / `list` / `link`) con el texto **final**, sin
marcadores ni interpolación pendiente. Un único `LegalDocumentRenderer`
convierte cualquier publicación en la página; `TermsPage.tsx` queda como
selector de tres líneas que toma la publicación vigente del manifiesto.

Con eso, "artefacto" y "lo que se renderiza" son el mismo objeto: no pueden
divergir porque no son dos cosas.

**El hash cubre lo que la persona ve, incluidos los destinos.** Se calcula sobre
la serialización canónica del arreglo de bloques, que incluye:

- el nombre del titular **ya escrito como literal dentro del artefacto** — no
  existe una constante productiva alternativa. Si cambia de persona natural a
  SpA, se crea una publicación nueva; editar una supuesta fuente compartida no
  puede mutar publicaciones históricas;
- cualquier otro contenido dinámico visible;
- los `href` de cada enlace. Adónde apunta "nuestra política de privacidad" es
  parte del compromiso, y un hash de texto colapsado lo perdería.

**El test verifica todas las publicaciones históricas**, no solo la vigente:
recorre el ledger completo, importa cada artefacto y compara su hash contra la
entrada. Así una edición retroactiva de un artefacto viejo rompe el test, que es
el ataque que el ledger existe para detectar.

El ledger es **append-only con conjunto histórico congelado**, igual que
`strengthCatalogIdPermanence.test.ts`: comprobar solo pertenencia y duplicados
no detecta que alguien borre una versión vieja, que es la forma más fácil de
perder la evidencia sin darse cuenta.

**Una versión es un identificador de publicación y no se reutiliza jamás.** Si
se republica un texto anterior, esa publicación recibe un id nuevo
(`2026-06-20-r2`) aunque los bytes coincidan. Sin esa regla, revertir un texto
no volvería a pedir consentimiento, porque la versión vieja ya está en el
conjunto aceptado. Un ledger append-only de versiones publicadas por documento
lo apuntala, con el mismo patrón que el gate de ids del catálogo de fuerza
(`strengthCatalogIdPermanence.test.ts`).

## 4. Estado vigente: pertenencia, no orden

```ts
const missing = CONSENT_DOCUMENTS.filter(
  (doc) => !acceptedVersions.get(doc.id)?.has(doc.version),
)
```

Sin `MAX`, sin parseo de fechas, sin asumir que "más nuevo" es "mayor". Si el
gate abre, `missing` está vacío.

**Gramática del identificador de publicación:** `AAAA-MM-DD` opcionalmente
seguido de `-rN` con `N ≥ 2`:

```regex
/^\d{4}-\d{2}-\d{2}(?:-r(?:[2-9]|[1-9]\d+))?$/
```

La fecha es informativa para un humano; el sufijo distingue republicaciones del
mismo día o reversiones. La comparación **no** usa la gramática: sigue siendo
pertenencia a conjunto. El test la valida como forma, no como orden.

## 5. Escritura: por documento, nunca en lote

Con N=3 el ahorro de un `insert` múltiple es irrelevante frente a su modo de
falla: un lote donde una fila choca con `23505` y otra es nueva puede fallar
entero y dejar el cliente espejando aceptaciones inexistentes.

Por documento, cada resultado es inequívoco:

| Resultado | Acción |
|---|---|
| `insert` OK | Se espeja en Dexie |
| `23505` | **Se verifica con un `select` que existe exactamente `(user_id, document, version)`** y recién entonces se espeja. El código de conflicto por sí solo no prueba cuál constraint chocó |
| Cualquier otro error | No se espeja. Ese documento sigue faltando |

El éxito parcial deja de ser un caso especial: el gate recalcula desde lo
confirmado y vuelve a pedir solo lo que quedó. Nunca hay que razonar sobre
"aceptó dos de tres".

## 6. El gate

**`ConsentGate`** envuelve la app autenticada, al mismo nivel que el `AuthGate`
actual. Si `getMissingConsents()` devuelve algo, renderiza la pantalla de
aceptación en lugar de la app.

**Fuera del gate:** las rutas públicas `/terms`, `/privacy`,
`/health-disclaimer` y `/whoop-disclaimer`. Tienen que ser legibles justamente
para poder decidir, y ya son públicas.

**Salida y derechos de datos fuera del bloqueo.** El gate impide usar el
producto, no encierra la cuenta. En `checking`, `missing` y `unavailable` ofrece
una superficie restringida para cerrar sesión, exportar los datos y solicitar
el borrado de los datos de la aplicación. No abre `SettingsPage` completa ni
habilita otras funciones autenticadas. Esto permite cambiar de cuenta en un
dispositivo compartido y ejercer derechos de exportación/borrado sin aceptar
una versión nueva.

**La pantalla** lista los documentos faltantes con su versión, cada uno
enlazado a su ruta pública, y una casilla por documento. No hay "aceptar todo"
en un click: son consentimientos separables y el registro es por documento. Un
botón confirma los que falten.

**Re-aceptación:** solo aparecen los documentos cuya versión cambió, y el
encabezado lo dice —"Actualizamos la política de privacidad"— para que la
persona entienda por qué vuelve a ver esa pantalla en vez de leerlo como un bug.

**Hidratación remota antes de decidir.** El espejo Dexie no es autoridad: puede
estar vacío en un dispositivo nuevo, tras borrar IndexedDB o en otro navegador.
Si falta una aceptación en local, el gate **consulta Supabase antes de pedirla**,
espeja las filas encontradas y recién entonces decide. Sin esto, cambiar de
dispositivo haría re-aceptar algo ya aceptado y ensuciaría el log con eventos que
no representan una decisión nueva.

Orden exacto:

1. Leer espejo local filtrado por `userId`.
2. Si no falta nada → abrir.
3. Si falta algo → consultar Supabase, espejar lo que venga, recalcular.
4. Si sigue faltando → mostrar la pantalla de aceptación.
5. Si la consulta falla y el espejo no alcanza → gate cerrado con reintento, no
   pantalla de aceptación: no sabemos si aceptó, y pedirlo de nuevo sería
   registrar un consentimiento que quizá ya existía.

Mientras la consulta corre, estado de carga — nunca la pantalla de aceptación,
que induciría a aceptar de más.

**Offline.** La primera aceptación requiere red, igual que el login. Las
sesiones siguientes pasan el gate leyendo el espejo. Si el `insert` falla, el
gate sigue cerrado y se ofrece reintento: no existe el estado "aceptado pero
pendiente de confirmar".

## 7. Whoop: el consentimiento gatea el procesamiento

`whoop_biometric` no entra al gate de entrada. Quien nunca conecta Whoop no
debería ver ese consentimiento nunca.

- **Al conectar:** `WhoopConnection` pide la versión vigente y la persiste,
  reemplazando el `useState` de la línea 243 y resolviendo el `TODO` de la 239.
- **El hook es UX, no control de acceso.** `useWhoopSync` dejando de disparar no
  impide nada: `whoop-sync.ts` y `whoop-oauth-start.ts` son endpoints POST que
  cualquier cliente autenticado puede invocar directo. El consentimiento vigente
  se comprueba **en el servidor, en los cuatro accesos**, contra el mismo
  manifiesto de §3.3:

| Punto | Función | Respuesta sin consentimiento vigente |
|---|---|---|
| Inicio de OAuth | `whoop-oauth-start.ts` | **403** con código `consent_required`; `startWhoopConnect` preserva el código y el cliente revalida remoto antes de decidir entre re-aceptación e indisponibilidad |
| Callback | `whoop-oauth-callback` | **Redirección** con `?error=consent_required`. No es una llamada del cliente sino una vuelta del navegador desde Whoop: un 403 mostraría JSON crudo. El token no se persiste |
| Sync manual | `whoop-sync.ts` | **403** con `consent_required` |
| Cron | `whoop-cron` | **Omite la cuenta** y sigue con las demás. No hay nadie a quien responderle; fallar la corrida entera por una cuenta sin consentimiento sería peor |

  El callback importa porque la versión puede cambiar mientras la persona está
  autorizando en Whoop, y ahí ya no hay chance de preguntar.

  Un `403 consent_required` de OAuth no prueba por sí solo que falte la fila: el
  servidor falla cerrado también ante una indisponibilidad transitoria de
  Supabase. El cliente hace una lectura remota autoritativa. Si confirma que no
  existe la versión vigente, muestra re-aceptación; si la lectura falla o
  confirma una fila que el servidor rechazó, muestra `unavailable` y reintento,
  nunca induce otra aceptación basándose solo en el 403.

  El hook y el estado en `WhoopConnection` siguen existiendo, pero como
  experiencia: "Pausamos la sincronización hasta que aceptes el descargo
  actualizado".
- **Los datos ya sincronizados no se borran ni se ocultan.** Caducó el permiso
  para traer más, no para conservar lo que se trajo con permiso vigente.
  Borrarlos sería una decisión más agresiva que nadie pidió.

## 8. Lo que queda abierto para el abogado

No son huecos del diseño: son preguntas que no nos corresponde responder, con
un default declarado mientras tanto.

1. **Si el borrado de cuenta debe llevarse la evidencia de consentimiento.**
   Default: conservar. Se puede agregar el borrado después; no se puede
   recuperar evidencia borrada. Tensión anotada: si los términos prometen
   "borrado completo", conservar filas lo contradice, aunque sean un UUID
   huérfano y una fecha.
2. **Si el descargo de salud requiere aceptación separada** o alcanza con
   términos, que hoy lo cubre. El diseño ya lo trata como documento propio, así
   que fusionarlo es quitar una fila del manifiesto, no rehacer nada.
3. **Si un cambio menor de redacción exige re-aceptación o solo uno material.**
   Hoy re-gatea ante cualquier id nuevo, que es lo conservador.

Además, los textos de `docs/legal/` todavía tienen marcadores sin completar
(`[[NOMBRE DEL RESPONSABLE]]` en `terminos-y-condiciones.md:8`). El mecanismo se
puede construir y desplegar antes de que el contenido esté firmado; la primera
publicación con texto definitivo será simplemente un id de versión nuevo.

## 9. Despliegue: construir no es habilitar

Son dos cosas distintas y el spec las separa. La pieza se construye y se
despliega **detrás de una bandera**, igual que `VITE_ATHLETE_SCOPE` y
`VITE_COACH_ACCOUNTS` en este proyecto. Desplegar con la bandera apagada no
cambia nada para nadie y permite verificar el bundle.

**La bandera tiene que apagar también el enforcement del servidor.** Si solo
apagara el gate del cliente, el cron y los endpoints seguirían exigiendo un
consentimiento que la app no ofrece cómo dar: Whoop quedaría pausado sin salida.
Como `VITE_*` no llega a las funciones de Netlify, son dos variables que se
encienden juntas: `VITE_CONSENT_GATE` en el cliente y `CONSENT_GATE_ENABLED` en
el servidor.

**La resolución de la bandera no vive en el manifiesto.** `consentDocuments.ts`
sigue siendo datos puros (§3.3) y no lee `import.meta.env` ni `process.env` —
si lo hiciera, dejaría de ser importable desde el otro lado. Cada entorno tiene
su adaptador:

- `src/services/legal/consentFlag.ts` → lee `import.meta.env.VITE_CONSENT_GATE`;
- `netlify/functions/_shared/consentFlag.ts` → lee `process.env.CONSENT_GATE_ENABLED`.

Ambos exponen la misma firma `isConsentEnforcementEnabled(): boolean`. El
manifiesto no sabe que existen. Con la bandera apagada, los cuatro accesos de §7
se comportan exactamente como hoy.

Encenderlas desacopladas es un estado inválido: encender solo el servidor pausa
Whoop sin remedio, y encender solo el cliente deja el enforcement real sin
cubrir. El procedimiento de rollout las trata como una sola operación.

**Encender exige dos cosas que hoy no están:**

1. **Textos aprobados.** Con la bandera encendida antes de la revisión jurídica,
   la primera aceptación registraría un borrador — y `terminos-y-condiciones.md`
   todavía tiene marcadores sin completar. Registrar consentimiento sobre un
   texto que va a cambiar produce evidencia de algo que dejó de existir.
2. **Resolver la contradicción con "Restablecer cuenta".**
   `SettingsPage.tsx:415` promete hoy que el borrado "eliminará TODOS tus datos
   locales y remotos". Conservar `user_consents` contradice esa promesa
   textualmente. Antes de encender hay que ajustar ese copy o resolver §8.1 en
   favor del borrado. **No se puede encender con la contradicción viva**: sería
   incumplir una promesa explícita al usuario.

## 10. Criterio de aceptación

1. Sin consentimiento vigente, la app autenticada no renderiza; las cuatro rutas
   legales públicas siguen accesibles.
2. Aceptar escribe remoto primero y espeja local solo tras confirmación.
3. Un reintento no duplica filas y no espeja sin verificar la fila exacta.
4. Cambiar la versión de un documento re-pide ese documento y ninguno más.
5. Republicar un texto anterior con id nuevo vuelve a pedirlo.
6. Una aceptación de otra cuenta en el mismo dispositivo no abre el gate.
7. Con `whoop_biometric` caducado y conexión activa, cliente y cron dejan de
   sincronizar y la UI lo explica.
8. Upgrade real Dexie v18→v19 verificado por test.
9. Editar el texto de un documento sin publicar versión nueva **rompe** el test
   de hash del artefacto.
10. Borrar una versión histórica del ledger **rompe** el test de conjunto
    congelado.
11. Un dispositivo nuevo con aceptación remota existente hidrata el espejo y
    abre el gate **sin** volver a pedir aceptación.
12. Con el consentimiento caducado: `whoop-oauth-start` y `whoop-sync` responden
    403 `consent_required`, el callback redirige con `?error=consent_required` sin
    persistir token, y el cron omite esa cuenta sin abortar la corrida.
13. Con las banderas apagadas, cliente **y** servidor se comportan exactamente
    como antes: el gate no aparece y los cuatro accesos de Whoop no exigen nada.
14. El test de artefactos recorre **todas** las publicaciones del ledger, no solo
    la vigente, y una edición retroactiva de una vieja lo rompe.
15. TypeScript, lint, suite completa, build y `git diff --check` verdes.
16. En todo estado cerrado del gate se puede cerrar sesión, exportar y borrar
    datos sin aceptar, sin abrir Settings ni el resto de la app.
17. `startWhoopConnect` conserva el código `consent_required`; una verificación
    remota faltante abre re-aceptación y una discrepancia/falla remota muestra
    indisponibilidad.
18. Los enlaces legales internos navegan con React Router y los externos o
    `mailto:` permanecen como anchors normales.
19. No existe una constante productiva paralela para el nombre del titular: la
    publicación inmutable es la única fuente del texto renderizado.

## 11. Fuera de alcance

- Consentimiento de atletas gestionados o de terceros sin cuenta.
- **Redactar o corregir** los textos legales. Migrar el texto existente de TSX a
  artefactos versionados (§3.4) **sí** entra: es cambio de forma, no de
  contenido, y un test de paridad debe congelar que el texto renderizado antes y
  después es el mismo carácter por carácter.
- Borrado de datos biométricos por caducidad de consentimiento.
- Exportar un comprobante de consentimiento para el usuario.
- Cualquier cambio al flujo de autenticación existente.
