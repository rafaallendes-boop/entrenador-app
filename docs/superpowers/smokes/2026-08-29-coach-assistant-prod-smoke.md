# Smoke de producción — Asistente IA del Coach + activación de límites de uso

Fechas: **2026-08-29** (sesión 1) y **2026-08-30** (sesiones 2 y 3, tras dos
redeploys). Entorno: `app.rallyiq.cl`, cuenta del owner (tier `advanced`, en
`VITE_COACH_ACCOUNTS`). Árbol local de referencia: `49521f9 "Mejora Coach"`.
Bundle de cliente servido durante las tres sesiones: **idéntico**
(`assets/index-f9phh9hw.js`, `assets/CoachWorkspacePage-PreATOKk.js`,
verificado byte a byte).

**VEREDICTO GLOBAL: APROBADO PARCIAL, con dos hallazgos P1 abiertos de cara al
alumno.**

Lo que la entrega prometía como mecánica —triaje, agrupación, telemetría de la
clase nueva, cuota por bucket y aislamiento entre buckets— **funciona y quedó
verificado end-to-end**. Lo que no está listo para mostrarle a un alumno real es
el **contenido** del borrador: aproximadamente 1 de cada 4 intentos no produce
borrador y consume cupo igual, y varios de los que sí salen llegan con
**caracteres corrompidos** ("días" → "d ias", "algún" → "alg n").

## Cronología, porque determina qué evidencia vale

1. **Sesión 1 (2026-08-29, 15:45–15:55).** Pasos 0–4. Todo pasó; un borrador real
   y su fila en `coach_requests`.
2. **SQL de cierre 1.** `coach_requests` con su fila, pero **`ai_usage_daily`
   vacía**. Probó que `AI_USAGE_LIMITS_ENABLED` no estaba viva: el gate es
   fail-closed, así que con la flag encendida sólo hay dos desenlaces —fila
   escrita o `503`— y hubo `200` sin fila. Causa: Netlify fija las variables **al
   publicar** y el deploy era anterior al cambio de flags (mismo patrón de §31
   con `OPERATIONS_ADMIN_USER_IDS`). Redeploy.
3. **Sesión 2 (2026-08-30, 08:48–08:52).** Flags vivas — y toda la IA caída:
   `RPC increment_ai_usage_if_under_limit devolvió 400`. Diagnóstico en el
   Hallazgo 8. Corregido por `024` y redeploy.
4. **Sesión 3 (2026-08-30, 10:12–10:25).** Smoke completo, incluido el Paso 5.

**Consecuencia:** el ítem 18 de la sesión 1 **no valía** (con la flag apagada un
gate que funciona y un gate ausente se ven idénticos) y se rehízo en la sesión 3.

## Hallazgos

### Hallazgo 1 — P1: el borrador llega con caracteres corrompidos

Reproducido en **4 borradores distintos** de la sesión 3. Ejemplos literales, tal
como se renderizan en pantalla (verificado por zoom sobre el DOM **y** por
extracción de texto, así que no es un artefacto de la herramienta):

> Llevas 17 **d ias** sin registrar entrenamientos y tienes 9 sesiones pendientes desde hace 2 semanas. ¿Hay **alg n** problema?

> Llevas 17 **d ias** sin registrar entrenamientos y tienes 9 sesiones pendientes de hace 14 **d ias**. ¿Hay algo en lo que pueda ayudarte?

> Llevas 17 **d ías** sin registrar entrenamientos y tienes 9 sesiones pendientes. ¿Necesitas ayuda para retomar el ritmo?

`días` aparece como `d ias` o `d ías`, y `algún` como `alg n`. La corrupción es
**selectiva**: en los mismos borradores `¿`, `ó` de "¿Cómo" y `é` sobreviven
intactos. El patrón —un carácter multibyte reemplazado por un hueco, o un espacio
insertado antes de él— es el de una secuencia UTF-8 partida en un límite de chunk
y decodificada por chunk en vez de con un decodificador con estado.

**Esto se le muestra a un alumno real.** Es el hallazgo de mayor impacto de
producto del smoke.

### Hallazgo 2 — P1: ~1 de cada 4 intentos no produce borrador, y consume cupo igual

