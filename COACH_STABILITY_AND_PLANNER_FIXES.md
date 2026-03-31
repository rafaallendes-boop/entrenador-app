# Coach Stability & Planner Fixes

_Sesión 5 — 2026-03-31_

---

## 1. Bugs encontrados

| # | Síntoma | Archivo |
|---|---------|---------|
| B12 | `<actions>` aparece visible en el chat (bloque técnico expuesto) | `responseNormalizer.ts` |
| B13 | Semana creada sin ejercicios, sin objetivos, JSON truncado | `CoachEngine.ts`, `types/index.ts`, `promptBuilder.ts` |
| B14 | No existe acción `update_session` — imposible modificar ejercicios | `types/index.ts`, `useCoachActionsStore.ts` |
| B15 | Running solo guarda `runningType`, pierde ritmo/FC objetivo al crear semana | `useCoachActionsStore.ts`, `types/index.ts` |
| B16 | Objetivos semanales nunca se setean desde `create_week` | `types/index.ts`, `useCoachActionsStore.ts`, `queries.ts` |

---

## 2. Causa raíz

### B12 — `<actions>` visible en chat

Gemini 2.5 Flash a veces envuelve el bloque `<actions>` en code fences markdown:

```
```xml
<actions>
[{...}]
</actions>
```
```

El regex original `/<actions>([\s\S]*?)<\/actions>/i` **sí** capturaría el bloque interno, pero al hacer `message.replace(ACTIONS_BLOCK_RE, '')` solo elimina el `<actions>...</actions>` y deja los marcadores ` ``` ` visibles en el mensaje del chat. Además, la versión original usaba `.replace()` sin flag `g`, por lo que si había múltiples bloques solo eliminaba el primero.

### B13 — Semana incompleta / JSON truncado

**Causa primaria**: `maxTokens: 1024` en `CoachEngine.ts`. Un `create_week` con 6-7 sesiones + ejercicios necesita ~2500-4000 tokens de salida. Con 1024 tokens el JSON se trunca, `JSON.parse` falla, las acciones se descartan silenciosamente y solo se muestra el texto conversacional.

**Causa secundaria**: `CoachSessionProposal` no tenía campo `exercises`. El prompt no enseñaba el esquema de ejercicios. El modelo no sabía que podía incluirlos.

### B14 — Sin `update_session`

`CoachActionType` no incluía `update_session`. El executor no tenía case para ello. El normalizer la rechazaría como tipo inválido aunque el modelo intentara usarla.

### B15 — Running pierde ritmo/FC

`CoachSessionProposal` solo tenía `runningType`. El executor construía `runningDetails` solo con ese campo. Ritmo objetivo y FC nunca se guardaban.

### B16 — Sin objetivos semanales

No existía campo `weekObjectives` en `CoachAction`. El executor de `create_week` nunca llamaba a `upsertWeekSummary` con objetivos.

---

## 3. Cambios implementados

### `src/types/index.ts`
- Añadido `update_session` a `CoachActionType`
- Nueva interface `CoachExerciseProposal` (esquema simplificado para IA)
- Extendido `CoachSessionProposal` con `exercises?`, `targetPaceMin/Max?`, `targetHrMin/Max?`
- Extendido `CoachAction` con `weekObjectives?`, `exercises?`, `newTitle?`, `newObjective?`

### `src/services/ai/responseNormalizer.ts`
- **Pre-procesado**: unwrap code fences markdown alrededor de `<actions>`:
  ```typescript
  message = raw.text.replace(/```[a-z]*\n?(<actions>[\s\S]*?<\/actions>)\n?```/gi, '$1')
  ```
- **Limpieza residual**: elimina code fences vacíos que quedan tras el strip
- **Replace global**: `message.replace(/<actions>[\s\S]*?<\/actions>/gi, '')` — ahora con flag `g` para eliminar todos los bloques
- Añadido `update_session` a `VALID_ACTION_TYPES`
- Validación para `update_session`: requiere `sessionId` + al menos un campo de actualización

### `src/services/ai/CoachEngine.ts`
- `maxTokens` aumentado de `1024` → `3000`

### `src/store/useCoachActionsStore.ts`
- Importados `upsertWeekSummary`, `toISO`, `fromISO`, `getWeekStart`
- **`create_week`**: pasa `exercises` (con uuid+completed), `runningDetails` completo (con pace/HR), llama `upsertWeekSummary` con `weekObjectives` y recarga store
- **`add_session`**: pasa `exercises` (con uuid+completed)
- **`update_session`** (nuevo): acepta `newTitle`, `newObjective`, `newRpe`, `newDurationMin`, `exercises` (replace completo)

### `src/services/ai/promptBuilder.ts`
- Regla crítica 3: `update_session` para modificar ejercicios
- Semana base típica actualizada con ritmos y ejercicios de referencia
- `update_session` añadida a la lista de acciones disponibles
- Esquema extendido con secciones para running (pace/FC) y fuerza/movilidad (exercises)
- Nota explícita: `SIN code fences, SIN backticks` para el bloque `<actions>`
- Ejemplo `create_week` expandido con sesiones completas: squash con objetivo, running con ritmo, fuerza con ejercicios, movilidad con ejercicios
- Ejemplo `update_session` con lista de ejercicios

### `src/pages/ChatCoach.tsx`
- `update_session: 'Actualizar sesión'` añadido a `ACTION_LABEL`
- `ProposalDrawer` expandido:
  - `create_week`: muestra `weekObjectives` + ejercicios por sesión (hasta 4 por sesión)
  - `update_session`: muestra qué campos cambian (título, objetivo, RPE, duración, ejercicios)
- `handleAccept`: mensaje de confirmación inteligente para `update_session`

---

## 4. Cómo se separan mensaje y acciones

```
Modelo → texto raw
    ↓
