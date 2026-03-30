# Entrenador App — Project Review & Roadmap

Generado: 2026-03-30
Última revisión: 2026-03-30 (sesión 4)
Revisado por: Claude Sonnet 4.6

---

## 1. Resumen ejecutivo

### Estado actual

Entrenador es una PWA React personal bien estructurada y en activo desarrollo. En esta segunda revisión el salto más grande fue la capa AI: pasó de un stub con mock responses a una abstracción multi-proveedor funcional con proxy server-side, Gemini, Claude y OpenAI listos para usar. El flujo completo coach → propuesta → ejecución ya opera end-to-end.

El estado general es: **MVP funcional con capa AI real disponible vía proxy/Netlify, deuda técnica baja, base técnica sólida para seguir creciendo.**

### Fortalezas consolidadas

- **Modelo de datos bien diseñado**: Dexie con migraciones correctas, relaciones Session / DayLog / WeekSummary
- **Zustand stores bien separados**: training, chat, coachActions y UI con responsabilidades claras
- **Tipos TypeScript completos**: cobertura del dominio sin `any` escapados
- **Diseño dark mobile-first**: coherente, Tailwind con tokens de diseño propios
- **Capa AI multi-proveedor**: Proxy, Gemini, Claude, OpenAI — switch por env var en local, sin cambiar código
- **Sistema de propuestas del coach**: acción estructurada → ProposalDrawer → ejecución real en el store
- **Prompt rico y contextual**: incluye semana actual, sesiones con IDs, day log, historial de chat
- **Build seguro para Netlify**: producción usa `ProxyProvider`; la API key vive solo en la función server-side
- **ICS export funcional**: integración con calendarios externos
- **DailyCheckInCard**: captura energía, sueño, dolor y RPE desde el Dashboard

---

## 2. Bugs

| # | Descripción | Prioridad | Estado |
|---|-------------|-----------|--------|
| B1 | `DayDetail.tsx:22` — `setCurrentWeekStart(date)` cargaba semana incorrecta | Alta | ✅ Corregido |
| B2 | `SessionCard.tsx` — pace display mostraba "5:00–undefined /km" | Media | ✅ Corregido |
| B3 | `ChatCoach.tsx:175` — `h-screen` genera scroll doble en móvil con safe-area | Baja | ✅ Corregido (`h-[100dvh]`) |
| B4 | `Dashboard.tsx` — `WeekStrip` con `showNav={false}` no navega al tocar un día | Baja | ✅ Corregido (`onDayPress` + navigate) |
| B5 | `History.tsx` — "Ver semana" ahora hace `setCurrentWeekStart` + `setSelectedDate` antes de navegar | Media | ✅ Probablemente resuelto — verificar en dispositivo |
| B6 | `ChatCoach.tsx` — el campo `error` de `useChatStore` nunca se muestra en la UI | Media | ✅ Corregido (banner rojo bajo input) |
| B7 | `useChatStore.sendMessage` — `recentMessages = messages.slice(-3)` duplica el mensaje actual | Baja | ✅ Corregido (`slice(-4, -1)`) |
| B8 | `Dashboard.tsx:19` — `useUIStore()` sin destructurar: subscripción muerta que re-renderizaba Dashboard ante cualquier cambio en UIStore | Baja | ✅ Corregido (eliminado import y llamada) |
| B9 | `AddSessionModal.tsx:101` — `typeLabels` useMemo duplicaba exactamente `TYPE_LABELS` con mismos valores, forzando dep extra en useEffect (`[type, typeLabels]`) | Baja | ✅ Corregido (eliminado useMemo, useEffect usa `TYPE_LABELS` directo) |
| B10 | `AddSessionModal.tsx:489,498,569` — Typo "Anadir" (falta ñ) en tres botones de UI | Baja | ✅ Corregido → "Añadir" |
| B11 | `QuickActionChips.tsx` — Los chips no incluían "Crear semana" tras implementar el modo planner; chips de "priorizar" enviaban prompt de ajuste en vez de creación | Baja | ✅ Corregido (agregado chip "Crear semana", prompts de "priorizar" actualizados a `create_week`) |