De los 20 intentos del día, los que llegaron al proveedor fallaron con
`invalid-response` — *"No se generó un borrador válido. Puedes reintentar; puede
consumir cupo."* — en una proporción alta: los intentos 2, 3 y 4 de la sesión 3
fallaron consecutivamente antes del primer éxito, y hubo más fallos después. El
único borrador de la sesión 1 había salido bien a la primera, así que **no es
determinista**.

`invalid-response` proviene de `parseAssistantMessageResult`, que exige
exactamente una clave `body` y un JSON válido. Dado el Hallazgo 1, la hipótesis
económica es que **es el mismo defecto en dos intensidades**: corrupción leve →
el JSON parsea y el texto queda con huecos; corrupción severa → el JSON no
parsea. No está confirmado; la consulta de `finish_reason` del bloque SQL final
sirve para descartar truncamiento por `maxTokens` (que es 260 en
`requestPolicy.ts`, con `allowFallback: false`).

Cada intento fallido **consume cuota igual** —el incremento ocurre antes de la
llamada al proveedor y no hay reembolso—, así que con esta tasa de fallo el cupo
efectivo de 20 borradores/día es en la práctica cercano a 15.

### Hallazgo 3 — P1: el saludo duplicado es intermitente

En la sesión 1 el modelo escribió `¡Hola!` pese a que el prompt dice *"No
escribas saludo ni despedida"*, y como la app antepone su propio "Hola
<nombre>," el resultado tenía dos saludos. En la sesión 3, con **el mismo
bundle y el mismo prompt**, ninguno de los borradores exitosos incluyó saludo.

Es incumplimiento **no determinista** del modelo, no un bug de código. Matiza el
hallazgo original: no se arregla verificando una vez que "ya no pasa".

### Hallazgo 4 — P2: el copy traduce mal la señal `no-check-in`

Consistente en **todos** los borradores de ambas sesiones: "17 días sin
**registrar entrenamientos**" describe `no-check-in`, que mide días sin check-in
—feedback diario, no sesiones—, y convive en la misma frase con "tienes 9
sesiones pendientes". El prompt no define qué es un check-in para el modelo.
A diferencia del saludo, esto **sí** es reproducible al 100%.

### Hallazgo 5 — P2: la tarjeta del propio owner dice "Atleta" en vez de "Tú"

`CoachAssistantPanel.tsx` usa `athleteNames[athlete.athleteId] ?? 'Atleta'` sin
caso especial de self. Las otras tres superficies del workspace
—`CoachSummaryPanel.tsx:95`, `CoachRosterPanel.tsx:101`,
`CoachPlanningPanel.tsx:291`— usan las tres `isSelf ? 'Tú' : (displayName ??
'Atleta')`. Cosmético, sin fuga de datos. Efecto lateral: el desempate
alfabético entre atletas empatados en prioridad opera sobre ese fallback.

### Hallazgo 6 — P1: un fallo del gate se presenta como timeout e invita a reintentar

Observado en la sesión 2, con el gate roto: el asistente mostró *"La redacción
tardó demasiado. Puedes reintentar; puede consumir cupo."* (`DraftFailure =
'timeout'`) cuando la causa real era un `server_error` del gate. Como `timeout`
no está en `isBlockingFailure`, el botón siguió habilitado y el copy invitaba
explícitamente a reintentar algo que no podía funcionar. El chat, ante el mismo
fallo, sí mostró la causa real. **Las dos superficies clasifican el mismo fallo
de forma distinta.**

### Hallazgo 7 — P1: `callRpc` descarta el cuerpo de la respuesta

`usageGate.ts:105-107` reporta sólo el status:

```ts
if (!response.ok) {
  throw makeServerError(`RPC ${functionName} devolvió ${response.status}.`)
}
```

PostgREST devuelve `code`/`message`/`details`/`hint` en el cuerpo — exactamente lo
que distingue "función ausente" de "permiso denegado" de "columna ambigua". Por
eso el diagnóstico del Hallazgo 8 costó una sesión entera. `readOperationsMetrics`
ya resolvió esto con `OperationsMetricsError.diagnostics` (truncado, nunca cruzado
al cliente); conviene el mismo patrón.

### Hallazgo 8 — P0, CERRADO durante el smoke: `increment_ai_usage_if_under_limit` devolvía 400

Con las flags vivas, toda la superficie de IA quedó caída. El diagnóstico se
acotó sin acceso a SQL: `evaluateGatePreamble` corre `readSpend` **antes** del
incremento, por el mismo `callRpc` y credenciales; como el error era el del
incremento, quedaba probado que el service role servía, que `021` estaba
aplicada y que fallaba **sólo** esa función.

Causa: en `returns table (usage_date date, request_count integer)` con
`language plpgsql`, `usage_date` queda como variable OUT en alcance, y la lista
de inferencia de `on conflict (user_id, usage_date, bucket_id)` es contexto de
expresión, así que sufre sustitución de variables → `42702` → 400.
`read_ai_usage_spend` se salvaba por ser `language sql`, y
`increment_ai_usage_cost` porque sólo referencia su OUT param calificado o como
destino de un `SET`.

Corregido por `supabase/024_fix_increment_ai_usage_ambiguity.sql` con
`#variable_conflict use_column`, aplicado y verificado en producción con probe
transaccional revertida. **Ningún test lo detectó porque
`netlify/functions/__tests__/usageGate.test.ts` mockea `fetch` y nunca ejecuta el
SQL** — la clase de hueco que §31 ya declaró no cerrable sin un Postgres real.

