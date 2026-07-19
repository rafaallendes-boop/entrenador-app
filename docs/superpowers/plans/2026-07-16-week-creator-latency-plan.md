# Plan de mejora de la generación semanal (`week_creator`)

**Fecha:** 2026-07-16
**Estado:** Fase 0 desplegada con smoke inicial de producción; hardening de trazabilidad y disponibilidad implementado localmente, pendiente de despliegue y ampliación de muestra.
**Objetivo:** llevar el p95 de una generación semanal completa y accionable a menos de 10 segundos, manteniendo intactas las restricciones médicas, la disponibilidad y la coherencia de carga.

## Resumen ejecutivo

El flujo de producción usa el proxy de `netlify/functions/coach.ts` y, según la configuración confirmada por el owner, el proveedor primario de `week_creator` es OpenAI. El modelo efectivo se resuelve en este orden:

1. `OPENAI_MODEL_WEEK_CREATOR`;
2. `OPENAI_MODEL`;
3. fallback de código `gpt-5-mini`.

La Fase 0 no cambia el comportamiento de generación. Mantiene el cap de 8.000 tokens, los dos intentos lógicos, el fallback determinístico y todas las validaciones. Su objetivo es medir el camino real antes de optimizarlo.

La hipótesis principal para la cola de latencia no es el trabajo local, sino la combinación de:

- una respuesta estructurada demasiado detallada para una primera decisión semanal;
- `max_completion_tokens=8000`, muy por encima de la salida esperada;
- `reasoning_effort=low` para `gpt-5*`;
- un segundo request completo cuando la reparación local no logra superar la validación;
- repetición de reglas entre prompt, esquema y validación.

Después del smoke, el orden recomendado es desplegar este hardening, completar la muestra, probar el cap como guardrail aislado y priorizar la eliminación de retries recuperables y la reducción de salida real. El experimento de reasoning se omite mientras el modelo efectivo sea GPT-4.1 mini. El esqueleto compacto queda como cambio posterior y versionado; implementar todas las fases juntas impediría atribuir mejoras o regresiones.

---

## Fase 0 — Instrumentación y línea base

### Estado implementado localmente

- Se agregó un `generationId` común a todos los intentos lógicos y al fallback de una misma solicitud.
- Cada intento conserva su propio `traceId` y número de intento.
- Se registran proveedor y modelo efectivos devueltos por el servidor.
- Se registran tamaños en caracteres de system prompt, user prompt, schema y respuesta.
- Se propagan tokens de entrada no cacheados, entrada cacheada, salida y reasoning.
- Se propagan `finishReason`, tiempos de autenticación, servidor y proveedor.
- Las respuestas streaming emiten el mismo evento final y devuelven tiempos de auth/servidor que las respuestas no streaming.
- Se mide el tiempo hasta que la propuesta está realmente lista en el cliente desde la entrada a `sendMessage`; incluye resolución de ruta, persistencia del mensaje, optimización de contexto, proveedor, persistencia de respuesta y creación de propuesta.
- Se registran tiempos de `prompt_build`, `provider_call`, `normalize`, `repair`, `validate` y construcción del `fallback` local.
- Se registran conteos y códigos controlados de reparación local.
- Se agregaron cohortes técnicas sin contenido sensible: cantidad esperada de sesiones, días disponibles, deportes permitidos, dobles, semana parcial y presencia de restricciones activas.
- La pantalla de diagnóstico muestra estos campos y el snapshot de calidad los exporta.
- El load test ejecuta el `WeekCreatorEngine` real: incluye hasta dos intentos lógicos, repair, validación y fallback determinístico.
- El p95 del gate se calcula sobre todas las generaciones lógicas, incluidas las recuperadas por retry/fallback y las fallidas; usa un percentil conservador para muestras pequeñas.
- Los tamaños de prompt, schema, respuesta y tokens se calculan sólo sobre intentos reales del proveedor, nunca sobre el objeto del fallback local. El resumen separa el tamaño por número de intento para hacer visible el crecimiento de la instrucción de retry.
- El banner del load test no usa una fixture distinta del prompt enviado: los tamaños aparecen sólo después de observar los requests que el engine entregó al provider HTTP inyectado.
- El gate exige simultáneamente tasa de éxito >=95%, p95 completo <10.000 ms y fallback local <=2%. Una respuesta determinística sigue contando para disponibilidad, pero no puede autoaprobar la calidad de generación del modelo. El fallback entre proveedores del proxy se informa aparte y no se mezcla con el fallback determinístico local.

