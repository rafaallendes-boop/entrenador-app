# Coach Planner Improvements

Implementado: 2026-03-30

---

## 1. Problema detectado

El Coach respondía como chatbot conversacional. Al pedirle "créame una semana" o "agrega un running el jueves", respondía solo con texto sin crear nada en la app.

---

## 2. Causa raíz

Tres problemas independientes que juntos bloqueaban la planificación real:

### A. Tipos de acción incompletos (causa principal)
`CoachActionType` en `src/types/index.ts` solo tenía 7 tipos:
`skip_session`, `change_rpe`, `shorten_session`, `lengthen_session`, `move_session`, `replace_session_type`, `insert_recovery`

**Ninguno de estos crea sesiones nuevas.** El modelo no podía crear una semana porque literalmente no existía la acción `create_week` ni `add_session`.

### B. Prompt con rol equivocado
El `buildPersonaSection` decía "Eres el coach personal de alto rendimiento" con instrucciones conversacionales. El modelo se comportaba como asistente de chat, no como planificador. La instrucción decía "Solo incluye `<actions>` si tienes propuestas reales y concretas" — sin contexto de que puede crear sesiones, el modelo no generaba acciones.

### C. Prompt sin fechas de la semana
El `buildResponseInstructions` no incluía las fechas absolutas de los días de la semana actual (YYYY-MM-DD). El modelo no sabía en qué fechas crear sesiones. Además, si no había sesiones en la semana, `buildSessionsSection` retornaba string vacío — el modelo interpretaba que no había nada que hacer.

---

## 3. Cambios implementados

### `src/types/index.ts`
- Agregado `add_session`, `create_week`, `delete_session` a `CoachActionType`
- Nuevo interface `CoachSessionProposal` — schema de sesión para propuestas
- Nuevos campos en `CoachAction`: `sessionType`, `title`, `durationMin`, `timeBlock`, `objective`, `subtype`, `runningType`, `sessions`

### `src/services/ai/responseNormalizer.ts`
- Agregados nuevos tipos a `VALID_ACTION_TYPES`
- Validación para `add_session` (requiere targetDate, sessionType, title, durationMin, timeBlock)
- Validación para `create_week` (requiere sessions array no vacío)
- Validación para `delete_session` (requiere sessionId)

### `src/services/ai/promptBuilder.ts` (reescritura completa)
- **Persona reescrita**: coach-planner primero, advisor segundo. Reglas claras: "si el usuario pide crear semana → DEBES usar create_week"
- **Semana vacía**: cuando no hay sesiones, el prompt ahora dice explícitamente que puede crearlas con `create_week`
- **Fechas de la semana**: se calculan los 7 días (YYYY-MM-DD) de la semana actual y se incluyen en el prompt siempre — el modelo sabe exactamente en qué fechas crear sesiones
- **Perfil por defecto**: semana base típica de Rafael incluida como referencia para propuestas
- **Ejemplos concretos**: el prompt incluye un ejemplo completo de `create_week` y `add_session` con fechas reales de la semana actual
- **Schema de sesión**: documentado en el prompt — el modelo sabe qué campos incluir

### `src/store/useTrainingStore.ts`
- Agregado `deleteSession(id)` — elimina sesión de Dexie, recalcula summary, actualiza estado

### `src/store/useCoachActionsStore.ts`
- Ejecutor `add_session`: crea sesión individual con todos los campos (date, timeBlock, type, subtype, title, durationMin, rpe, objective, runningDetails)
- Ejecutor `create_week`: itera sobre el array `sessions` y crea cada una via `store.addSession`
- Ejecutor `delete_session`: llama a `store.deleteSession` con resolución de prefijo

### `src/pages/ChatCoach.tsx`
- `ACTION_LABEL` actualizado con etiquetas para nuevos tipos
- `ProposalDrawer` mejorado:
  - Para `create_week`: muestra header con conteo de sesiones y lista detallada
  - Para `add_session`: muestra fecha, timeBlock, título y duración
  - Fixes menores: checks de `!= null` en lugar de `'field' in action`
- `AcceptedBanner` nuevo: banner verde que aparece después de aceptar propuesta
  - Para `create_week`: "Listo. Semana creada con N sesiones: X squash, Y running..."
  - Para `add_session`: "Sesión 'Título' agregada al YYYY-MM-DD."
  - Para otros: "N cambio(s) aplicado(s) correctamente."
- Subtítulo del header: "Planner · Advisor" para dejar claro el rol

---

## 4. Acciones soportadas