### Hallazgo 9 — P1, preexistente y ajeno a esta entrega: el sync está roto

Consola, en las tres sesiones: `[sync] queue:op_failed`, `[sync] sync:failure`, y
en la sesión 3 además `[sync] queue:op_expired` y
`[sync] queue:ops_expired_summary`. Red:

```
POST https://<proyecto>.supabase.co/rest/v1/athlete_profiles?on_conflict=athlete_id → 409
```

La cabecera del panel lo declara honestamente ("Datos locales · … Sincronización
con incidencias · **Nunca sincronizado**"), lo cual es buen diseño, pero implica
que el triaje se calcula sobre datos que nunca sincronizaron, y que **hay
operaciones locales expirando sin llegar al servidor**. Encaja con el
`queue:op_failed` que §28 describía alrededor del FK
`athlete_profiles_athlete_fk`. No se tocó nada. Fuera de alcance, pero es la
razón por la que el ítem 22 no se pudo probar (ver más abajo).

### Observación menor — P3

El primer click sobre una pestaña del workspace inmediatamente después de cargar
la página no registra; hace falta un segundo click. Reproducido 4 veces.

## Lo que quedó verificado, con evidencia

### Paso 0 — bundle desplegado

La pestaña "Asistente IA" renderiza el panel real, no "próximamente".
Corroborado a nivel de artefacto: `assets/CoachWorkspacePage-PreATOKk.js`
contiene `coach_assistant_message` y el copy "Borrador para revisar y copiar".

### Paso 1 — triaje

| Ítem | Resultado |
|---|---|
| 1. Calcula sobre el roster real | Sí. Roster = self + 1 gestionado; el panel cubre los 2. |
| 2. Tres grupos con contadores | "Con señales (2)", "Sin datos suficientes (0)" abiertos; "Al día (0)" colapsado como `<details>`. 2+0+0 = tamaño del roster. |
| 3. Orden entre atletas | Consistente, pero **test débil**: ambos empatan en `overdue-sessions`, así que sólo se ejercitó el desempate alfabético. |
| 4. Orden de señales dentro del atleta | Correcto en ambos. **La distinción visual rosa de dolor NO se observó**: ningún atleta tenía señal `pain`. |
| 5. Cabecera | Formato correcto y **label de sync reactivo**: se lo vio cambiar en vivo de "Sincronizando" a "Sincronización con incidencias · Nunca sincronizado". |
| 6. Botón "Recalcular" | Presente y funcional. |
| 9. Sin "Redactar mensaje" en self | Confirmado. La tarjeta del self tiene 2 señales y aun así no ofrece el botón, lo cual sólo es posible si `athleteId === selfAthleteId`. |

### Ítem 7 — contraste contra la realidad: coincide exactamente

Verificado abriendo las semanas y el día del atleta gestionado, no confiando en
el panel:

| Señal del panel (2026-08-29) | Realidad observada |
|---|---|
| `Adherencia baja · 0%` | Semana previa (17–23 ago): "Llevas **0/5** sesiones completadas (**0%**)". |
| `10 sesiones sin resolver · la más antigua hace 14 días` | Ventana 15–28 ago: 15(1)+16(1)+17(1)+18(2)+19(1)+20(1)+24(1)+26(1)+28(1) = **10**; la más antigua 15 ago = **14 días**. |
| `Sin check-in · 16 días` | `/day/2026-08-13` tiene check-in real (energía 3/10, dolor 3/10, sueño "Muy mal"). 13 ago → 29 ago = **16 días**. |

**Corroboración por rodadura de día.** Al recalcular el 2026-08-30 la ventana se
deslizó exactamente un día: `9 sesiones` (el 15 ago salió de la ventana),
`la más antigua hace 14 días` (ahora el 16 ago), `Sin check-in · 17 días`, y el
self pasó de 10 a 11 días. La aritmética de calendario es correcta.

Dato de paso: ese check-in del 13 ago tiene `painLevel = 3`, bajo el umbral de 4
**y** fuera de la ventana de 7 días — y el panel no emite señal de dolor. La
regla no dispara de más.

**Tope de check-in con fecha futura: no ejercitado.** Se comprobó que
`/day/2026-08-30` no tenía check-in para ese atleta, o sea **no existía un
check-in futuro que el tope tuviera que descartar**. Sólo consta que la señal se
computa bien con el tope presente.

### Ítem 8 — "Ver semana" cambia el scope de verdad

Navegó a `/week` **y** apareció la barra "Entrenando a <gestionado>" con "Volver
a ti". No es sólo un cambio de URL. El scope se restauró a self después.

### Paso 3 — persistencia del borrador

| Ítem | Resultado |
|---|---|
| 13. Sobrevive al cambio de pestaña | Sí. Biblioteca → Asistente IA: texto idéntico. |
| 14. Sobrevive a "Recalcular" | Sí. `Calculado` avanzó 3:50 → 3:51 p. m. y el borrador quedó intacto. |
| 15. No recalcula al volver sin pulsar Recalcular | **Confirmado.** Timestamp intacto en 3:50 p. m., sin estado "Calculando…". El guard de firma funciona. |

### Paso 4 ítem 16 — `023` confirmada bajo tráfico real

```
trace_id            coach_assistant_message-6fa46850-…
request_class       coach_assistant_message
outcome             ok          error_code    null
streamed            false       finish_reason STOP
provider            gemini      model         gemini-2.5-flash
provider_duration_ms 642
prompt_tokens       204         completion_tokens 34
response_char_count 128         estimated_cost_usd 0.000146
created_at          2026-08-29 19:50:28+00
```

`023` surtió efecto: sin ella el insert habría violado el CHECK y, al ser
best-effort sin `await`, se habría perdido en silencio. `finish_reason = STOP`
confirma que el techo de 260 tokens no muerde y que el límite que ata es el de
600 caracteres.

### Ítem 18 — regresión de entitlements (rehecho en sesión 3, ahora sí válido)

- **Chat: funciona.** Con `ENTITLEMENTS_ENABLED=true`, `AI_USAGE_LIMITS_ENABLED=true`
  y el gate operativo, el chat respondió "ok" a las 10:12 y otra vez a las 10:24.
  **Ningún `entitlement_required`.**
- **Plan Builder: NO verificado**, ver la sección de pendientes.

### Ítem 19 — ninguna `UpsellCard`

No apareció oferta de plan en ninguna superficie durante todo el smoke: ni en el
chat, ni en el asistente (incluido el rechazo por cuota), ni en la vista de plan.
Correcto: cuota, kill switch y entitlement no deben ofrecer upsell.

### Paso 5 — agotamiento de cuota

Contadores locales al cierre (Ajustes → Diagnóstico IA), que coinciden con el
conteo llevado a mano:

```
chat_general: 3/120     chat_action: 0/120
import_extract: 0/10    weekly_summary: 0/10
week_creator: 0/8       plan_builder_week: 0/12
plan_builder_pair: 0/6  coach_assistant_message: 20/20
```

| Ítem | Resultado |
|---|---|
| 20. Agotar el bucket | **Hecho: 20/20.** Un solo atleta gestionado es el único con botón de borrador, así que los 20 salieron del mismo atleta — no se pudo repartir entre varios. |
| 21. Banner global + botones deshabilitados | **Verificado.** Texto exacto "Se agotó el cupo disponible para redactar mensajes."; **dos** elementos con `role="alert"` (banner global y mensaje de la tarjeta) confirmados en el árbol de accesibilidad; el botón "Redactar mensaje" quedó visiblemente deshabilitado. Con un solo atleta con botón, el carácter "de clase entera" del bloqueo **no se pudo demostrar en pantalla**; el mecanismo (`blockingFailure` global leído por `draftDisabled` de cada atleta) sí es el correcto por lectura de código. |
| 22. Durabilidad server-side | **NO verificado.** Ver pendientes. |
| 23. Aislamiento de buckets | **Verificado.** Con `coach_assistant` en 20/20, el chat respondió "ok" con normalidad a las 10:24. |

### Estado de la flag de cliente

**`VITE_ENTITLEMENTS` está APAGADA.** Evidencia del bundle: en
`assets/PlanBuilderV2Page-CZmQd3q8.js`, `isProactiveEntitlementUiEnabled`
compila a `function ke(){return!1}`. Es el estado de rollout **correcto** —
servidor antes que cliente, con el manejo reactivo del 403 siempre encendido. No
es observable desde la UI con una cuenta `advanced`, porque la flag sólo oculta
affordances a tiers sin acceso.

## Lo que NO quedó verificado, y por qué

- **Ítem 22 — durabilidad del rechazo con IndexedDB borrado o en incógnito.**
  **No se ejecutó por seguridad de datos.** El sync está roto (Hallazgo 9:
  "Nunca sincronizado", ops expirando), así que borrar IndexedDB podría destruir
  de forma permanente datos locales que nunca llegaron al servidor. La
  alternativa —incógnito— exige un login nuevo, que está fuera de lo que puedo
  hacer. Queda como el pendiente más importante del smoke.
- **Atribución del rechazo observado.** El límite **local** de Dexie para
  `coach_assistant_message` también es 20, y el contador local llegó a 20/20. Por
  lo tanto **el rechazo que se vio en pantalla es atribuible al preflight local**,
  y **no se observó un `429 quota_exceeded` del servidor**. Que el rechazo sea
  además durable server-side depende de que la consulta SQL muestre el contador
  durable en el valor esperado; no se demostró por observación.
- **Plan Builder bajo los gates (`enqueue-plan-generation` /
  `generate-plan-background`).** No ejercitado. `/plan-builder-v2` redirige a `/`
  sin estado de wizard, así que disparar una generación real exige recorrer el
  wizard y **crear un plan draft en producción**, con costo de API, mientras el
  sync está roto y encolaría más operaciones que están expirando. Se declara **no
  verificado** en vez de inferirlo. El contador local `plan_builder_week: 0/12`
  confirma que no se disparó ninguna.
- **Rechazo por entitlement con cuenta `free`.** Imposible: sólo existe la cuenta
  del owner, en `advanced`. Cubierto sólo por tests unitarios.
- **Kill switch.** `AI_KILL_SWITCH_ENABLED=false`, deliberadamente no se tocó.
- **Distinción visual rosa de la señal de dolor** y **orden por prioridad entre
  atletas con señales de distinta prioridad**: ningún atleta del roster tenía
  `pain` y los dos empataban.
- **Grupos "Sin datos suficientes" y "Al día" con contenido**: ambos en 0 durante
  todo el smoke; sólo se vio su estado vacío.
- **Convergencia multi-dispositivo del triaje**: fuera de alcance declarado.

## Costo

- Sesión 1: 1 borrador (`estimated_cost_usd` 0,000146) + 1 chat.
- Sesión 2: 1 chat + 1 borrador, **ambos rechazados por el gate antes del
  proveedor** → costo de proveedor US$0.
- Sesión 3: 19 intentos de borrador + 2 chats.

Total de requests que llegaron al proveedor: **~22**. Con el costo unitario
observado (US$0,000146 por borrador en `gemini-2.5-flash`), el costo del smoke
es del orden de **US$0,004**. Cifra exacta pendiente de la consulta SQL.

## Recomendación

1. **Hallazgo 1 y Hallazgo 2 son el bloqueante de producto.** Antes de mostrarle
   esto a un alumno hay que resolver la corrupción de caracteres; la hipótesis
   más económica es un decodificador UTF-8 sin estado sobre respuesta troceada,
   y probablemente cierra los dos hallazgos de una vez.
2. Cerrar los Hallazgos 6 y 7 en la misma tanda: sin ellos, el próximo incidente
   de gate vuelve a costar una sesión entera de diagnóstico.
3. Repetir el ítem 22 **después** de arreglar el sync (Hallazgo 9), que es lo que
   hoy hace inseguro borrar IndexedDB.
4. Añadir cobertura de las RPC contra un Postgres real: el Hallazgo 8 llegó a
   producción con la suite en verde.