### Privacidad

La instrumentación no persiste:

- prompts;
- respuestas completas;
- nombres de sesiones;
- memoria del coach;
- restricciones o notas médicas;

Sólo persiste tamaños, duraciones, tokens, identificadores técnicos, booleanos de cohorte y códigos controlados de reparación/resultado.

### Línea base estática del prompt

La auditoría controlada que usa el builder específico de Week Creator y su schema real produce:

| Componente | Caracteres |
|---|---:|
| System prompt | 2.635 |
| User prompt | 5.232 |
| Response schema | 3.488 |
| Total | 11.355 |
| Aproximación de entrada | 2.839 tokens |

Esta cifra es una fixture reproducible, no un sustituto de la distribución real. El tamaño del user prompt cambia con perfil, memoria, objetivos, historial y restricciones. La Fase 0 ya registra el valor real por intento.

La salida real de OpenAI aún no debe fijarse desde fixtures. Después del despliegue se usarán `responseCharCount`, `completionTokens` y `reasoningTokens` para obtener p50/p95/p99. El cap actual de 8.000 corresponde a salida y no implica que se consuman 8.000 tokens, pero deja demasiado margen para respuestas o razonamiento anómalos.

### Verificación local completada

- Suite completa: 252 archivos y 1.732 tests aprobados.
- Lint aprobado.
- Build de producción aprobado.
- Auditoría de prompt aprobada.
- Load test aprobado en modo seco, sin consumir OpenAI.

### Pendiente para cerrar Fase 0

1. Desplegar el hardening que agrega `logicalAttempt`, resultado terminal de generación y medición end-to-end de fallos.
2. Exportar `Beta quality local` para incorporar tiempos de propuesta lista, etapas locales, repair, fallback y cohortes que no existen en los logs de Netlify.
3. Reunir un mínimo de 20 generaciones para smoke y 30–50 para una línea base razonable.
4. Revisar tamaños y resultados separados por primer intento, segundo intento y fallback, además de `modelGenerationRate`.
5. Registrar la línea base estable en este documento antes de cambiar cap, prompt, reasoning o modelo.

No se considera que el objetivo p95 esté logrado hasta medir propuestas finales válidas en producción.

### Smoke de producción — 2026-07-19, 10:28–10:44 America/Santiago

La muestra entregada contiene cinco `generationId` y siete requests a OpenAI. Dos generaciones ejecutaron un segundo request lógico. El reporte manual indica cuatro semanas coherentes y una generación fallida por una sesión AM en un martes configurado como sólo PM.

| Métrica | Resultado smoke |
|---|---:|
| Generaciones lógicas | 5 |
| Requests al proveedor | 7 |
| Éxito total inferido | 80% (4/5) |
| Éxito al primer intento inferido | 60% (3/5) |
| Retry lógico | 40% (2/5) |
| Provider p50 / p95 | 13.565 / 17.323 ms |
| Server p50 / p95 | 13.878 / 17.618 ms |
| Auth p50 / p95 | 338 / 597 ms |
| Latencia lógica p95 mínima | 31.182 ms |
| Completion tokens p50 / p95 | 1.170 / 1.339 |
| Cache reads | 3/7 requests |
| Modelo efectivo | `gpt-4.1-mini-2025-04-14` |

La latencia lógica es un límite inferior obtenido sumando tiempos de servidor del mismo `generationId`; aún no incluye persistencia y creación de propuesta en el cliente. Con cinco muestras no es una conclusión estadística de p95, pero el proveedor por sí solo ya supera el SLO de 10 segundos.

Todos los requests terminaron con `finishReason=stop`, sin truncamiento, y consumieron como máximo 1.339 tokens de salida. Por eso reducir el cap de 8.000 debe tratarse primero como guardrail contra colas anómalas, no como una mejora de latencia ya demostrada. El modelo observado reporta cero tokens de reasoning, por lo que el experimento `minimal` contra `low` no aplica mientras producción continúe en GPT-4.1 mini.