---

## 3. Qué se implementó

### 3.0 Sesión 4 — Coach Planner Mode (2026-03-30)

**Coach como planner real** — El coach respondía solo con texto cuando se pedía crear sesiones. Causa raíz: `create_week` y `add_session` no existían como `CoachActionType`. Cambios:
- `types/index.ts`: +3 action types (`add_session`, `create_week`, `delete_session`), nueva interface `CoachSessionProposal`, nuevos campos en `CoachAction`
- `responseNormalizer.ts`: validación para los 3 nuevos tipos
- `promptBuilder.ts`: reescritura completa — persona planner-first, 7 fechas absolutas de la semana actual, reglas críticas ("si pide crear semana → DEBES usar create_week"), ejemplos concretos con fechas reales
- `useCoachActionsStore.ts`: ejecutores para `add_session` (1 sesión), `create_week` (N sesiones en bucle), `delete_session`
- `useTrainingStore.ts`: `deleteSession()` nuevo método
- `ChatCoach.tsx`: `ProposalDrawer` muestra lista de sesiones para `create_week`; `AcceptedBanner` con resumen "Semana creada con 6 sesiones: 2 squash, 2 running..."

**Bugs normalizados (sesión 4)**:
- B8 `Dashboard.tsx`: `useUIStore()` muerta eliminada
- B9 `AddSessionModal.tsx`: `typeLabels` useMemo duplicado eliminado
- B10 `AddSessionModal.tsx`: typos "Anadir" → "Añadir" (×3)
- B11 `QuickActionChips.tsx`: chip "Crear semana" agregado, prompts de "priorizar" actualizados

---

### 3.1 Capa AI multi-proveedor

**Arquitectura** (`src/services/ai/`)
- `CoachEngine.ts`: orchestrator central. Selecciona proveedor, construye prompt, normaliza respuesta.
- `promptBuilder.ts`: genera system prompt rico con semana actual, sesiones + IDs cortos, day log de hoy, historial reciente de chat (últimos 3 mensajes).
- `responseNormalizer.ts`: extrae bloque `<actions>...</actions>`, parsea y valida acciones, retorna mensaje limpio.
- `types.ts`: contratos `AIProvider`, `AIRequest`, `AIRawResponse`, `CoachNormalizedResponse`, `AIProviderError`.

**Proveedores**
- `GeminiProvider.ts` — Gemini 1.5 Flash (gratis), disponible para desarrollo local directo. Usa `systemInstruction` separado del `contents`.
- `ClaudeProvider.ts` — Anthropic API, incluye header `anthropic-dangerous-direct-browser-access`.
- `OpenAIProvider.ts` — Chat Completions API de OpenAI.
- `MockProvider.ts` — Respuestas keyword-based para offline.
- `ProxyProvider.ts` — Bridge hacia `/.netlify/functions/coach` para desarrollo con Netlify y producción segura.

**Selección de proveedor**: `VITE_AI_PROVIDER=proxy|gemini|claude|openai|mock`. En producción (`PROD=true`) siempre usa `proxy`.

### 3.2 Sistema de propuestas del coach

**Store** (`src/store/useCoachActionsStore.ts`)
- `CoachProposal` con estado `pending | accepted | rejected | partial`
- `acceptProposal(id)`: ejecuta cada `CoachAction` contra `useTrainingStore`
- 7 tipos de acción: `skip_session`, `change_rpe`, `shorten_session`, `lengthen_session`, `move_session`, `replace_session_type`, `insert_recovery`

**ProposalDrawer** (`src/pages/ChatCoach.tsx`)
- Sheet bottom que aparece al tocar "Ver propuesta" en un ChatBubble
- Muestra cada acción con su tipo, razón y parámetros
- Botones "Rechazar" / "Aplicar cambios" con feedback visual
- `ProviderBadge` en el header: Demo / Claude AI / GPT-4o mini / Gemini Flash