| Acción | Requiere | Descripción |
|--------|----------|-------------|
| `create_week` | `sessions[]`, `reason` | Crea múltiples sesiones de una vez |
| `add_session` | `targetDate`, `timeBlock`, `sessionType`, `title`, `durationMin`, `reason` | Agrega una sesión individual |
| `skip_session` | `sessionId`, `reason` | Marca sesión como saltada |
| `change_rpe` | `sessionId`, `newRpe`, `reason` | Cambia RPE planificado |
| `shorten_session` | `sessionId`, `newDurationMin`, `reason` | Acorta duración |
| `lengthen_session` | `sessionId`, `newDurationMin`, `reason` | Alarga duración |
| `move_session` | `sessionId`, `targetDate`, `reason` | Mueve a otra fecha |
| `replace_session_type` | `sessionId`, `newType`, `reason` | Cambia tipo de disciplina |
| `insert_recovery` | `targetDate`, `reason` | Inserta sesión de recuperación |
| `delete_session` | `sessionId`, `reason` | Elimina sesión del calendario |

---

## 5. Flujo completo

```
Usuario: "Créame una semana de entrenamiento"
    ↓
buildCoachSystemPrompt(context)
    → Persona: coach-planner, prioridad es crear acciones
    → Semana: fechas absolutas 2026-03-30 ... 2026-04-05
    → Sesiones: "⚠ No hay sesiones — usa create_week"
    → Instrucciones: REGLA CRÍTICA: si pide crear semana → create_week
    → Ejemplo concreto con fechas reales de la semana
    ↓
AI responde:
    "Listo, te armé una semana base. Priorizando squash como siempre."

    <actions>
    [{"type":"create_week","sessions":[
      {"date":"2026-03-30","timeBlock":"PM","sessionType":"squash",...},
      {"date":"2026-03-31","timeBlock":"AM","sessionType":"running",...},
      ...6 sesiones total...
    ],"reason":"semana base para Rafael"}]
    </actions>
    ↓
responseNormalizer.normalizeResponse(raw)
    → extrae bloque <actions>
    → valida create_week: sessions array no vacío ✓
    → message = "Listo, te armé una semana base..."
    → actions = [{ type: "create_week", sessions: [...] }]
    ↓
useChatStore
    → response.actions existe → useCoachActionsStore.addProposal(...)
    → ChatMessage guardado con proposalId
    ↓
ChatBubble muestra "⚡ Ver propuesta" con header "Semana propuesta · 6 sesiones"
    ↓
Usuario toca "Aplicar cambios"
    ↓
useCoachActionsStore.acceptProposal(id)
    → applyCoachAction(create_week)
    → itera sessions → store.addSession() × 6
    → cada addSession → db.sessions.add() + recalculateWeekSummary()
    ↓
AcceptedBanner: "Listo. Semana creada con 6 sesiones: 2 squash, 2 running, 1 fuerza, 1 movilidad."
WeeklyView se actualiza automáticamente (Zustand reactive)
```

---

## 6. Prompts válidos

### Crear semana
- "Créame una semana de entrenamiento"
- "Armame una semana priorizando squash"
- "Planifica mi semana"
- "Créame tú una semana base"

### Agregar sesión
- "Agrega un running Z2 el jueves"
- "Agrega fuerza upper el viernes AM"
- "Pon movilidad de caderas mañana"
- "Agrega un squash el miércoles PM"

### Ajustar semana (requiere sesiones existentes)
- "Baja la carga del fin de semana"
- "Muévelo al sábado"
- "Estoy cansado, acorta la sesión de mañana"
- "Cambia el running del jueves por movilidad"

---

## 7. Limitaciones pendientes

- **Squash subtype en ProposalDrawer**: el drawer no muestra el subtype (training/match/etc) en la lista de sesiones de create_week — es cosmético
- **Historial de chat limitado**: se envían solo los últimos 4 mensajes al modelo — conversaciones largas pierden contexto
- **Resolución de días relativos**: si el usuario dice "el próximo martes" sin fechas claras, el modelo puede equivocarse — mejor usar siempre fechas absolutas o aclarar "¿te refieres al YYYY-MM-DD?"
- **create_week no detecta colisiones**: si ya hay sesiones en la semana y se crea una semana nueva, pueden quedar duplicadas — el executor no verifica conflictos
- **Propuestas en memoria**: los `CoachProposal` se pierden al recargar la app (no están en Dexie)

---

## 8. Próximos pasos recomendados

1. **Detección de colisiones en create_week**: antes de crear, verificar si ya hay sesiones en esas fechas y notificar al usuario
2. **Persist proposals en Dexie**: agregar tabla `coachProposals` en db.ts v4 migration
3. **Historial completo en prompt**: incluir los últimos 6-8 mensajes en vez de 4
4. **QuickActionChips actualizar**: agregar "Crear semana" y "Agrega sesión" como chips predefinidos
5. **Streaming**: usar streaming de la API para mostrar la respuesta en tiempo real
6. **Confirmación en WeeklyView**: después de create_week, navegar automáticamente a la vista semanal