El incidente AM/PM fue un fallo de adherencia y repair local, no un timeout del proveedor. El hardening local ahora:

- distingue `logicalAttempt` del retry técnico del proxy;
- registra resultado y duración terminal también cuando la generación falla;
- alinea propuestas AM/PM cuando existe una única corrección inequívoca;
- evita dobles en días restringidos a un solo bloque;
- detecta capacidad horaria insuficiente antes de llamar al proveedor;
- genera el fallback determinístico en los bloques permitidos;
- reemplaza detalles técnicos de validación por mensajes accionables para el usuario.

#### Corrección posterior al code review

La primera versión del hardening alineaba AM/PM **antes** de `repairGeneratedWeek`, pero
`repairWeek.ts` no lee `scheduleConstraints`. En un día fijado a un solo bloque con doble
autorizada, `resolveCollisions` "resolvía" la colisión devolviendo la sesión al bloque
prohibido, la validación volvía a fallar y la generación gastaba los dos intentos lógicos
antes de caer al fallback determinístico — exactamente el costo de latencia que esta fase
buscaba eliminar. Reproducido con un test de regresión (martes `solo PM`, doble autorizada,
propuesta AM+PM): 2 requests a OpenAI y `fallbackUsed=true`.

Corrección:

- `buildScheduleAwareRepairConfig` quita del config entregado a repair los días no
  disponibles y desautoriza dobles en días fijados a un solo bloque, materializando primero
  la lista implícita `doubleSessionDays: []` para que el filtro no la ensanche a todos los días.
  Repair reubica a otra fecha en vez de invertir el bloque.
- Se agrega una re-alineación AM/PM **después** de repair/finalize, con guarda de colisión,
  para cubrir las reubicaciones por `findNearestAvailableDate`.

Resultado del mismo escenario: 1 request al proveedor, sin fallback.

#### Unificación del cálculo de capacidad

El cálculo de "cuántos bloques deja libre la configuración" estaba duplicado en cinco
lugares con reglas ligeramente distintas: `buildFallbackSlots`, `buildWeekCreatorCohort`,
`getFallbackPrimaryTarget`, `buildScheduleAwareRepairConfig` y
`applyWeekCreatorDateWindowToConfig`. Este último ignoraba `scheduleConstraints`, así que
una semana parcial conservaba un `sessionsPerWeek` que el calendario no podía sostener y el
preflight la bloqueaba en vez de planificar menos sesiones.

Ahora todos consumen `resolveScheduleCapacity` (`scheduleConstraints.ts`), que centraliza
las tres reglas: un día no disponible no aporta bloques, un día fijado a un solo bloque
aporta uno y nunca admite doble, y una lista `doubleSessionDays` vacía se materializa antes
de filtrar (leerla como "cualquier día" después del filtro reabría los días restringidos).

Cobertura en `__tests__/scheduleConstraints.test.ts`.

---

## Flujo actual y cuellos de botella

```text
Solicitud del usuario
  -> WeekCreatorEngine
     -> resolver configuración, disponibilidad y restricciones
     -> construir system prompt + user prompt + JSON schema
     -> ProxyProvider
        -> auth de Supabase
        -> Netlify coach
     -> OpenAI (cap 8000; reasoning low sólo para gpt-5*)
     -> normalizar
     -> reparar localmente
     -> validar contrato + calendario + deportes + carga
     -> si falla: repetir el request completo una vez
     -> si vuelve a fallar: semana determinística local
     -> crear propuesta accionable
```

### 1. Retry lógico completo

`WeekCreatorEngine` permite dos intentos. Una validación fallida después de recibir y procesar una respuesta ejecuta nuevamente el prompt completo, añadiendo una instrucción de corrección. Este patrón puede casi duplicar la latencia de cola.

El proxy no hace retry técnico para `week_creator`; `shouldUseTechnicalRetry` sólo lo permite para `chat_general`, `weekly_summary` e `import_extract`. Por lo tanto, el retry relevante para este plan es principalmente el retry lógico del engine.

### 2. Presupuesto de salida y reasoning

La política actual usa:

- `maxTokens: 8000`;
- timeout cliente/servidor: 23.000 ms;
- OpenAI `reasoning_effort: low` para `week_creator` cuando el modelo comienza con `gpt-5`;
- JSON Schema con `strict: false`.

El cap no obliga al modelo a completar los 8.000 tokens, pero permite colas largas y consumo de reasoning muy superior al necesario. Debe ajustarse con el p99 observado, no por intuición.

### 3. Contrato de salida demasiado detallado

OpenAI genera una semana con detalles de cada deporte, ejercicios y bloques. Parte de ese contenido ya puede construirse de forma determinística con las bibliotecas y selectores locales de squash, fuerza, running, cycling y movilidad.

La asignación semanal —día, bloque horario, deporte, duración e intención de carga— necesita razonamiento global. La expansión completa de drills, ejercicios y protocolos no necesariamente lo necesita.

### 4. Reglas repetidas

Las reglas aparecen en distintas formas dentro de:

- system prompt;
- user prompt;
- JSON Schema;
- normalizador;
- repair;
- validador.

La repetición mejora robustez hasta cierto punto, pero aumenta tokens y puede producir instrucciones redundantes. La compactación debe conservar explícitamente restricciones médicas, disponibilidad, deportes permitidos y carga.

### 5. Overhead de infraestructura

Cada request autentica el bearer token contra Supabase antes de invocar al proveedor. La Fase 0 mide `authDurationMs` y `serverDurationMs`. Sólo se debe optimizar autenticación o infraestructura si la evidencia muestra que representa una fracción material del p95.

### 6. Trabajo local

El repair actual ya puede corregir, entre otros casos:

- fechas inválidas o fuera de semana;
- días no permitidos;
- colisiones y dobles no permitidos;
- deportes no permitidos;
- detalles deportivos incompletos;
- cantidad de sesiones;
- presencia/dominancia del deporte principal;
- carga de taper y soporte aeróbico;
- duplicados de squash y fuerza;
- fallbacks por deporte.

La medición por etapas debe confirmar que `normalize + repair + validate` es pequeño frente al proveedor. Si no lo es, se optimiza después de resolver la latencia remota.

---

## Invariantes no negociables

Toda fase, experimento o fallback debe cumplir estos gates:

1. **Restricciones médicas:** cero sesiones incompatibles con restricciones activas; no subir intensidad, impacto o RPE mediante repair si existe ambigüedad clínica.
2. **Disponibilidad:** cero sesiones fuera de días/bloques permitidos y cero dobles cuando no están autorizados.
3. **Cantidad:** número exacto de sesiones solicitado, salvo semana parcial donde aplica la ventana ya definida por el engine.
4. **Deportes:** sólo deportes permitidos y presencia del deporte principal cuando corresponde.
5. **Carga:** sin colisiones, distribución coherente, taper respetado y soporte no interferente.
6. **Detalles mínimos:** cada deporte debe llegar con la estructura necesaria para que la propuesta sea ejecutable.
7. **Métrica honesta:** el reloj termina cuando la propuesta final validada es accionable; mostrar un resumen temprano no cuenta como generación completa.

Una variante que mejore latencia pero falle cualquiera de estos gates se descarta.

---

## Métricas de comparación

### Por intento

- `generationId`, `traceId`, intento;
- proveedor y modelo;
- system/user/schema/response chars;
- tokens de entrada no cacheados y cacheados;
- tokens de salida y reasoning;
- `finishReason`;
- provider/server/auth duration;
- tiempos de normalización, repair y validación;
- resultado de validación y código controlado;
- conteos/códigos de repair;
- retry técnico, retry lógico y fallback.

### Por generación lógica

- tiempo hasta propuesta final;
- cantidad de llamadas al proveedor;
- tokens acumulados de todos los intentos;
- éxito en primer intento;
- éxito después de repair local;
- retry completo usado;
- fallback local usado;
- propuesta aceptada/rechazada por el usuario, cuando exista esa señal.

### Agregados obligatorios

- p50, p95 y p99 de propuesta final;
- p95 del proveedor, servidor, auth y pipeline local;
- tasa de éxito total;
- tasa de éxito en primer intento;
- tasa de repair local exitoso;
- tasa de retry lógico;
- tasa de fallback;
- p50/p95 de entrada, salida y reasoning tokens;
- resultados segmentados por cantidad de sesiones, semana parcial, dobles y presencia de restricciones.

