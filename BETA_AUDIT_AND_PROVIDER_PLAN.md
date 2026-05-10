# Entrenador App — Auditoría para Beta + Estrategia de Proveedores IA

Fecha: 2026-05-09
Autor del review: análisis basado en código real del repo (no genérico).

---

## TL;DR

La app está mejor preparada de lo que parece para una **beta interna y para 3-5 usuarios cercanos**, pero NO está lista para una beta pagada o abierta. Las brechas críticas no son features, son tres cosas:

1. **Telemetría persistente y exportable** (hoy todo se pierde al cerrar la pestaña: [useAIDebugStore.ts](src/store/useAIDebugStore.ts#L4-L7) usa sessionStorage y caps a 30 entries).
2. **Mecanismo de feedback explícito por sesión/propuesta** (hoy solo existe accept/reject implícito en [useCoachActionsStore.ts:140-149](src/store/useCoachActionsStore.ts#L140-L149)).
3. **Routing real por `requestClass` en el servidor** ([coach.ts:763](netlify/functions/coach.ts#L763) lee `AI_PROVIDER` global; el `requestClass` solo afecta timeouts/maxTokens).

La buena noticia: la **arquitectura ya soporta lo que falta**. Hay `traceId`, `requestClass`, `outcome`, `errorClass`, `stageTimings`, `repairWarnings`, `generationMeta`, `validationIssues`, normalización clasificada y stage logger estructurado. El esqueleto está. Falta **persistir, exponer y rutear**.

La estrategia de proveedores recomendada es **mantener Gemini Flash como default y habilitar OpenAI/Claude por `requestClass` quirúrgicamente** — empezando por `chat_action` y `plan_builder_pair`, que son los que más sufren por formato/longitud, no por costo.

---

## 1. Diagnóstico del estado actual

### 1.1 Lo que YA está bien construido

#### Capa de proveedores
- Tres providers reales con la misma interfaz `AIProvider` y `AIRequest/AIRawResponse`: [GeminiProvider.ts](src/services/ai/providers/GeminiProvider.ts), [OpenAIProvider.ts](src/services/ai/providers/OpenAIProvider.ts), [ClaudeProvider.ts](src/services/ai/providers/ClaudeProvider.ts).
- Server-side proxy [coach.ts](netlify/functions/coach.ts) con autenticación Supabase obligatoria por defecto ([coach.ts:108](netlify/functions/coach.ts#L108)), rate limiting in-memory por usuario ([coach.ts:405-417](netlify/functions/coach.ts#L405-L417)), validación estricta de payload, y políticas de retry/fallback con presupuesto de tiempo dinámico ([coach.ts:756-883](netlify/functions/coach.ts#L756-L883)).
- Streaming NDJSON con fallback automático a no-stream cuando el cliente ya recibió 0 chunks ([ProxyProvider.ts:48-61](src/services/ai/providers/ProxyProvider.ts#L48-L61)).
- Resolución dinámica de provider activo en cliente: en PROD siempre `proxy`; en dev se respeta `VITE_AI_PROVIDER` ([providerResolver.ts:8-29](src/services/ai/providerResolver.ts#L8-L29)).

#### Normalización y recovery
- `responseNormalizer` ya distingue `outcome` ∈ `{ok, truncated_mid, truncated_early, parse_invalid, schema_invalid}` y propaga `errorClass`, `invalidActionCount`, `createWeekDiagnostics` ([responseNormalizer.ts:228-262](src/services/ai/responseNormalizer.ts#L228-L262)).
- Reparación in-place de `add_session` con repairs/dropped reasons + warning logs ([responseNormalizer.ts:432-446](src/services/ai/responseNormalizer.ts#L432-L446)).
- Recovery de formato para `chat_action` con segundo intento, instrucción reforzada y temperatura más baja ([coachRecovery.ts:51-96](src/services/ai/coachRecovery.ts#L51-L96)).
- Stage logger emite `coach.request` JSON con `traceId`, `requestClass`, `outcome`, `totalMs` y duraciones por etapa ([stageLogger.ts:82-99](src/services/ai/stageLogger.ts#L82-L99)).

#### Lógica determinística
- Hay mucho más determinismo del que aparenta. El `WeekCreatorEngine` valida, repara y, si el modelo falla 2 intentos, **construye una semana sin IA** con [`buildDeterministicSessions()`](src/services/weekCreator/WeekCreatorEngine.ts#L432-L443) usando selectors propios.
- `repairGeneratedWeek` arregla fechas fuera de rango, deportes no permitidos, conteos, días no permitidos. La IA propone, el repair fija ([planBuilder/repairWeek.ts](src/services/planBuilder/repairWeek.ts)).
- `preValidateActions` ([useCoachActionsStore.ts:214-327](src/store/useCoachActionsStore.ts#L214-L327)) es una capa real de seguridad antes de aplicar; con rollback transaccional si una acción falla a mitad ([useCoachActionsStore.ts:171-174](src/store/useCoachActionsStore.ts#L171-L174)).
- `chatRouting.resolveChatRoute` ya separa correctamente: `chat_general`, `chat_action`, `week_creator`, `weekly_summary`, `plan_builder_redirect` ([chatRouting.ts:27-94](src/services/chatRouting.ts#L27-L94)).
- Selectors deportivos sólidos: `runningSelector`, `squashWeekPlanner`, `strengthSelector`, `mobilitySelector`, `cyclingSelector`, todos con tests dedicados.

#### Idempotencia
- `acceptProposal` cachea promesas en `activeAcceptProposalPromises` para que doble-click no aplique dos veces ([useCoachActionsStore.ts:106-108](src/store/useCoachActionsStore.ts#L106-L108)). Bien.

### 1.2 Brechas críticas para una beta real

| # | Brecha | Dónde se ve hoy | Riesgo si se ignora |
|---|---|---|---|
| 1 | **Telemetría no persistente**: `useAIDebugStore` usa `sessionStorage`, max 30 requests, no se exporta ni se sincroniza. | [useAIDebugStore.ts:4-7](src/store/useAIDebugStore.ts#L4-L7) | Imposible saber qué pasó cuando un beta tester reporta "no funcionó". Stage timings se imprimen a `console.info` y se pierden. |
| 2 | **Sin feedback explícito de calidad**: solo accept/reject implícito en `CoachProposal.metadata.resolutionOutcome`. No hay 👍/👎 ni texto libre por sesión generada. | [coachProposalMetadata.ts] + [useCoachActionsStore.ts:140-149](src/store/useCoachActionsStore.ts#L140-L149) | No tienes señal para distinguir "el modelo se equivocó" vs "el usuario cambió de opinión". |
| 3 | **Routing por requestClass no existe en server**: el proxy lee `AI_PROVIDER` global. El `requestClass` solo afecta timeouts/maxTokens/promptMaxChars. | [coach.ts:763](netlify/functions/coach.ts#L763) | Imposible probar OpenAI solo en `chat_action` o Claude solo en `plan_builder_pair` sin un deploy aparte. |
| 4 | **Sin contador de tokens**: ni server ni cliente registran `input_tokens`/`output_tokens` reales. | búsqueda en `coach.ts`, `responseNormalizer.ts`, `useAIDebugStore.ts` | No puedes detectar early un usuario que va a quemar $20/mes ni alertar de gasto. |
| 5 | **Sin límite por usuario por día**: rate limit es 20 req / 60s in-memory ([coach.ts:108-110](netlify/functions/coach.ts#L108-L110)) — bueno contra abuso de ráfaga, inútil contra uso sostenido caro. | [coach.ts:405-417](netlify/functions/coach.ts#L405-L417) | Un usuario beta motivado puede pedir 200 planes en una semana sin ningún tope. |
| 6 | **`promptBuilder.ts` = 2570 líneas** sin separación por requestClass. | [promptBuilder.ts](src/services/ai/promptBuilder.ts) | Cualquier cambio puede mover tokens en otro requestClass sin que nadie lo note. Hay test de audit (`npm run audit:prompt`) — bien — pero la superficie es enorme. |
| 7 | **`ProxyProvider` hardcodea `name = 'gemini'`** ([ProxyProvider.ts:30](src/services/ai/providers/ProxyProvider.ts#L30)). El nombre real solo llega vía `data.provider` del response. | [ProxyProvider.ts:30](src/services/ai/providers/ProxyProvider.ts#L30) | Confunde el badge en errores tempranos: si el server falla con Claude, el cliente reporta "gemini error". |
| 8 | **Rate limit in-memory per Lambda** — Netlify spawnea instancias frías; el bucket no es global. | [coach.ts:118](netlify/functions/coach.ts#L118) | Un usuario puede burlear el límite haciendo requests paralelos que aterricen en instancias distintas. Trivial pero existe. |
| 9 | **Sync sigue siendo el riesgo abierto** declarado en `PROJECT_REVIEW_AND_ROADMAP.md`. No tocado en este review. | `src/services/__tests__/syncService.test.ts` existe pero falta QA multi-dispositivo real. | Beta tester que use móvil + desktop puede ver inconsistencias. |
| 10 | **Doc desactualizada**: `OPTIMIZATION_AND_COSTS.md` dice "máx 26s Netlify" pero `coach.ts:106` usa 55000ms (Netlify Functions streaming permite 60s real). | comparar [OPTIMIZATION_AND_COSTS.md](OPTIMIZATION_AND_COSTS.md) vs [coach.ts:105-107](netlify/functions/coach.ts#L105-L107) | Tu propio razonamiento sobre timeouts parte de un dato falso. |

---

## 2. Preparación para prueba real con usuarios

### 2.1 Lo mínimo no negociable antes de invitar usuarios externos

Estas son las brechas que **bloquean** una beta cerrada con 3-5 personas que no sean tú:

1. **Persistir trace + outcome + provider + duración + tokens en Supabase** (tabla `coach_request_log`). Sin esto no podrás evaluar nada después.
2. **Botón 👍/👎 + textarea opcional en cada respuesta del coach y en cada propuesta aplicada**. Persistir junto al traceId.
3. **Tope diario por usuario** (no por minuto): `MAX_DAILY_COACH_REQUESTS_PER_USER` con una tabla `coach_usage` (user_id, date, count). Default sugerido: 60 chat_general + 20 chat_action + 5 week_creator + 2 plan_builder por día.
4. **Disclaimer de beta** en login: "estás en beta cerrada, los entrenamientos los genera IA, validá con tu cuerpo, reportá problemas con el botón 👎."
5. **Botón 'reportar problema' que adjunte automáticamente** los últimos 5 traceIds + último prompt audit count + provider activo (sin enviar el prompt completo).

### 2.2 Métricas a registrar (mínimo viable)

Por **request** (tabla `coach_request_log`):

```
- traceId
- userId (hash si querés anonimizar)
- requestClass
- provider, model
- outcome (ok | truncated_mid | truncated_early | parse_invalid | schema_invalid | timeout | rate_limit | error)
- errorClass (si aplica)
- durationMs total + stageTimings JSON
- promptCharCount (no el prompt completo)
- responseCharCount
- inputTokens, outputTokens (cuando el provider lo devuelve — Gemini sí, OpenAI sí, Claude sí)
- retryUsed, fallbackUsed
- createdAt
```

Por **propuesta** (extender `coach_proposals` o tabla nueva `coach_proposal_outcome`):

```
- proposalId
- traceId (link al request que la generó)
- resolutionOutcome (accepted | rejected | edited_then_accepted)
- userRating (-1 | 0 | 1)  ← 👎/sin opinión/👍
- userFeedbackText (libre, opcional, max 500 chars)
- timeToDecisionMs (createdAt → resolvedAt)
- editedFieldsCount (si la editó antes de aceptar)
```

Por **sesión completada** (extender `sessions` o tabla `session_completion`):

```
- sessionId
- generatedBy (coach | user | week_creator | plan_builder)
- sourceTraceId (si vino de IA)
- completedRpe vs plannedRpe
- userRating de la sesión (después de hacerla): -1/0/1 + comentario
```

### 2.3 Métricas que **no** deberías guardar

- Prompts completos. Carísimo de almacenar y entran datos de salud.
- Mensajes de chat completos del usuario. Guarda solo `userMessageCharCount` y `requestClass`.
- Respuestas completas del coach. Mismas razones.
- Cualquier dato del `athleteProfile` excepto `userId`.

Si en algún punto necesitás reproducir un caso específico, agregá un toggle "compartir trace completo con el equipo" en el botón 👎 — opt-in explícito.

### 2.4 Métricas agregadas a calcular semanalmente

```
- success_rate por requestClass (outcome=ok / total)
- p50/p95 durationMs por requestClass × provider
- proposal_acceptance_rate
- proposal_rating_avg (👍 / total con rating)
- session_rating_avg
- tokens_per_user_per_week (top 10 — para detectar usuarios pesados)
- error_distribution (errorClass × provider)
- repair_rate por requestClass (cuántas veces el normalizador tuvo que reparar)
- truncation_rate (truncated_mid + truncated_early / total)
```

### 2.5 Límites recomendados para la beta

```
Por usuario por día:
  chat_general: 60
  chat_action: 20
  week_creator: 5
  plan_builder_week: 5 (acumulado del wizard)
  plan_builder_pair: 3
  weekly_summary: 5
  import_extract: 5
Total beta: máx 10 usuarios concurrentes
Presupuesto absoluto: si gasto IA > $30/mes → freeze automático y aviso por email
```

Con Gemini Flash y los timeouts actuales, 10 usuarios × estos topes = **~$1.50-3/mes**. El riesgo no es el costo, es no medirlo.

---

## 3. Calidad del coach: ¿de dónde vienen los errores?

Esta es la pregunta más importante de tu lista y la más fácil de responder mal sin instrumentación. Hoy el código **no te permite distinguir** correctamente las cinco fuentes posibles. La normalización ya clasifica algunas, pero no se persiste.

### 3.1 Matriz de origen de error y cómo detectarlo HOY vs cómo deberías

| Origen | Síntoma | Cómo detectarlo HOY | Lo que falta |
|---|---|---|---|
| **Provider técnico** (timeout, 5xx, rate limit) | error visible al usuario | `outcome = timeout/rate_limit/error` en stageLogger | persistir + alertar |
| **Streaming cortado** | parcial sin acciones, "actions" vacío | `truncated_mid` / `truncated_early` en `responseNormalizer.classifyOutcome` | persistir el ratio por provider |
| **JSON malformado del modelo** | parse falla | `parse_invalid` outcome + `actionParseFailed` | persistir + comparar entre providers |
| **Schema inválido** (campos faltantes) | propuesta dropped, repairs > 0 | `schema_invalid` + `invalidActionCount` + `createWeekDiagnostics` | persistir, ya está clasificado |
| **Prompt insuficiente / contexto pobre** | respuesta genérica, ignora perfil | NO se detecta automáticamente | requiere feedback humano (👎 + comentario) |
| **Lógica determinística incorrecta** (selectors mal) | sesión sale armada raro pero válida | NO se detecta | requiere review semanal de propuestas aceptadas con 👎 |

**Conclusión operativa**: con la instrumentación que ya existe + persistir el outcome + un botón 👎 podés separar las 4 primeras causas. La 5 y 6 requieren leer feedback humano. **No hay forma de saltearse esa lectura semanal en una beta** — son ~30 min/semana mientras tengas <10 usuarios.

### 3.2 ¿Hay demasiado IA, poco determinismo?

**Veredicto: no, está balanceado.** Lo determinístico ya hace mucho:

- `chatRouting.resolveChatRoute` decide qué requestClass sin IA.
- `WeekCreatorEngine` tiene fallback determinístico tras 2 intentos fallidos ([WeekCreatorEngine.ts:217-251](src/services/weekCreator/WeekCreatorEngine.ts#L217-L251)).
- `repairGeneratedWeek` arregla output del modelo antes de validar.
- `preValidateActions` rechaza acciones inválidas antes de aplicar.
- Los selectors (`runningSelector`, `squashWeekPlanner`, etc) podrían generar sesiones sin IA si quisieras.

**Donde podés reforzar determinismo barato**:

1. **`add_session` simple** ("agregame fuerza el lunes PM"): hoy va a IA. Podría resolverse 100% determinístico con `strengthSelector` + `getDayName`. Ahorro real de tokens.
2. **`weekly_summary`** podría ser 80% template + 20% IA (solo el "qué destaco"). Hoy es 100% IA.
3. **`replace_session_type`**: el patch ya es determinístico ([useCoachActionsStore.ts:611-655](src/store/useCoachActionsStore.ts#L611-L655)). Casi no necesita IA.

No haría esto antes de la beta — es optimización. Pero en Fase 3 (sección 7) lo metería.

### 3.3 Errores que probablemente vienen del prompt

Sin haber leído las 2570 líneas (no pidás eso a un humano), las señales que sospecho:

- `MACRO PLAN` se omite en `chat_general` salvo competencia <14 días. Decisión correcta. Riesgo: si el usuario pregunta "cómo estoy de carga" sin competencia cercana, el coach no tiene macro context y responde plano. Mitigar con **un test de audit que verifique que `chat_general` con `userMessage` que contiene "carga|fatiga|recuperación" sigue siendo liviano** (no escalonar accidentalmente).
- `weekly_summary` con `temperature: 0.25` y `maxTokens: 1600` ([requestPolicy.ts:24-29](src/services/ai/requestPolicy.ts#L24-L29)): puede sentirse robótico. Considerar 0.4 cuando se pruebe con usuarios.
- `chat_action` con `temperature: 0.45` y `maxTokens: 4200`: es bastante. Si el modelo se va por las ramas, el truncamiento aparece. La métrica `truncation_rate` por requestClass te lo va a mostrar.

### 3.4 Errores que probablemente vienen del responseNormalizer

El normalizador es defensivo y lo veo bien construido. Riesgos puntuales:

- [responseNormalizer.ts:171-179](src/services/ai/responseNormalizer.ts#L171-L179): si el modelo devuelve `create_week` dentro de `chat_action`, lo descarta y marca como truncado. Razonable, pero puede dar falsos positivos si el usuario pidió algo que el modelo (correctamente) interpretó como crear semana en vez de ajustar.
- [responseNormalizer.ts:830-841](src/services/ai/responseNormalizer.ts#L830-L841): `extractInlineActionsJson` requiere `[{`. Si el modelo devuelve `{actions: [...]}` inline (sin `<actions>` markup), no se extrae. Eso ya lo cubre `unwrapActionCandidates`, pero solo dentro del bloque `<actions>`. Si Claude o GPT devuelven el wrapper sin tags, los pierdes.
- `add_session` con `squashDetails == null` autoreparara con drills sintéticos ([responseNormalizer.ts:117-126](src/services/ai/responseNormalizer.ts#L117-L126)). Bien para no romper, riesgo de mostrar al usuario una sesión con "drills genéricos" sin avisar. **Ya tira un warn**, pero el usuario no lo ve. Considerar pasar `repairs[]` al `proposal.metadata.warnings` para mostrar un banner discreto.

### 3.5 Errores que vienen de falta de contexto deportivo

Más probable de lo que parece. Indicadores:

- `athleteProfile` slim en chat liviano. Si el usuario tiene un objetivo competitivo no ingresado y el coach no lo sabe, propuestas genéricas.
- `weekDayLogs` se trimea fuerte en `contextOptimizer` (5 logs / 900 chars total). En una semana cargada eso pierde detalle.
- `MACRO PLAN` solo se incluye con competencia <14 días: alguien en semana 1 de 12 de prep no lo recibe. Decisión defendible por costo, pero se siente.

### 3.6 Errores del provider actual (Gemini Flash)

Riesgos conocidos de Gemini 2.5 Flash que probablemente ya viste:

- **Tendencia a JSON con coma trailing** o cerrar arrays a mitad cuando se acerca a `maxOutputTokens`. Mitigado por `extractJsonArray` + repair.
- **Inconsistencia en `<actions>` cerrado**: a veces abre `<actions>` y olvida `</actions>`. Mitigado por `extractActionsText` con `openOnly`.
- **Velocidad excelente** pero **menos confiabilidad** en respuestas largas (>3500 tokens output). Eso es justo donde vive `plan_builder_pair` (5500 max). Sospechoso.

### 3.7 Matriz de evaluación de calidad (para tu uso semanal)

Una hoja de cálculo simple, alimentada por el log de feedback. 7 ejes × 3 niveles:

```
EJE                              | malo (👎) | aceptable (sin rating) | bueno (👍)
---------------------------------+----------+-----------------------+------------
Preparación física (strength)    |    ?     |          ?            |     ?
Squash técnico/táctico           |    ?     |          ?            |     ?
Running estructurado             |    ?     |          ?            |     ?
Semana completa coherente        |    ?     |          ?            |     ?
Ajuste por fatiga                |    ?     |          ?            |     ?
Plan por evento (8-12 semanas)   |    ?     |          ?            |     ?
Conversación útil (chat_general) |    ?     |          ?            |     ?
```

Regla de paso: ningún eje puede tener >20% 👎 en una ventana de 30 días con >10 datos.

---

## 4. Estrategia Gemini vs OpenAI vs Claude

Esta es la pregunta de mayor impacto en costo y calidad. Mi recomendación es opinionada.

### 4.1 Diagnóstico: qué tiene cada provider para tu caso

| Provider | Fortaleza | Debilidad | Costo input/output (1M) | Tu uso recomendado |
|---|---|---|---|---|
| **Gemini 2.5 Flash** | Velocidad, costo casi cero, free tier amplio | JSON menos confiable en respuestas largas, ocasionalmente texto sin acción | $0.075 / $0.30 | Default para todo lo simple |
| **OpenAI GPT-4o-mini** o **GPT-4.1-mini** | JSON robusto con `response_format: json_schema`, estable | 2× más caro que Flash, sin free tier real | $0.15 / $0.60 | Cuando necesitás formato estricto |
| **Claude Sonnet 4.6** | Mejor razonamiento estructurado, buen seguimiento de instrucciones largas | 20-40× más caro, más lento | $3 / $15 | Calidad pico en planes complejos |

### 4.2 Recomendación por requestClass

| RequestClass | Provider primary | Fallback | Razón |
|---|---|---|---|
| `chat_general` | Gemini Flash | Gemini Flash (retry) | Conversación, costo importa, sin JSON estricto. |
| `chat_action` | **Gemini Flash → OpenAI GPT-4.1-mini** | Gemini Flash (no fallback caro) | Action format es donde Gemini falla más. OpenAI con `tool_use`/`json_schema` es notablemente más confiable. |
| `weekly_summary` | Gemini Flash | — | Resumen narrativo, costo importa, baja exigencia de formato. |
| `week_creator` | Gemini Flash | OpenAI GPT-4.1-mini | Schema importante pero ya hay repair fuerte. Vale la pena el fallback automático ante `schema_invalid` repetido. |
| `plan_builder_week` | Gemini Flash | OpenAI | Mismo razonamiento que week_creator. |
| `plan_builder_pair` | **Claude Sonnet 4.6** o GPT-4.1-mini | Gemini Flash (último recurso) | Output largo (5500 tokens) + razonamiento de 2 semanas + relación entre ellas. Justifica el costo. Si la beta es chica, hablamos de <$1/mes extra. |
| `import_extract` | Gemini Flash | — | Extracción simple, costo importa, free tier alcanza. |

### 4.3 Lo que falta en código para ejecutar esta estrategia

**Hoy `coach.ts` no soporta routing por requestClass**. Toca un cambio acotado pero real en server-side:

```ts
// netlify/functions/coach.ts — cambio propuesto, NO implementado todavía
const PROVIDER_BY_CLASS: Partial<Record<RequestClass, ProviderName>> = {
  chat_action: parseProviderName(process.env['AI_PROVIDER_CHAT_ACTION'], 'AI_PROVIDER_CHAT_ACTION') ?? 'gemini',
  plan_builder_pair: parseProviderName(process.env['AI_PROVIDER_PLAN_PAIR'], 'AI_PROVIDER_PLAN_PAIR') ?? 'gemini',
  // resto cae a AI_PROVIDER global
}
const FALLBACK_BY_CLASS: Partial<Record<RequestClass, ProviderName>> = {
  chat_action: parseProviderName(process.env['AI_FALLBACK_CHAT_ACTION'], 'AI_FALLBACK_CHAT_ACTION'),
  week_creator: parseProviderName(process.env['AI_FALLBACK_WEEK_CREATOR'], 'AI_FALLBACK_WEEK_CREATOR'),
  // etc
}

// dentro de executeWithPolicy:
const primary = PROVIDER_BY_CLASS[requestClass]
  ?? parseProviderName(process.env['AI_PROVIDER'] ?? 'gemini', 'AI_PROVIDER')!
const fallback = FALLBACK_BY_CLASS[requestClass]
  ?? parseProviderName(process.env['AI_FALLBACK_PROVIDER'], 'AI_FALLBACK_PROVIDER')
```

Esto es **~30 líneas** de cambio en una función ya bien estructurada y hace todo el roadmap de proveedores ejecutable sin redeploys.

### 4.4 Cuándo activar fallback: solo error técnico vs también baja calidad

**Hoy** ([coach.ts:842-872](netlify/functions/coach.ts#L842-L872)): fallback solo se activa con error retryable + `partialChunks=false` + `allowFallback=true`. **No se activa por baja calidad** (ej: `outcome=parse_invalid`). Está bien para arrancar.

**Cambio recomendado para beta**: agregar un fallback "calidad" para `chat_action` y `plan_builder_pair`:

> Si el primer intento devuelve `outcome ∈ {parse_invalid, schema_invalid}` Y `allowFallback`, intentar fallback **una vez** con el provider alternativo, **antes** de devolver al cliente. Sin gastar dos intentos en el mismo provider primero.

Esto tiene un costo: el peor caso de un `chat_action` pasa de 1 intento a 1+repair=2 intentos. Pero el "missed proposal" rate baja sensiblemente.

### 4.5 Cómo comparar calidad sin duplicar costos

Tres niveles de profundidad creciente. Empezar por el primero, escalar solo si hace falta:

#### Nivel 1 — feedback humano + logs (costo extra: $0)
- Persistir `provider` + `outcome` + rating del usuario.
- Cada semana: comparar acceptance rate y rating por provider × requestClass.
- Decidir routing en base a evidencia, no a opinión.
- **Suficiente para beta de 5-10 usuarios.**

#### Nivel 2 — comparación manual asistida (costo: tu tiempo, ~1 hora/semana)
- Para cada `chat_action` o `week_creator` con 👎 (rating=-1):
  - Botón en Settings "regenerar con OpenAI" / "regenerar con Claude" que reusa el mismo prompt y compara side-by-side.
- Sin shadow request — solo on-demand, después del feedback negativo.
- Te da matrices reales sin pagar 3× cada request.

#### Nivel 3 — shadow testing controlado (costo: ~3× tokens en una muestra del 5%)
- En `coach.ts`, después del response exitoso, si `requestClass ∈ {chat_action, plan_builder_pair}` Y `Math.random() < 0.05`:
  - Disparar request paralelo con provider alternativo (sin esperarlo).
  - Loggear ambos outputs en una tabla `coach_shadow_comparison` (incluyendo prompt hash, no prompt).
- Procesar offline con un script que use otro modelo barato (Gemini Flash) como juez: "¿cuál de estas dos respuestas a este prompt es mejor para X?".
- Solo activar cuando tengas >50 usuarios y casos no obvios.

**Recomendación realista**: nivel 1 hasta 20 usuarios, nivel 2 desde el principio (es solo un botón), nivel 3 nunca antes de monetizar.

---

## 5. Riesgos antes de monetizar

Ordenados por probabilidad × impacto.

| # | Riesgo | Probabilidad | Impacto | Mitigación mínima |
|---|---|---|---|---|
| 1 | **Primer entrenamiento malo → usuario se va** | alta | alto | Onboarding con templates curados (no IA) para las 1-2 primeras sesiones; IA toma desde la sesión 3. |
| 2 | **Respuestas inconsistentes entre días** (mismo usuario, distinto provider, distinto comportamiento) | media | medio | Pinear provider por usuario en beta (`AI_PROVIDER_OVERRIDE_USER_<id>` o flag DB). |
| 3 | **Sync inconsistente multi-dispositivo** | media | alto | Bloqueado por roadmap. Requiere QA dedicado en 2 navegadores. |
| 4 | **Costos saltan al activar Claude/OpenAI sin tope** | media | alto | Monitor diario + email + freeze automático con `MAX_DAILY_COST_USD`. |
| 5 | **Trace pierde contexto cuando el usuario cierra browser mid-stream** | media | bajo | Ya hay `truncated` flag. Asegurar que la propuesta huérfana se limpia al recargar (revisar). |
| 6 | **Datos de salud expuestos** si alguien accede al log con prompts | baja | alto | NUNCA loggear prompts/respuestas completas. Solo metadata. Si necesitás caso por caso, opt-in explícito por usuario. |
| 7 | **Modelo retira/desactualiza versión** (ej Gemini 2.5 → 3.0 con cambios de API) | media en 12 meses | medio | Pinear `GEMINI_MODEL` env var. Tests de contrato por provider que corran en CI. |
| 8 | **Usuario pide algo no cubierto en biblioteca** (ej: powerlifting puro) | alta | bajo | Coach actual ya responde "no soy experto en X". Documentar en disclaimer beta. |
| 9 | **Falta de monetización clara** desincentiva pulir | alta | medio | Decidir antes de Fase 4: subscription mensual ($5-15) vs créditos. |
| 10 | **Dependencia de un solo proveedor (Gemini)** | media | medio | Routing por requestClass + fallback por requestClass (sección 4). |

---

## 6. Plan de instrumentación (para responder "¿de quién es la culpa?")

Esto es lo que recomiendo hacer **antes** de invitar al primer beta tester externo. Estimado: 4-6 días de trabajo enfocado.

### 6.1 Fase 0 — instrumentación (Pre-beta, 4-6 días)

| Trabajo | Archivos a tocar | Esfuerzo |
|---|---|---|
| Tabla Supabase `coach_request_log` + RLS | migración SQL nueva | 0.5d |
| Persistir log al final de `executeWithPolicy` | [coach.ts:756-883](netlify/functions/coach.ts#L756-L883) — agregar fire-and-forget al final | 0.5d |
| Capturar `inputTokens`/`outputTokens` por provider | `callGemini/callOpenAI/callClaude` ya devuelven los counts en `usage`, hoy se descartan | 0.5d |
| Tope diario por usuario | nueva tabla `coach_usage` + chequeo en `enforceRateLimit` | 0.5d |
| Botón 👍/👎 + textarea en `ChatBubble` y `ProposalCard` | UI components + extender `coach_proposals` schema | 1d |
| Persistir feedback en Supabase | nueva tabla `coach_feedback` | 0.5d |
| Página `/admin/quality` (solo tu user) con métricas agregadas | nueva ruta + queries | 1d |
| Routing por `requestClass` en server | sección 4.3 — cambio a [coach.ts:756-883](netlify/functions/coach.ts#L756-L883) | 0.5d |
| Tope absoluto de costo (`MAX_DAILY_COST_USD`) | nueva check en coach.ts antes de invocar provider | 0.5d |
| Smoke tests E2E de los 6 requestClass | extender `src/services/__tests__/` con un fixture por clase | 1d |
| Disclaimer beta + flag `BETA_USER_<email>` | login flow | 0.5d |

**Total**: ~6 días-persona. Esto es **lo único** que NO se puede saltar antes de invitar beta testers.

### 6.2 Fase 1 — beta interna (vos solo, 1-2 semanas)

Objetivo: cazar tus propios bugs antes de involucrar a nadie.

- Usar la app diariamente con el log activado.
- Revisar `/admin/quality` cada día.
- Ajustar prompts en base a outcomes reales (no a percepción).
- Criterio para avanzar: **success_rate > 90%** por requestClass × **0 pérdidas de datos** × **truncation_rate < 5%**.

### 6.3 Fase 2 — beta cerrada de squash (3-5 usuarios, 4 semanas)

Objetivo: validar con jugadores reales que no son vos.

- Reclutar 3-5 jugadores de squash que ya conocés. Disclaimer claro.
- Onboarding 1:1 (15 min cada uno).
- Llamada semanal de 20 min con cada uno la primera semana, después solo con quienes reporten problemas.
- Monitorear: acceptance rate, rating semanal, tokens/usuario.
- **Cambios técnicos mínimos**: ninguno nuevo, solo iterar sobre prompts y agregar fallback OpenAI en `chat_action` si la data lo justifica.
- Criterio para avanzar: **>50% de usuarios completa 3+ sesiones generadas por IA** + **rating promedio > 0.5** (en escala -1/0/+1).

### 6.4 Fase 3 — beta ampliada (10-20 usuarios, 6-8 semanas)

Objetivo: probar diversidad (running, strength, no solo squash) y reforzar determinismo donde se justifique.

- Reclutar 10-20 usuarios mixtos: 50% squash, 30% running, 20% generalistas.
- Activar **routing por requestClass**: Claude para `plan_builder_pair`, OpenAI fallback para `chat_action`.
- Implementar refactors de prompts por requestClass que arrastra el roadmap actual.
- Determinismo selectivo: `add_session simple` y `weekly_summary template` (sección 3.2).
- Criterio para avanzar a monetización: **NPS estimado > 30** + **costo IA mensual real bajo control** + **0 incidentes de pérdida de datos** + **success_rate > 95%** por requestClass.

### 6.5 Fase 4 — primera versión monetizable (cuando los criterios de Fase 3 estén verdes)

- Modelo: subscription $7-12/mes (squash boutique pricing) o créditos (50 generaciones de plan/mes).
- Onboarding pulido: video 90s + plan demo gratis.
- Stripe + portal de billing.
- Soporte: solo email, respuesta en <48h, link a "reportar problema" en cada respuesta del coach.
- Marketing: clubs de squash de Santiago + Buenos Aires + Madrid (mercados accesibles).

---

## 7. Routing por requestClass: matriz final propuesta

Para tener una sola fuente de verdad. Esta tabla cubre las preguntas 3a-3g de tu request.

| RequestClass | Provider primary (recomendado beta) | Fallback técnico | Fallback calidad (sec 4.4) | Notas |
|---|---|---|---|---|
| `chat_general` | gemini-2.5-flash | gemini (retry) | — | Bajo costo, conversación. |
| `chat_action` | gemini-2.5-flash | openai/gpt-4.1-mini | sí (parse_invalid) | Donde Gemini más falla en formato. |
| `weekly_summary` | gemini-2.5-flash | — | — | Resumen narrativo. |
| `week_creator` | gemini-2.5-flash | openai/gpt-4.1-mini | sí (schema_invalid) | Ya hay repair, OpenAI solo si repair no resuelve. |
| `plan_builder_week` | gemini-2.5-flash | openai/gpt-4.1-mini | sí (schema_invalid) | Mismo razonamiento. |
| `plan_builder_pair` | claude-sonnet-4-6 | gemini-2.5-flash | — | Output largo + razonamiento entre semanas. |
| `import_extract` | gemini-2.5-flash | — | — | Extracción de PDF, formato simple. |

### 7.1 Proyección de costo mensual con esta matriz

Para tu uso típico (~24 días activos, 60 chat_general/día, 5 chat_action/día, 2 plan_builder/mes):

```
chat_general:    240 × 800 in × 300 out × Gemini    = $0.027
chat_action:     120 × 3000 in × 800 out × Gemini   = $0.043
                  (de los cuales 10% fallback OpenAI = $0.01)
weekly_summary:    5 × 4000 in × 1000 out × Gemini  = $0.002
week_creator:      5 × 6000 in × 2500 out × Gemini  = $0.006
plan_builder_pair: 2 × 8000 in × 4000 out × Claude  = $0.13   ← donde se va el costo
import_extract:    2 × 6000 in × 2000 out × Gemini  = $0.002
TOTAL: ~$0.22/mes para uno como vos
```

Para 10 usuarios beta similares: **~$2.20/mes**. Margen brutal incluso pagando Claude para planes largos.

Si decidís NO usar Claude para `plan_builder_pair` (todo Gemini): **~$0.10/mes** para vos, **~$1/mes** para 10. Lo que decidas, no es el costo lo que aprieta — es la calidad.

---

## 8. Tests mínimos a agregar antes de la beta

Hoy ya hay ~35 tests de servicios. Lo que falta es smoke E2E del coach completo:

```
src/services/__tests__/coachSmoke.test.ts (NUEVO)
- chat_general con context vacío → no crashea
- chat_action con respuesta truncada → no crea proposal
- chat_action con doble click en accept → aplica una vez
- week_creator con perfil incompleto → mensaje educativo, no crashea
- plan_builder_pair con respuesta vacía → fallback determinístico
- proxy con AI_PROVIDER inválido → error misconfigured limpio
- coach con session expirada → 401 sin filtrar message del provider

netlify/functions/__tests__/coach.test.ts (extender si existe, crear si no)
- routing por requestClass: AI_PROVIDER_CHAT_ACTION=openai usa OpenAI cuando requestClass=chat_action
- fallback por calidad: chat_action con primer intento parse_invalid → segundo intento con fallback
- tope diario por usuario: usuario X req 61 en mismo día → 429
- tope absoluto de costo: cuando MAX_DAILY_COST_USD se supera → 503 con mensaje claro
```

Y un script de auditoría de prompts ya existe (`npm run audit:prompt`). Mantenerlo verde es no negociable.

---

## 9. Checklist accionable (en orden, sin saltarse)

Para que cuando vuelvas a este doc en una semana sepas exactamente qué hacer.

### Antes de invitar a nadie
- [ ] Crear tabla `coach_request_log` + RLS
- [ ] Persistir log + tokens en `executeWithPolicy`
- [ ] Crear tabla `coach_feedback` + UI 👍/👎 + textarea
- [ ] Crear tabla `coach_usage` + tope diario por requestClass
- [ ] Implementar routing por requestClass en `coach.ts`
- [ ] Implementar fallback por calidad en `chat_action`
- [ ] Página `/admin/quality` con métricas agregadas
- [ ] `MAX_DAILY_COST_USD` con freeze automático
- [ ] Smoke tests E2E de los 6 requestClass
- [ ] Disclaimer beta + flag de usuario beta
- [ ] Sincronizar `OPTIMIZATION_AND_COSTS.md` con la realidad de `coach.ts`
- [ ] Resolver `ProxyProvider.name = 'gemini'` hardcoded
- [ ] Validar sync multi-dispositivo (tarea pendiente del roadmap, **bloqueante**)

### Durante Fase 1 (beta interna, vos)
- [ ] Usar la app diaria por 1-2 semanas
- [ ] Revisar `/admin/quality` cada día
- [ ] Ajustar prompts SOLO en base a outcomes reales
- [ ] Tener `chat_action` `success_rate > 90%` antes de invitar a nadie

### Durante Fase 2 (3-5 usuarios)
- [ ] Onboarding 1:1 con cada uno
- [ ] Llamada semanal primera semana
- [ ] Decidir si activar OpenAI fallback en `chat_action` (en base a data, no a opinión)
- [ ] Revisar feedback con un proceso semanal de 30 min

### Antes de Fase 3 (10-20 usuarios)
- [ ] Routing diferenciado por requestClass activo en producción
- [ ] Determinismo selectivo en `add_session simple` y `weekly_summary template`
- [ ] Refactor de `promptBuilder.ts` por requestClass (sección refactor #3 del roadmap)

### Antes de Fase 4 (monetización)
- [ ] NPS estimado > 30 sostenido por 4 semanas
- [ ] Costo IA real medido y bajo $5/usuario/mes
- [ ] success_rate > 95% por requestClass
- [ ] 0 incidentes de pérdida de datos en últimos 30 días
- [ ] Decidir modelo (subscription vs créditos)
- [ ] Stripe + portal billing

---

## 10. Lo que NO hay que hacer

- No agregar más providers (xAI, Mistral, etc) hasta validar fundamentals.
- No reescribir `promptBuilder.ts` antes de la beta. Es grande pero funciona.
- No agregar fine-tuning ni RAG vector. Estás muy lejos de necesitar eso.
- No hacer shadow testing antes de tener feedback humano que justifique las hipótesis a probar.
- No habilitar Claude para todos los requestClass — su costo es 20-40× Gemini.
- No bloquear sync issues con "después arreglamos" — son el mayor riesgo declarado del propio roadmap.
- No agregar UI elaborada de "explicabilidad de la IA" — el usuario quiere entrenar, no auditar.

---

## Cierre

La app **no necesita más features**. Necesita:
1. Saber qué pasa cuando la usa alguien que no es vos.
2. Ruteo selectivo de providers para optimizar calidad-costo donde importa.
3. Topes para que el experimento no explote en costo.

Lo bueno: estas 3 cosas son entre 1 y 6 días de trabajo cada una. La parte más difícil ya está hecha (la app funciona, el coach responde, el repair y normalize ya clasifican errores). Falta cerrar el loop con datos persistidos y un botón 👎.

Después de eso, la beta cerrada con 3-5 usuarios va a darte más información en 4 semanas que cualquier refactor.
