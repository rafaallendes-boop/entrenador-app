# Entrenador App - Review and Roadmap

Actualizado: 2026-05-05

## Resumen ejecutivo

La app ya está en fase de estabilización, no de descubrimiento. El producto tiene superficies reales de uso diario, planificación, chat, propuestas, sync, onboarding, nutrición, macroplan y generación de semanas. La prioridad ahora es que el coach sea confiable en local/dev/prod, que los errores sean observables y que el flujo no se caiga por respuestas parciales del modelo, streaming cortado, sync sensible o contratos duplicados.

Lectura actual:

- La base React + TypeScript + Vite está verde en build.
- El coach funciona por `ProxyProvider` y ya tiene proxy local de Vite para `npm run dev`.
- El endpoint local `/.netlify/functions/coach` existe vía `dev/coachProxyMiddleware.ts`.
- Las API keys reales para IA pueden vivir en `.env.local` sin `VITE_` cuando se usa `VITE_AI_PROVIDER=proxy`.
- Plan Builder V2 ya no depende de que el modelo devuelva semanas perfectas: hay repair local, validación post-repair y telemetría.
- `week_creator` ya está separado del chat y enrutable.
- `responseNormalizer` recupera `add_session` incompletos cuando son reparables.
- `stageLogger` agrega timing estructurado por etapa para coach y plan builder.
- Existe audit de prompt con `npm run audit:prompt`.
- La decisión de `MACRO PLAN` quedó cerrada: se omite en chat genérico normal, pero se conserva si hay competencia dentro de 14 días.
- El mayor riesgo técnico sigue siendo que el chat falle de forma intermitente por streaming/provider/normalización/sync, no falta de features.

## Estado actual por área

### Coach y chat

Estado: fuerte, pero sensible.

Ya existe:

- Chat general y chat de acción.
- Routing hacia `chat_general`, `chat_action`, `week_creator` y redirect a Plan Builder.
- Proposals persistidas, aplicables y con limpieza si falla creación.
- Recovery para respuestas parciales o inválidas en `chat_action`.
- Normalización con metadata de outcome, truncado y error class.
- Streaming con fallback a no-stream si no llegó ningún chunk.
- Debug técnico en Settings con trace, provider, duración y resultado.
- Stage timings por request con `stageLogger`.

Riesgo:

- El chat todavía puede sentirse frágil si el provider corta stream a mitad, responde texto sin acciones cuando el usuario pidió cambios, devuelve JSON mezclado o si la UI procesa tarde una respuesta cancelada.
- El estado de chat está repartido entre store, proposal lifecycle, provider, normalizer y sync. Esa dispersión aumenta el costo de razonar fallas.

### Plan Builder V2

Estado: estable para beta técnica.

Ya existe:

- Prompt minimal para generación single-week.
- Prompt minimal para batch/pairs.
- Schema completo conservado en Week Creator y Coach Chat.
- `repairGeneratedWeek()` antes de validar.
- Reparación de fechas, sesiones fuera de semana, días no permitidos, colisiones, deportes no permitidos y detalles faltantes.
- Selectors deportivos integrados: squash, running, strength, mobility y cycling.
- Balance de conteo con recorte priorizado y fallback conservador.
- Telemetría en `generationMeta`.
- Strategy default `single`, con `pairs` explícito y `auto` para planes largos.
- Separación de `errorClass` y `outcome` en generación de semanas.

Pendiente de verificación:

- QA manual con modelos reales en semanas largas.
- Revisar que repair telemetry sea comprensible en Settings/debug o metadata exportable.
- Decidir si el usuario final ve la telemetría o si queda solo como herramienta técnica.

### Prompt y contexto

Estado: más controlado.

Ya existe:

- Context reduction para chat genérico.
- Perfil slim en prompts livianos.
- `MACRO PLAN` condicionado por tipo de request o competencia cercana.
- Audit de tokens con `npm run audit:prompt`.

Decisión cerrada:

- Chat genérico sin competencia cercana debe mantenerse liviano.
- Chat genérico con competencia dentro de 14 días debe incluir `MACRO PLAN`.
- `adjust_session` debe incluir `MACRO PLAN`.

Riesgo:

- `promptBuilder.ts` sigue siendo una superficie grande y sensible. No debería modificarse sin tests de contrato y audit de tokens antes/después.

### Dev local y prod

Estado: listo para probar en dev.

Ya existe:

- `vite.config.ts` monta `devCoachProxyPlugin`.
- `npm run dev` puede responder `/.netlify/functions/coach` localmente.
- `netlify/functions/coach.ts` sigue siendo el camino prod.
- `ProxyProvider` es el contrato común del cliente.

Configuración esperada en `.env.local` para dev con IA real:

```env
VITE_AI_PROVIDER=proxy
GEMINI_API_KEY=...
```