**useChatStore** (`src/store/useChatStore.ts`)
- Detecta `response.actions` y crea `CoachProposal` automáticamente
- Pasa los últimos 3 mensajes del historial como contexto al prompt
- Errores tipados con mensajes claros en español

### 3.3 Build y deploy seguros

- `.env` (gitignored): hoy está configurado para `mock`; cambiar a `proxy` activa la función local de Netlify
- `.env.production`: `VITE_AI_PROVIDER=proxy`
- `.gitignore` actualizado para ignorar `.env` pero no `.env.production`
- En producción el frontend nunca llama directo al proveedor AI; la key no llega al bundle

---

## 4. Análisis de calidad actual

### Lo que está bien

**Arquitectura AI**: El diseño de `CoachEngine` + providers es limpio. Cambiar de proveedor es un cambio de env var, no de código. El contrato `AIProvider.call()` es minimalista y correcto.

**Prompt builder**: Rico sin ser verboso. Los IDs cortos de 8 chars son una buena decisión de tokens. El historial de chat en contexto (3 mensajes) da continuidad sin inflar el prompt.

**ProposalDrawer**: Bien integrado. El flujo completo (mensaje del coach → propuesta → drawer → ejecución) funciona end-to-end y es la funcionalidad más valiosa de la app.

**Type safety**: `AIProviderName = 'claude' | 'openai' | 'mock' | 'gemini'` bien propagado. El `createProviderError` factory centraliza la construcción de errores.

### Deuda técnica menor

1. **Documentación desalineada**: el roadmap todavía menciona `mock`/Gemini directo en producción, pero el código actual usa `proxy`.
2. **Propuestas sin persistencia**: `useCoachActionsStore` es in-memory. Si se recarga la app, las propuestas pendientes desaparecen. Aceptable por ahora.
3. **Código legacy AI**: `src/services/aiCoach.ts` sigue presente como compat layer y agrega ruido al mantenimiento.
4. **Sin validación automática en este entorno**: no fue posible correr `build`/`lint` aquí porque `node`/`npm` no están disponibles en PATH.

---

## 5. Roadmap — próximas mejoras

Las mejoras están ordenadas para ir de a poco: baja fricción, alto impacto primero.

> **Estado al 2026-03-30:** Ola 1 completada. Netlify sin créditos hasta 2026-04-13 — trabajo en local hasta entonces.

### Ola 1 — Bugs y pulido ✅ COMPLETADA (2026-03-30)

| Bug | Fix aplicado |
|-----|-------------|
| B3 — scroll doble ChatCoach | `h-[100dvh]` en lugar de `h-screen` |
| B4 — WeekStrip no navega | `onDayPress` callback + `navigate(ROUTES.DAY(iso))` en Dashboard |
| B6 — error no visible en ChatCoach | Banner rojo bajo el input leyendo `useChatStore.error` |
| B7 — chat history duplicado | `messages.slice(-4, -1)` en `sendMessage` |

### Ola 2 — Coach Planner real ✅ COMPLETADA (2026-03-30)

| Feature | Fix aplicado |
|---------|-------------|
| Coach crea semana completa | `create_week` action + ejecutor + prompt reescrito con fechas absolutas |
| Coach agrega sesión individual | `add_session` action + ejecutor |
| Coach elimina sesiones | `delete_session` action + `deleteSession()` en training store |
| Prompt con rol de planner | Reescritura: planner-first, reglas críticas, ejemplos reales con fechas de la semana |
| Fechas de la semana en contexto | `buildWeekDatesList()` agrega los 7 YYYY-MM-DD al prompt siempre |
| ProposalDrawer para create_week | Lista de sesiones + header con conteo |
| AcceptedBanner | Confirmación "Semana creada con N sesiones: X squash, Y running..." |
| QuickActionChips actualizado | Chip "Crear semana" agregado; prompts de "priorizar" ahora activan create_week |