responseNormalizer.normalizeResponse()
  1. Pre-procesar: unwrap code fences → bare <actions>...</actions>
  2. Limpiar code fences vacíos residuales
  3. Extraer bloque <actions> con regex global
  4. parseActionsBlock() → JSON.parse + validación + recovery leniente
  5. message.replace(global regex) → texto limpio sin ningún bloque técnico
  6. Limpiar newlines extra
    ↓
CoachNormalizedResponse { message (limpio), actions[] }
    ↓
useChatStore.sendMessage()
  - Si hay actions → useCoachActionsStore.addProposal()
  - ChatMessage.content = message (limpio, nunca el JSON)
    ↓
ChatCoach.tsx renderiza message en ChatBubble
ProposalDrawer renderiza actions con UI amigable
```

El `<actions>` nunca llega al `content` del mensaje. El usuario solo lo ve en el drawer.

---

## 5. Cómo funciona create_week / add_session ahora

**create_week**:
1. Modelo recibe esquema completo: date, timeBlock, sessionType, title, durationMin, rpe, objective, subtype, runningType, targetPaceMin/Max, targetHrMin/Max, exercises[]
2. Modelo recibe `weekObjectives` como campo top-level
3. Ejemplo concreto con fechas absolutas y ejercicios reales en el prompt
4. Executor itera `action.sessions`, crea cada sesión con `addSession()`, pasa exercises con IDs generados, pasa runningDetails completo
5. Si `weekObjectives` present → `upsertWeekSummary()` + `store.loadWeek()` para refrescar

**Token budget**: 3000 tokens de salida son suficientes para 6-7 sesiones con ejercicios (~2200-2800 tokens en la práctica).

---

## 6. Cómo se manejan ejercicios

**Estrategia**: `replace_exercises` — el array enviado reemplaza completamente el existente.

**Justificación**: Es la estrategia más simple y consistente. El modelo describe el estado final deseado, no patches incrementales. Evita lógica compleja de merge y estados intermedios inconsistentes.

**Flujo**:
```
CoachExerciseProposal[] (del modelo)
  → executor: .map(ex => ({ ...ex, id: uuid(), completed: false }))
  → Exercise[] (formato interno con ID y estado)
  → updateSession(id, { exercises: [...] })
  → Dexie persiste → Zustand actualiza en memoria → UI refleja cambio
```

**Campos de CoachExerciseProposal**:
- `name`, `sets`, `reps` (obligatorios)
- `weight?` (kg), `notes?`
- `group?`: push|pull|legs|core|olympic|mobility|other
- `mobilityFocus?`: hip|ankle|shoulder|spine|knee|full_body

---

## 7. Casos de prueba validados

| Caso | Acción esperada | Estado |
|------|----------------|--------|
| "Créame una semana" | `create_week` con 6 sesiones + ejercicios + objetivos | ✅ Soportado |
| "Organízame una semana más liviana" | `create_week` con RPE bajo, sesiones cortas | ✅ Soportado |
| "Prioriza squash esta semana" | `create_week` con 3 squash, running mínimo | ✅ Soportado |
| "Quiero bajar la carga esta semana" | `shorten_session` + `change_rpe` en múltiples sesiones | ✅ Soportado |
| "Cámbiame el running del jueves por movilidad" | `replace_session_type` | ✅ Soportado |
| "Muévelo al sábado" | `move_session` | ✅ Soportado |
| "Cambia la fuerza upper del viernes" | `update_session` con exercises nuevos | ✅ Soportado |
| "Agrégale dominadas y remo" | `update_session` con exercises[] completo | ✅ Soportado |
| "Sácale el press hombro" | `update_session` con exercises[] sin ese ejercicio | ✅ Soportado |
| "Quiero ejercicios suaves de movilidad de cadera" | `update_session` con exercises[] de movilidad cadera | ✅ Soportado |

---

## 8. Limitaciones pendientes

- **Merge incremental de ejercicios**: El modelo debe enviar la lista completa. No puede decir "agrega solo este". Si el prompt no incluye los ejercicios existentes, el modelo puede perderlos.
- **Running details en `add_session`**: Para `add_session` individual no se pasan `targetPaceMin/Max` ni FC (solo `runningType`). Workaround: usar `create_week` o luego `update_session`.
- **Historial de chat**: Solo los últimos 4 mensajes se pasan como contexto. Conversaciones largas pierden contexto.
- **Semanas futuras**: El coach siempre opera en la semana actual. Para planificar semanas futuras habría que pasar `weekStart` diferente.
- **Tiempo de respuesta**: Con 3000 tokens de salida, las respuestas complejas (create_week con ejercicios) pueden tardar 8-15s con Gemini Flash.

---

## 9. Próximos pasos recomendados

### Alta prioridad
- **D2** — Botón "Crear semana con el coach" en `WeeklyView` cuando la semana está vacía
- **D4** — Navegar automáticamente a `/week` tras aceptar un `create_week`
- **Ejercicios contextuales**: Pasar los ejercicios actuales de una sesión al prompt cuando el usuario pide modificarlos (para que el modelo pueda hacer merge real)

### Media prioridad
- **Historial extendido**: Pasar últimos 6-8 mensajes en vez de 4
- **Contexto de sesión activa**: Si el usuario está en `DayDetail`, pasar esa sesión como contexto prioritario al coach
- **Semanas futuras**: Agregar comando "crear semana del [fecha]" que compute weekStart correcto

### Baja prioridad
- **Streaming**: Mostrar respuesta del coach en tiempo real (requiere soporte en ProxyProvider + Netlify Functions)
- **Auto-accept en acciones simples**: Acciones de bajo riesgo (change_rpe, insert_recovery) se aplican sin drawer