### SLO final

| Métrica | Criterio |
|---|---:|
| p95 propuesta final válida | <10.000 ms |
| Éxito total | >=95% |
| Violaciones médicas | 0 |
| Violaciones de disponibilidad | 0 |
| Violaciones de deportes/carga | 0 |
| Fallback local | <=2% |
| Regresión de calidad manual | 0 casos críticos |

Con menos de 20 muestras se reporta smoke, no una conclusión de p95.

---

## Plan priorizado

## Fase 1 — Quick wins medidos en OpenAI

**Objetivo:** reducir la latencia remota sin cambiar el contrato funcional.

### 1.1 Ajustar el cap de salida

Después de 30–50 muestras, calcular:

```text
cap candidato = ceil(p99(completionTokens) * 1,30)
```

Para modelos donde `completionTokens` incluye reasoning, comprobar también el p99 de `reasoningTokens`. El rango inicial esperado para probar es 2.500–3.500, pero no se fija hasta observar producción.

Ejecutar el cambio como experimento aislado. Revertir si aumenta `finishReason=length`, respuestas incompletas o retries.

### 1.2 Probar reasoning mínimo

Comparar `reasoning_effort=minimal` contra `low` sólo para `week_creator`, manteniendo el modelo, prompt, schema y cap constantes.

Gate adicional: misma tasa de primer intento válido y cero regresiones en los cinco escenarios arquetipo descritos más abajo.

### 1.3 Compactar redundancias del prompt

- Mantener una sola representación de cada regla no médica.
- Convertir disponibilidad, deportes y carga en bloques compactos y estables.
- Mantener restricciones activas en un bloque visible, explícito y no resumido de forma ambigua.
- No eliminar reglas sólo porque también existen en el validador: el validador evita aplicar una mala semana, pero no evita pagar un retry.
- Evaluar un prefijo estable para aprovechar cache únicamente si `cacheReadInputTokens` demuestra beneficio real.

### Criterio de salida de Fase 1

- al menos 30 generaciones de la variante elegida;
- p95 <=12 s o mejora >=25% respecto de baseline;
- éxito total >=95%;
- tasa de retry no mayor al baseline;
- cero fallos de invariantes.

---

## Fase 2 — Evitar retries completos recuperables

**Objetivo:** reservar el segundo request para errores semánticos que realmente requieren al modelo.

### 2.1 Clasificar fallos de validación

Crear una clasificación estable:

- `locally_repairable`;
- `targeted_model_repair`;
- `unsafe_or_ambiguous`;
- `provider_failure`.

No usar strings libres como contrato de decisión; usar códigos tipados.

### 2.2 Ampliar repair local seguro

Candidatos:

- corregir `targetDate` al lunes solicitado cuando existe exactamente una semana inequívoca;
- ignorar acciones accesorias si existe exactamente un `create_week` completo y seguro;
- completar detalles deportivos con selectores locales;
- reemplazar drills/ejercicios fuera de catálogo;
- reparar slots, fechas, colisiones, cantidad y diversidad con la infraestructura ya existente;
- normalizar campos opcionales mal formados sin descartar toda la sesión.

No reparar localmente decisiones ambiguas relacionadas con lesión, dolor, impacto, carga máxima o compatibilidad médica. En esos casos usar fallback conservador o reparación dirigida con el conjunto completo de invariantes.

### 2.3 Sustituir el retry completo por reparación dirigida

Cuando sea necesaria una segunda llamada:

- enviar el JSON fallido sólo en memoria;
- incluir códigos de validación concretos;
- incluir un envelope compacto con restricciones, disponibilidad, deportes, cantidad y carga;
- pedir una corrección del objeto, no una regeneración creativa completa;
- volver a ejecutar repair y validación completos antes de mostrar la propuesta.

Si el primer resultado no contiene un `create_week` recuperable o es médicamente ambiguo, usar la ruta conservadora actual.

### Criterio de salida de Fase 2

- reducir al menos 50% la tasa de segundo request completo;
- p95 <10 s con >=30 muestras;
- éxito total >=95%;
- fallback <=2%;
- cero fallos de invariantes;
- los casos reparados deben indicar códigos y conteos auditables.