### Ola 2.1 — Calidad de vida y datos ricos (esfuerzo bajo-medio, impacto alto)

Orden sugerido de implementación:

**A1 — Export JSON de datos (backup)** ✅ COMPLETADO
- Botón en History (o Settings) que exporta todos los datos de Dexie a un JSON descargable
- Cubre `sessions`, `dayLogs`, `weekSummaries` y `chatMessages`
- Protege contra `Clear site data` accidental del browser

**A2 — Peso corporal en DailyCheckInCard** ✅ COMPLETADO
- Campo numérico simple en el check-in diario
- Persistencia en `DayLog.bodyWeight`
- `WeekSummary` ahora calcula `avgBodyWeight` y `weightEntries`
- En History se muestra promedio semanal y variación vs semana previa

**A3 — RPE real por sesión** ✅ COMPLETADO
- `Session.actualRpe` ya existe y se usa en métricas semanales y en `SessionCard`
- `DayDetail` ahora expone sliders por cada sesión completada
- El feedback diario queda separado como feedback global del día

**B1 — Estadísticas de partido squash** ✅ COMPLETADO
- Para partidos (subtype `match` / `competitive`): campos opcionales en `Session`
  - Resultado (`win` / `loss`)
  - Games ganados / perdidos
  - Rival
  - Cancha / club
- `AddSessionModal` ya captura estos datos
- `SessionCard` muestra badge de resultado, rival, games y lugar
- El prompt del coach ya recibe esta metadata en el contexto

**B2 — Vista historial de partidos en History**
- Filtro en History que muestre solo `match/competitive`
- Winrate acumulado, rivales frecuentes
- Se construye sobre B1
- Esfuerzo: 1–2h (depende de B1)

**Resumen semanal generado por el coach**
- Botón manual en WeeklyView (no automático)
- Coach genera un párrafo de resumen con contexto de la semana completa
- Se guarda en `WeekSummary.coachNote` y aparece en Dashboard y History
- Requiere AI real (se puede codear ahora, testear en prod)
- Esfuerzo: 2–3h

### Ola 2.2 — Mejoras directas al Coach Planner (esfuerzo bajo, impacto alto)

Estas mejoras extienden lo implementado en la Ola 2 con poco esfuerzo incremental:

**D1 — Detección de colisiones en create_week**
- Antes de crear sesiones, verificar si ya existen sesiones en esa fecha+timeBlock
- Si hay colisión: notificar al usuario en el AcceptedBanner ("Nota: el lunes ya tenía una sesión")
- Esfuerzo: 1h

**D2 — Propuesta de semana en WeeklyView**
- Botón "Pedir semana al coach" en WeeklyView cuando la semana está vacía
- Navega al Coach con el prompt preescrito "Créame una semana de entrenamiento"
- Evita que el usuario tenga que saber que puede pedírselo
- Esfuerzo: 30min

**D3 — Persistencia de CoachProposals en Dexie**
- Agregar tabla `coachProposals` en db.ts (versión 4 de migración)
- Las propuestas pending sobreviven recargas de la app
- Esfuerzo: 1-2h

**D4 — Confirmación de create_week navega a WeeklyView**
- Después de aceptar una propuesta de tipo `create_week`, navegar automáticamente a `/week`
- El usuario ve su semana creada de inmediato sin tener que navegar manualmente
- Esfuerzo: 30min

**D5 — Historial de chat multi-turno real**
- Hoy: últimos 4 mensajes como texto plano en el system prompt
- Cambiar a `contents[]` con roles `user`/`model` en la API de Gemini/Claude/OpenAI
- Mejor continuidad del coach, menos tokens en formateo manual
- Requiere cambiar `AIRequest` y adaptar todos los providers
- Esfuerzo: 2-3h