Opcional:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=...
```

```env
AI_PROVIDER=claude
CLAUDE_API_KEY=...
```

Para login local con `npm run dev`, revisar:

```env
VITE_AUTH_REDIRECT_URL=http://localhost:5173
```

Para `netlify dev`, puede seguir siendo:

```env
VITE_AUTH_REDIRECT_URL=http://localhost:8888
```

### Sync

Estado: principal riesgo abierto.

Ya existe:

- Local-first con Dexie.
- Sync a Supabase.
- Colas locales.
- Backup/import/export.
- Tombstones y tratamiento más durable para `coach_proposals`.

Riesgo:

- Convergencia multi-dispositivo.
- Recovery cuando hay cola atascada.
- Deletes y resets remotos.
- Experiencia visible cuando sync no está sano.

### Biblioteca de entrenamiento

Estado: mejorada, pero grande.

Ya existe:

- Biblioteca amplia con transferencia a squash.
- Nuevos metadatos de riesgo, fatiga, aliases y transferencia.
- Ajuste de `lateral_band_walk`: ya no se marca como unilateral.

Riesgo:

- El scoring puede degradarse si metadatos semánticos se mezclan sin tests de selección.
- Conviene mantener cambios futuros como curaduría/refactor, no como expansión masiva.

## Verificación obligatoria en dev antes de prod

### 1. Verificación técnica rápida

Correr:

```bash
npm run build
npm test -- src/services/__tests__/promptBuilderContextReduction.test.ts src/services/__tests__/responseNormalizer.test.ts src/services/__tests__/repairWeek.test.ts src/services/__tests__/stageLogger.test.ts
npm run audit:prompt
```

Interpretación esperada:

- Build verde.
- Tests focalizados verdes.
- Audit de prompt sin crecimiento inesperado en `chat_general`.
- `chat_general` debe seguir siendo liviano salvo competencia cercana.
- `chat_action`, `week_creator` y `plan_builder_week` pueden ser más grandes, pero el crecimiento debe estar justificado.

### 2. Verificación local del coach

Preparar `.env.local`:

```env
VITE_AI_PROVIDER=proxy
GEMINI_API_KEY=...
VITE_AUTH_REDIRECT_URL=http://localhost:5173
```

Levantar:

```bash
npm run dev
```

Abrir:

```text
http://localhost:5173
```

Probar en chat:

- Mensaje genérico: "Como ves mi semana?"
- Acción simple: "Agrega una movilidad suave el viernes PM"
- Ajuste de sesión: "Ajusta la sesión del martes PM porque estoy cansado"
- Semana: "Creame la próxima semana"
- Plan largo: "Armame un plan de 8 semanas para mi torneo"
- Caso de competencia cercana: preguntar por la semana con torneo dentro de 14 días y verificar que el coach use contexto de macroplan.

Qué mirar:

- El coach responde sin error de configuración.
- No aparece "El coach no está configurado correctamente en el servidor".
- No aparece error de conexión al coach.
- En Settings, la última solicitud muestra trace, provider, duración y resultado técnico.
- Si la respuesta es acción, se crea proposal.
- Si se acepta proposal, se aplica una vez aunque haya doble click.
- Si falla proposal, no queda mensaje huérfano del coach.

### 3. Verificación de streaming y recovery

Probar:

- Enviar una acción con respuesta larga.
- Cancelar o navegar durante la respuesta.
- Reintentar después de un error.
- Pedir una acción ambigua: "cambia eso para que sea más suave".

Qué mirar:

- No quedan loaders pegados.
- No se duplica el mensaje del usuario.
- No se duplica la proposal.
- Si el modelo responde texto sin acción ante una pregunta normal, no debe forzarse retry innecesario.
- Si el usuario pidió una acción y el modelo falla el formato, debe intentar recovery o mostrar error útil.

### 4. Verificación de Plan Builder V2

Probar:

- Crear plan desde wizard con perfil completo.
- Crear plan con perfil incompleto.
- Generar semana individual.
- Generar plan largo.
- Revisar semanas con sesiones movidas/reparadas.

Qué mirar:

- No se cae la generación si una sesión viene con fecha inválida o deporte no permitido.
- El resultado respeta días permitidos y `allowDoubleSession`.
- Las sesiones tienen detalles suficientes.
- `generationMeta` registra reparadas, movidas, filtradas, fallback y warnings.
- Si el batch falla, degrada a single sin romper toda la generación.

### 5. Verificación de sync antes de prod

Probar con dos navegadores o desktop/móvil:

- Login en ambos.
- Crear sesión manual en A y verificar en B.
- Crear proposal del coach en A, aceptar en A, verificar en B.
- Crear cambios offline en A, volver online y verificar cola.
- Borrar una sesión del coach y verificar que no reaparece.
- Exportar backup, importar en otro navegador y revisar conteos.
- Ejecutar reset local y reset local+nube solo si se está en ambiente seguro.

Qué mirar:

- No reaparecen registros borrados.
- No se duplican proposals.
- No se pisa un cambio local más nuevo con uno remoto viejo.
- La UI comunica si sync está pendiente o fallando.

### 6. Verificación de prod antes de release

Antes de deploy:

- Confirmar variables en Netlify: `GEMINI_API_KEY` o provider elegido, Supabase URL/key del servidor y modelo si aplica.
- Confirmar que no hay keys reales con prefijo `VITE_`.
- Confirmar que los archivos nuevos críticos entran al commit:
  - `dev/coachProxyMiddleware.ts`
  - `scripts/audit-prompt-tokens.test.ts`
  - `scripts/loadtest-week-creator.mjs`
  - `src/services/ai/stageLogger.ts`
  - `src/services/__tests__/stageLogger.test.ts`
- Correr build limpio.
- Revisar logs de Netlify Function en primera prueba prod.

## Refactorizaciones permitidas ahora

No abrir features nuevas hasta que esto esté estable. El trabajo recomendado es refactor y hardening.

### 1. Unificar contrato del coach proxy

Problema:

- `ProxyProvider`, `dev/coachProxyMiddleware.ts` y `netlify/functions/coach.ts` comparten contrato, pero los tipos viven duplicados.

Refactor recomendado:

- Crear un módulo compartido de tipos request/response/error para proxy.
- Reusar los mismos `errorCode`, `requestClass`, payload y shape de respuesta en dev y prod.
- Agregar test de contrato para que dev proxy y Netlify Function no diverjan.

Impacto:

- Menos caídas por diferencias entre local y prod.
- Debug más confiable.

### 2. Convertir el flujo de chat en state machine explícita

Problema:

- El estado actual mezcla persistencia de mensaje, streaming, proposal, cancelación, cleanup y sync.

Refactor recomendado:

- Modelar estados: `idle`, `persisting_user_message`, `requesting_coach`, `streaming`, `normalizing`, `creating_proposal`, `completed`, `failed`, `cancelled`.
- Centralizar cleanup de mensajes tardíos y proposals fallidas.
- Asegurar idempotencia por `traceId` o `requestId`.

Impacto:

- Menos loaders pegados.
- Menos mensajes/proposals huérfanos.
- Más fácil reproducir errores.

### 3. Separar `promptBuilder.ts` por contratos estables

Problema:

- `promptBuilder.ts` es grande, sensible y fácil de romper.

Refactor recomendado:

- Extraer gates de secciones: macroplan, nutrición, carga, historial, feedback.
- Mantener tests de contrato por request type.
- Correr `npm run audit:prompt` cada vez que se toque.

Impacto:

- Menos regresiones como perder `MACRO PLAN` antes de competencia.
- Prompts más baratos y controlados.

### 4. Fortalecer normalización como pipeline auditable

Problema:

- Normalización, recovery, truncado, parse failure y schema invalid son conceptos cercanos pero distintos.

Refactor recomendado:

- Mantener `outcome` y `errorClass` separados.
- Hacer pipeline explícito: extract, parse, classify, repair, validate.
- Registrar qué etapa falló.
- Tests con fixtures reales de respuestas malas.

Impacto:

- Menos falsos errores.
- Mejor retry.
- Mejor lectura en Settings.

### 5. Refactor de sync por responsabilidades

Problema:

- `syncService` concentra demasiado: push, pull, merge, deletes, recovery, queues y resets.

Refactor recomendado:

- Separar cola local, merge, tombstones, pull remoto, push remoto y reset.
- Tests por tabla crítica: sessions, coach_proposals, athlete_profiles.
- Panel de salud simple para cola y último error.

Impacto:

- Menos riesgo multi-dispositivo.
- Más confianza antes de beta.

### 6. Smoke tests de estabilidad, no tests enormes

Problema:

- La suite completa puede crecer sin cubrir los casos que rompen uso real.

Refactor recomendado:

- Agregar pocos smoke tests de alto valor:
  - chat action crea proposal una vez
  - respuesta truncada no crea proposal inválida
  - cancelación limpia loader
  - dev proxy devuelve error `misconfigured` si falta key
  - prompt genérico con competencia incluye macroplan
  - prompt genérico sin competencia omite macroplan

Impacto:

- Más seguridad con menos ruido.

## Qué no hacer ahora

- No sumar nuevas pantallas.
- No ampliar la biblioteca de ejercicios salvo correcciones de calidad.
- No abrir billing/paywall todavía.
- No agregar más analytics visibles si no ayudan a estabilizar.
- No tocar `promptBuilder.ts` sin test + audit.
- No cambiar sync sin escenario de QA multi-dispositivo.
- No usar API keys reales con prefijo `VITE_`.

## Próximos pasos recomendados

1. Hacer QA dev con IA real usando `npm run dev`.
2. Revisar Settings después de cada caso de chat: trace, provider, duración, error técnico y stage timings.
3. Validar Plan Builder V2 con semanas reales y mirar `generationMeta`.
4. Validar sync en dos dispositivos o dos navegadores.
5. Si algo falla, priorizar refactor de contrato/proxy, normalizer o state machine del chat antes de cualquier feature.
6. Cuando dev esté estable, hacer deploy controlado y mirar logs de Netlify Function en la primera sesión real.

## Nota de dirección

La prioridad real ya no es que el coach sea más ambicioso. La prioridad es que sea aburridamente confiable: responder, recuperarse, no duplicar, no dejar basura, explicar errores técnicos y comportarse igual en local, dev y prod.