---

## Fase 3 — Semana resumida + hidratación local

**Objetivo:** hacer que OpenAI decida la arquitectura semanal, no que redacte todos los detalles ejecutables.

### Contrato resumido propuesto

OpenAI devuelve sólo lo necesario para coordinar la semana:

```text
targetDate
sessions[]:
  date
  timeBlock
  sessionType
  durationMin
  loadIntent / targetRpe
  focusKey
  title breve
  objective breve
```

Los detalles se hidratan localmente mediante:

- catálogo y selector de drills de squash;
- selector y biblioteca de fuerza;
- selector de running;
- selector de cycling;
- selector de movilidad;
- protocolos determinísticos de warm-up/cooldown;
- reglas existentes de taper, densidad, diversidad y soporte.

### Flujo recomendado

```text
OpenAI: esqueleto semanal compacto
  -> validar disponibilidad, restricciones y carga global
  -> hidratar detalles localmente
  -> repair final
  -> validar contrato completo
  -> propuesta accionable
```

Se puede mostrar un resumen visual temprano para mejorar percepción de velocidad, pero la propuesta no se puede aceptar ni aplicar hasta terminar hidratación y validación final. El SLO continúa midiendo la propuesta accionable.

Una segunda llamada de IA para enriquecer narrativa sólo puede ejecutarse después y fuera del camino crítico. Nunca debe modificar silenciosamente fechas, deportes, carga o restricciones ya validadas.

### Criterio de salida de Fase 3

- reducir al menos 40% los tokens de salida frente al baseline;
- hidratación local p95 <300 ms;
- p95 total <8 s;
- 100% de propuestas con detalles mínimos por deporte;
- calidad manual igual o superior en el corpus arquetipo;
- cero fallos de invariantes.

---

## Fase 4 — Modelo, cache e infraestructura

**Objetivo:** optimizar lo que siga siendo material después de reducir output y retries.

### Experimentos permitidos

- comparar modelos OpenAI con el mismo contrato resumido;
- ordenar el prompt para maximizar un prefijo estable si la métrica de cache demuestra lecturas reales;
- revisar auth sólo si `authDurationMs` representa >10% del p95 total;
- revisar región/función sólo si `serverDurationMs - providerDurationMs` es material;
- enriquecer detalles no críticos de forma asíncrona.

No cambiar modelo, cap, reasoning y schema simultáneamente. Cada variante debe poder atribuir su efecto y revertirse de forma independiente.

### Criterio de salida de Fase 4

- p95 sostenido <10 s durante al menos dos ventanas de medición;
- costo por semana igual o menor al baseline;
- éxito, repair, fallback y calidad dentro de SLO;
- rollback documentado y probado.

---

## Corpus de validación obligatorio

Antes de cada canary se ejecutan, como mínimo, estos escenarios:

1. Semana estándar de cinco sesiones, sin dobles.
2. Restricción médica activa y retorno progresivo.
3. Disponibilidad estrecha con bloques horarios explícitos.
4. Semana parcial que no puede programar días pasados.
5. Multideporte con dobles permitidos sólo en días concretos.
6. Dos sesiones de fuerza que deben ser distintas.
7. Squash prioritario con soporte no interferente y taper competitivo.

Cada escenario valida salida final, no sólo el esqueleto del proveedor.

---

## Estrategia de rollout para un solo usuario de producción

1. Ejecutar primero tests y load test seco.
2. Desplegar telemetría sin cambios de política.
3. Recoger baseline mediante uso real y una tanda controlada autenticada.
4. Activar una sola variante mediante configuración o feature flag.
5. Reunir al menos 20 muestras para descartar regresiones evidentes.
6. Llegar a 30–50 antes de aceptar una mejora de p95.
7. Volver inmediatamente a la política anterior ante truncamiento o cualquier violación de seguridad deportiva.

Comandos disponibles:

```bash
npm run audit:prompt
LOADTEST_DRY_RUN=true npm run loadtest:week-creator
```

Para la tanda autenticada, exportar previamente `COACH_AUTH_TOKEN` sin guardarlo en el repositorio:

```bash
COACH_ENDPOINT=https://app.rallyiq.cl/.netlify/functions/coach \
LOADTEST_N=30 \
npm run loadtest:week-creator
```

El test es secuencial para medir experiencia individual y evitar que la concurrencia contamine la primera línea base. El presupuesto de fallback puede configurarse con `LOADTEST_FALLBACK_TARGET`, pero el valor del SLO y default es `0.02`.

---

## Archivos afectados

### Fase 0 ya modificados

- `src/services/weekCreator/WeekCreatorEngine.ts`
- `src/services/weekCreator/__tests__/WeekCreatorEngine.test.ts`
- `src/services/weekCreator/WeekCreatorPromptBuilder.ts` — auditado, sin cambio funcional en Fase 0.
- `src/services/ai/requestPolicy.ts`
- `src/services/ai/types.ts`
- `src/services/ai/stageLogger.ts`
- `src/services/ai/responseNormalizer.ts`
- `src/services/ai/providerUsage.ts`
- `src/services/ai/providers/ProxyProvider.ts`
- `src/services/ai/providers/OpenAIProvider.ts`
- `src/services/ai/providers/GeminiProvider.ts`
- `netlify/functions/coach.ts`
- `src/store/useChatStore.ts`
- `src/store/__tests__/useChatStore.test.ts`
- `src/pages/SettingsPage.tsx`
- `src/types/index.ts`
- `src/types/planBuilder.ts`
- `src/services/planBuilder/generatePlan.ts`
- `src/services/planBuilder/generateWeek.ts`
- `src/services/planBuilder/generateWeekCore.ts`
- `scripts/audit-prompt-tokens.test.ts`
- `scripts/loadtest-week-creator.mjs`
- `scripts/loadtest-week-creator.test.js`

### Probables en Fases 1–2

- `src/services/ai/requestPolicy.ts`
- `netlify/functions/coach.ts`
- `src/services/weekCreator/WeekCreatorPromptBuilder.ts`
- `src/services/weekCreator/WeekCreatorEngine.ts`
- `src/services/weekCreator/validateWeekCreatorResponse.ts`
- `src/services/planBuilder/repairWeek.ts`
- nuevos módulos de clasificación y reparación dirigida bajo `src/services/weekCreator/`.

### Probables en Fase 3

- `src/services/weekCreator/weekCreatorResponseSchema.ts`
- nuevo `weekCreatorSkeletonSchema.ts` o reemplazo versionado equivalente;
- nuevo `hydrateWeekCreatorSkeleton.ts`;
- selectores/bibliotecas bajo `src/services/training/`;
- tests de contrato, hidratación, repair y carga.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cap demasiado bajo trunca semanas | Canary aislado, vigilar `finishReason`, rollback inmediato |
| Reasoning mínimo reduce coherencia | Corpus arquetipo + mismo gate de validación + comparación de primer intento |
| Repair local oculta mala calidad | Códigos y conteos; límites de repair; revisión manual de muestras |
| Repair altera una restricción médica | Prohibir repair ambiguo; validar restricciones antes y después |
| Esqueleto pierde especificidad deportiva | Hidratación con selectores existentes y validación completa por deporte |
| Resumen temprano maquilla el p95 | Medir hasta propuesta final accionable |
| Segunda fase cambia una semana ya vista | Versionar por `generationId`; bloquear aceptación hasta estado final |
| Muestra pequeña produce falso p95 | Smoke con 20; decisión con 30–50 y repetir ventana |
| Cambio de modelo mezcla variables | Un experimento por vez y política reversible |
| Telemetría expone datos sensibles | Sólo métricas, booleanos y códigos controlados; nunca contenido |

---

## Definición de terminado

La mejora de generación semanal se considera cerrada cuando:

- producción usa OpenAI con modelo efectivo registrado;
- el p95 de propuesta final accionable es <10.000 ms;
- hay al menos 30–50 muestras comparables de la variante final;
- éxito total es >=95%;
- fallback es <=2%;
- no existen violaciones médicas, de disponibilidad, deportes o coherencia de carga;
- la salida mantiene detalles ejecutables por deporte;
- costo y tokens por generación no empeoran respecto del baseline;
- existe rollback simple hacia la política anterior.