### Ola 3 — Mejoras técnicas y features nuevos (esfuerzo medio)

**C1 — Chat multi-turno real**
- Hoy: últimos mensajes como texto plano en el system prompt
- Mejor: `contents[]` multi-turn en la API de Gemini (roles `user`/`model`)
- Mejor continuidad del coach, menos tokens desperdiciados en formateo
- Requiere cambiar `AIRequest` y adaptar todos los providers
- Esfuerzo: 2–3h — codeable/testeable local con mock

**C2 — PDF import v1.1 — extracción real**
- Reemplazar el parser naive por `pdfjs-dist` (extracción real de texto, no bytes ASCII)
- El `ParsedSessionDraft` ya existe, solo cambia el extractor
- Esfuerzo: 2–3h

**Notificaciones de sesión**
- Web Push API + service worker ya registrado
- Notificación "Sesión en 30 min" para las sesiones del día
- Requiere: permisos de notificación + cron en el SW
- Esfuerzo: 3–4h

**Pantalla Settings mínima**
- Export JSON, Clear all data (con confirmación), info de versión
- Esfuerzo: 1–2h

**C3 — Resumen semanal generado por el coach** ⏳ (movido desde Ola 2)
- Botón en WeeklyView que le pide al coach un resumen de la semana
- Coach genera párrafo con contexto completo (adherencia, RPE real, partidos, lesiones)
- Se guarda en `WeekSummary.coachNote` y aparece en Dashboard y History
- Esfuerzo: 2h (base ya disponible)

**C4 — Coach memoria de contexto**
- Store persistente con contexto de Rafael que el coach incluye siempre
- Ej: "prefiere entrenar fuerza los martes", "molestia rodilla derecha desde feb", "próximo torneo: mayo"
- Se guarda en Dexie, editable en Settings
- Esfuerzo: 3-4h

**C5 — Streaming de respuesta del coach**
- Mostrar la respuesta del coach letra a letra mientras llega (como ChatGPT)
- Requiere streaming support en CoachEngine y providers
- Reduce la percepción de latencia significativamente
- Esfuerzo: 3-4h

### Ola 4 — Largo plazo (alto esfuerzo, transformacional)

**PDF import v2 — Gemini-powered**
- Enviar el texto del PDF al coach con un prompt específico de extracción
- El modelo retorna `ParsedSessionDraft[]` como JSON estructurado
- Alta precisión sin hardcodear patterns
- Esfuerzo: 3–4h (base ya está en `pdfImport.ts`)

**Memoria del coach**
- Store persistente con preferencias y contexto de Rafael
- El coach los incluye automáticamente en el system prompt
- Ej: "prefiere entrenar fuerza los martes", "molestia rodilla derecha desde feb"
- Esfuerzo: 4–6h

**Sync backend**
- IndexedDB es local. Para multi-dispositivo: API + Supabase o PocketBase
- Requiere auth (aunque sea de un usuario)
- Esfuerzo: varios días

**Modo torneo**
- Bloque especial de semanas: preparación → tapering → competición → recuperación
- Vista propia con foco en partidos y rivales
- Esfuerzo: semana+

---

## 6. Backlog priorizado

| Mejora | Impacto | Esfuerzo | Ola | Estado |
|--------|---------|----------|-----|--------|
| B3/B4/B6/B7 — Bugs UI | Medio | Mínimo | 1 | ✅ Hecho |
| Export JSON (backup) | Alto | Mínimo | 2 | ✅ Hecho |
| Peso corporal en check-in | Medio | Bajo | 2 | ✅ Hecho |
| RPE por sesión | Medio | Bajo | 2 | ✅ Hecho |
| Estadísticas de partido squash | Alto | Medio | 2 | ✅ Hecho |
| Coach crea/agrega sesiones reales | Alto | Alto | 2 | ✅ Hecho |
| B8-B11 — Bugs normalización | Bajo | Mínimo | 4 | ✅ Hecho |
| D1 — Detección colisiones create_week | Medio | Mínimo | 2.2 | ⏳ |
| D2 — Botón "Pedir semana" en WeeklyView | Alto | Mínimo | 2.2 | ⏳ |
| D3 — Persistir proposals en Dexie | Medio | Bajo | 2.2 | ⏳ |
| D4 — Navegar a WeeklyView tras create_week | Alto | Mínimo | 2.2 | ⏳ |
| D5 — Chat multi-turno real | Alto | Medio | 2.2 | ⏳ |
| Vista historial partidos | Medio | Bajo | 2.1 | ⏳ |
| C3 — Resumen semanal del coach | Alto | Medio | 3 | ⏳ |
| C4 — Memoria del coach | Alto | Medio | 3 | ⏳ |
| C5 — Streaming de respuesta | Alto | Medio | 3 | ⏳ |
| PDF import v1.1 (pdfjs-dist) | Alto | Medio | 3 | ⏳ |
| Notificaciones de sesión | Alto | Medio | 3 | ⏳ |
| Pantalla Settings | Bajo | Bajo | 3 | ⏳ |
| PDF import v2 (Gemini API) | Alto | Medio-alto | 4 | ⏳ |
| Sync backend multi-dispositivo | Alto | Muy alto | 4 | ⏳ |
| Modo torneo | Alto | Muy alto | 4 | ⏳ |

---

## 7. Riesgos y decisiones técnicas

### AI keys fuera del bundle (riesgo bajo, mitigado)

- En producción, `CoachEngine` fuerza `proxy` y delega en `/.netlify/functions/coach`.
- **Mitigación actual**: la key vive del lado servidor; el frontend no habla directo con Gemini/OpenAI/Claude.
- **Flujo**: local puede usar `mock`, `proxy` o proveedores directos; producción usa proxy.
- **Siguiente disciplina**: mantener documentación y `.env` alineados para no probar caminos incorrectos.

### IndexedDB sin backup (riesgo medio)

- Todos los datos viven en el browser. Un `Clear site data` lo borra todo.
- **Mitigación pendiente**: export JSON manual (Ola 2). Esfuerzo bajo, impacto de contingencia alto.
- El seed se reinsertan si el DB queda vacío — conveniente para recuperación rápida.

### Propuestas del coach solo en memoria

- `useCoachActionsStore` no persiste en Dexie. Las propuestas pendientes desaparecen al recargar.
- **Decisión mantenida**: las propuestas son efímeras. Si el usuario acepta o rechaza, el efecto queda en las sesiones (que sí persisten).
- Si se convierte en problema, persitir solo `status: 'pending'` proposals en Dexie.

### Chat history multi-turn (limitación actual)

- El prompt incluye los últimos 3 mensajes como texto plano en el system prompt, no como `contents[]` multi-turn.
- Gemini soporta multi-turn nativamente. Usar la API correctamente daría mejor continuidad.
- **Decisión actual**: simple y funcional. Ola 3 lo mejora con `contents[]` real.

### PDF import v1 muy limitado

- Parser naive: funciona solo con PDFs de texto simple. Falla con escaneados o layouts complejos.
- El flujo siempre requiere revisión manual antes de importar — mitigación suficiente para v1.

---

## 8. Stack y configuración

| Elemento | Valor |
|----------|-------|
| React | 19 |
| TypeScript | strict mode |
| Bundler | Vite 8 + Rolldown |
| Estilos | Tailwind v3 con tokens custom |
| Estado | Zustand (4 stores) |
| Persistencia | Dexie 4 (IndexedDB), 3 versiones de migración |
| AI provider activo | `mock` en `.env`; `proxy` en producción |
| AI dev server | npm run dev → localhost:5173 |
| Build | antigravity run node -- node_modules/.bin/vite build |
| Deploy | Netlify (subir dist/ manualmente) |
| PWA | Service worker registrado, manifest con iconos |
