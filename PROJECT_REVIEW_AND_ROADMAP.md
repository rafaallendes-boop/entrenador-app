# Entrenador App - Review and Roadmap

Actualizado: 2026-06-14

## Resumen Ejecutivo

Entrenador esta en mejor estado tecnico que el corte del 2026-06-02, pero todavia debe tratarse como beta interna controlada, no como apertura amplia. El foco del repo se movio hacia Plan Builder async, reparacion deportiva mas fuerte para squash, fases macro ajustadas para torneo de squash y observabilidad local de calidad.

El corte local esta verde en lint, tests, build y audit de prompts. Lo que falta para subir confianza no es mas refactor: son pruebas reales con dev/prod, provider, Supabase y login vigente. Hay dos decisiones antes de beta ampliada: si las acciones de calidad/regeneracion de Plan Builder son feature visible o debug interno, y como confirmar mejor que la background function realmente arranco cuando el cliente pierde la respuesta del trigger.

## Estado Del Corte 2026-06-14

Working tree con cambios sin commit en Plan Builder, macro plan, quality review, repair week, prompts, store, tipos, Netlify y tests. `src/services/weekCreator/WeekCreatorEngine.ts` no tiene diff local, pero fue revisado porque resuelve objetivos desde planes activos y usa el pipeline de reparacion/validacion de semanas.

Cambios locales revisados:

- `netlify.toml`: `generate-plan-background` queda configurada como background function.
- `src/store/usePlanBuilderStore.ts`: intenta sostener polling cuando el plan ya fue publicado pero se pierde la confirmacion del trigger remoto.
- `src/services/macroPlan.ts` y `src/services/planBuilder/buildPlanShell.ts`: taper de squash se acorta a la ultima semana pre-evento y las cargas de soporte se ajustan por deporte/fase.
- `src/services/planBuilder/repairWeek.ts`: conserva drills de squash reconocidos, mapea/completa alrededor de drills desconocidos y densifica sesiones pobres.
- `src/services/planBuilder/qualityReview.ts`: prorratea cargas en semanas parciales antes de marcar saltos de progresion.
- `src/services/week/prompts/weekPrompt.ts`: refuerza uso de nombres exactos del catalogo de squash.
- Tests actualizados para fases de squash, reparacion de drills, prorrateo de carga parcial, continuidad de generacion remota y bordes de Week Creator (capacidad, fallback, abort).

## Validacion Local Ejecutada

Comandos corridos en este corte:

```bash
npm run lint
npm test
npm run build
npm run audit:prompt
npx vitest run src/services/__tests__/macroPlan.test.ts src/services/__tests__/macroWeekCoherence.test.ts src/services/__tests__/planBuilder.test.ts src/services/__tests__/repairWeek.test.ts src/services/planBuilder/__tests__/qualityReviewRepeatedTemplate.test.ts src/services/planBuilder/__tests__/repairWeekPhase2Wiring.test.ts src/store/__tests__/usePlanBuilderStore.test.ts
```

Resultados:

- `npm run lint`: OK.
- `npm test`: 112 archivos, 790 tests OK.
- `npm run build`: OK.
- `npm run audit:prompt`: OK.
  - `chat_general`: 2030 chars / ~508 tokens.
  - `chat_action`: 14655 chars / ~3664 tokens.
  - `week_creator`: 14655 chars / ~3664 tokens.
  - `plan_builder_week`: 14655 chars / ~3664 tokens.
  - `weekly_summary`: 15104 chars / ~3776 tokens.
- Tests focalizados: 7 archivos, 76 tests OK.

No revalidado en este corte:

- `npm run loadtest:week-creator`: requiere dev server y provider real.
- `npm run e2e:dev`
- `npm run e2e:dev:apply`
- `npm run e2e:dev:quality`
- `npm run e2e:plan`
- `npm run e2e:plan:generate`
- `npm run e2e:plan:generate:quality`
- `npm run e2e:plan:accept`

Motivo operativo: `scripts/.e2e-auth-state.json` existe, pero la sesion guardada expiro el 2026-05-25. Para correr E2E sin falsos negativos hay que renovar login con los scripts headed.

## Revision De Codigo

### Hallazgo 1 - Regeneracion/calidad visible aunque el flag dice debug interno

Severidad: media.

`src/services/ai/showPlanQualityFlag.ts` documenta que badges y controles de regeneracion se habilitan local/dev con `VITE_SHOW_PLAN_QUALITY=true` y se fuerzan off en prod. Sin embargo, `src/pages/PlanBuilderV2Page.tsx` muestra calidad cuando el plan esta `complete` o `partial`, y expone `Regenerar semana`, `Reparar semanas marcadas` y `Regenerar plan` por estado del plan, no por el flag.

Impacto: si Fase 3 sigue siendo debug interno, esos controles pueden aparecer a usuarios beta/prod y convertir una herramienta de QA en superficie publica. Si ahora se decidio que regenerar es feature de producto, entonces hay que actualizar el comentario del flag, el roadmap y la UX como capacidad soportada.

Referencia local:

- `src/services/ai/showPlanQualityFlag.ts`
- `src/pages/PlanBuilderV2Page.tsx` alrededor de `shouldShowQualityReview`, `Regenerar semana`, `Reparar semanas marcadas` y `Regenerar plan`.

Decision recomendada: antes de beta ampliada, elegir una de dos:

- Gatear calidad/reparacion/regeneracion con `shouldShowPlanQuality()`.
- Mantener regeneracion como feature visible, pero separar "debug quality" de "acciones de recuperacion" y testearlo como flujo de usuario.

### Hallazgo 2 - Confirmacion remota perdida puede dejar polling fantasma

Severidad: media-baja.

El nuevo `resumeUncertainRemoteGeneration` evita perder una generacion si el cliente publica el plan y luego no recibe confirmacion del trigger. Es una buena defensa para requests que si llegaron al worker, pero tambien puede ocultar el caso contrario: `triggerBackgroundGeneration` falla antes de invocar la funcion y el cliente queda en `generating` hasta que el polling marque stalled.

Impacto: en mala red o error temprano del trigger, el usuario puede ver una generacion viva durante varios minutos sin worker real.

Referencia local:

- `src/store/usePlanBuilderStore.ts`
- `netlify/functions/generate-plan-background.ts`

Decision recomendada: agregar una confirmacion corta de arranque remoto. Por ejemplo, despues de perder el trigger, esperar un snapshot con `jobId`, progreso de semana o heartbeat remoto nuevo; si no aparece en una ventana corta, mostrar error recuperable en vez de esperar el timeout largo de stalled.

### Hallazgo 3 - Config local sensible esta bien ignorada, pero cuidar rotacion

Severidad: baja.

`.env.local` esta ignorado por `.gitignore`, y `.env.production` es el archivo trackeado esperado para config publica de build. Aun asi, como el entorno local contiene claves de provider, cualquier salida compartida accidentalmente debe tratarse como exposicion y disparar rotacion.

Decision recomendada: antes de deploy externo, confirmar que ninguna key privada vive en `VITE_*`, que Netlify usa env vars server-side y que cualquier clave mostrada fuera del equipo fue rotada.

### Hallazgo 4 - Sin bloqueo funcional en Week Creator local

Severidad: informativo.

`WeekCreatorEngine` no tiene diff local y su flujo sigue razonable: resuelve objetivos desde plan activo, construye prompt estructurado, repara sesiones, valida contrato y cae a fallback deterministico si agota intentos. El cambio de `repairWeek` mejora indirectamente Week Creator porque conserva sesiones de squash con drills parcialmente reconocibles y agrega bloques cuando densifica.

## Estado Del Spec Plan Builder

Referencia: `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md`.

### Fase 1 - IA Confiable

Estado: mayormente implementada, con async remoto mas maduro.

Implementado:

- `single` es default y `pairs` queda configurable.
- `plan_builder_week` y `plan_builder_pair` usan schema/structured output.
- Provider routing por requestClass existe.
- Parser streaming existe para recuperar acciones completas en batch truncado.
- Pair degrada a single antes de fallback local.
- Background generation existe para Plan Builder remoto.
- Polling mezcla estado remoto/local y detecta stalled con TTL conservador.

Pendiente:

- Verificar en ambiente real que Netlify background function escribe `jobId`, heartbeat, semanas y estado terminal sin depender del cliente.
- Revalidar `e2e:plan:generate:quality` con provider/proxy real.

### Fase 2 - Especificidad Deportiva

Estado: mayormente implementada y mejor que el corte anterior para squash competitivo.

Implementado:

- `exerciseLibrary` y `drillLibrary` siguen como fuentes principales.
- `strengthBlocks/` tiene templates por fase y rotacion.
- `profileAdapter` traduce perfil + wizard a parametros de selectores.
- `selectStrengthSession` usa fase, bloque, recientes, fatiga y referencias 1RM.
- `repairWeek` hidrata/densifica fuerza y squash.
- Taper de squash se acorta a la ultima semana pre-evento; peak/build sostienen especificidad hasta mas cerca del torneo.
- Cargas de soporte se reducen por fase y deporte, especialmente running/cycling cuando squash es primario.
- `qualityReview` detecta templates de fuerza repetidos y ahora prorratea semanas parciales antes de marcar saltos.

Pendiente de evidencia real:

- Generar 1 plan real de 8-12 semanas con squash competitivo, fuerza y 1RM completos.
- Confirmar 0 sesiones de fuerza clonadas con 3+ ejercicios repetidos dentro del mismo bloque.
- Confirmar al menos 4 ejercicios usando referencias 1RM.
- Confirmar al menos 6 drills squash distintos across plan.
- Confirmar ausencia o reparabilidad clara de `quality.strength.repeated_template`.

### Fase 3 - Trust y Observabilidad

Estado: parcial-avanzada, con una decision pendiente de producto/debug.

Implementado:

- `commitPlan` recalcula y persiste `generationSummary.qualityReview`.
- `PlanQualityBadge` existe y se fuerza off en produccion mediante `shouldShowPlanQuality()`.
- Store tiene `regenerateWeek`, `regenerateWeeks`, `retryFailedWeeks` y `retryIncompleteWeeks`.
- `PlanBuilderV2Page` permite regenerar semana, regenerar fallidas, reparar semanas marcadas y regenerar plan.
- Settings tiene `Beta quality local` con export/reset y metricas basicas de requests/feedback/usage.
- `PlanWeekStatus` incluye `regenerating`.

Pendiente:

- Decidir si los controles de regeneracion/calidad son debug interno o feature visible.
- Si son debug: gatearlos con `shouldShowPlanQuality()` y testear que prod no los renderiza.
- Si son feature: documentar el flujo de usuario, textos, estados de error y garantias de no perder semanas aceptadas.
- Agregar rollup de planes mas especifico en Settings/Beta Quality: N/M semanas IA vs fallback, failed weeks, quality score agregado por plan.
- E2E de regeneracion: una semana reemplazada mantiene el resto intacto y deja qualityReview actualizado.

### Fase 4 - Telemetria Persistida

Estado: no implementada y fuera del MVP actual.

No empezar antes de:

- Decision Fase 3 debug vs feature visible.
- Beta interna activa al menos 2 semanas.
- Volumen suficiente de `aiRequestLogs` y feedback.
- Decision de privacidad sobre que se persiste remotamente.

## Readiness Para Produccion

Estado recomendado: no abrir beta ampliada. Avanzar solo a smoke prod controlado cuando los gates E2E/loadtest reales esten verdes.

Bloqueantes antes de deploy prod:

- Renovar auth E2E con `npm run e2e:dev:headed` o `npm run e2e:plan:headed`.
- Correr `npm run loadtest:week-creator`.
- Correr `npm run e2e:dev:quality`.
- Correr `npm run e2e:plan`.
- Correr `npm run e2e:plan:generate:quality` con provider/proxy real.
- Revisar un export Beta Quality nuevo.
- Decidir/gatear controles de calidad y regeneracion de Plan Builder.
- Confirmar `.env` de prod: `VITE_AI_PROVIDER=proxy`, function proxy configurada, sin keys privadas en `VITE_*`.
- Smoke sync basico desktop/mobile en ambiente seguro.
- Cortar deploy desde un commit limpio y trazable.
- Fijar runtime Node/npm para Netlify/local (`engines`, `.nvmrc` o `NODE_VERSION`).
- Agregar CI minima o ejecutar checklist automatizado equivalente antes del deploy.
- Validar que el schema Supabase real cubre tablas actuales y migraciones necesarias.

Criterio para permitir deploy:

- Build local verde.
- Runtime reproducible entre local y Netlify.
- Proxy responde sin `misconfigured`.
- Week Creator genera al menos una semana real sin caer sistematicamente en fallback local.
- Plan Builder genera un plan revisable de 8-12 semanas.
- Background Plan Builder escribe `jobId`, heartbeat y estado terminal remoto.
- No hay loaders pegados.
- Proposals se aplican una vez.
- Settings/Beta Quality muestra trazas utiles.
- No hay cambios locales no revisados en el corte de deploy.

Criterio para invitar beta interna 3-5 personas:

- Smoke prod controlado verde.
- Canal de feedback simple.
- Instruccion corta para exportar Beta Quality.
- Uso inicial acompanado 1:1.
- Sin promesa de estabilidad multi-dispositivo hasta completar QA sync.

## Roadmap Junio 2026

### 1. Cerrar Decisiones De Superficie Plan Builder

Objetivo: evitar que debug interno se convierta accidentalmente en producto.

Checklist:

- Decidir si quality review bloquea aceptacion en prod.
- Decidir si `Regenerar semana`, `Reparar semanas marcadas` y `Regenerar plan` son controles visibles.
- Si son debug: gatear con `shouldShowPlanQuality()` y agregar tests de prod-off.
- Si son feature: escribir tests de UX/estado para regeneracion visible.

### 2. Rebaseline Tecnico y Deportivo

Objetivo: generar evidencia fresca de Junio antes de decidir invitaciones.

Checklist:

- `npm run lint` - hecho 2026-06-14.
- `npm test` - hecho 2026-06-14.
- `npm run build` - hecho 2026-06-14.
- `npm run audit:prompt` - hecho 2026-06-14.
- Renovar auth E2E.
- `npm run loadtest:week-creator`.
- `npm run e2e:dev:quality`.
- `npm run e2e:plan`.
- `npm run e2e:plan:generate:quality`.
- Generar 1 plan real de 8-12 semanas con squash + fuerza + 1RM completos.
- Exportar Beta Quality y guardar hallazgos accionables.

### 3. Async Plan Builder Hardening

Objetivo: que el usuario nunca quede mirando un polling sin worker real.

Checklist:

- Confirmacion corta de arranque remoto tras perdida de trigger.
- Test: trigger falla antes de worker -> error recuperable, no polling largo.
- Test: trigger llega pero cliente pierde respuesta -> polling sigue y captura `jobId`/progreso.
- Smoke Netlify background function con Supabase real.

### 4. QA Sync y Multi-Dispositivo

Objetivo: evitar sorpresas de datos antes de usuarios reales.

Escenarios:

- Desktop crea sesion, mobile la ve.
- Mobile completa sesion, desktop la ve.
- Proposal aceptada en un dispositivo converge en el otro.
- Delete/tombstone no reaparece.
- Offline/online con cola pendiente converge.
- Backup/export conserva campos nuevos de fuerza, squash y estados de Plan Builder.

### 5. Smoke Prod Controlado

Objetivo: validar build, env vars, Netlify Function, auth, Supabase y proxy real.

Pasos:

- Deploy prod desde commit limpio.
- Login real.
- Crear una sesion puntual desde chat.
- Crear una semana desde Week Creator.
- Crear un plan con Plan Builder.
- Regenerar o reparar una semana si la decision de producto lo permite.
- Aceptar una propuesta simple.
- Revisar Settings/Beta Quality.
- Probar app en mobile.

### 6. Beta Interna 3-5 Personas

Objetivo: aprender con usuarios cercanos sin abrir el producto.

Reglas:

- Invitar de a uno.
- Pedir feedback semanal.
- Clasificar fallos por provider, schema, prompt, logica deportiva, fechas, sync o UI.
- No perseguir todo comentario como feature request.
- Pausar invitaciones si aparece perdida de datos, auth roto o sync inconsistente.

## Que No Hacer Ahora

- No abrir beta publica.
- No agregar monetizacion/paywall.
- No migrar todo a Claude/OpenAI sin datos.
- No sumar features grandes antes de cerrar estabilidad.
- No persistir prompts completos o respuestas largas en remoto.
- No refactorizar prompts por estetica.

## Pasos Ejecutados Al Final De Esta Revision

- Corrido `npm run lint`.
- Corrido `npm test`.
- Corrido `npm run build`.
- Corrido `npm run audit:prompt`.
- Corridos tests focalizados de macro plan, Plan Builder, repair week, quality review y store.
- Verificado que la auth E2E guardada esta expirada desde 2026-05-25, por lo que los E2E reales quedan como siguiente paso con login renovado.

## Proximo Paso Inmediato

Renovar la sesion E2E con `npm run e2e:plan:headed` y correr `npm run e2e:plan:generate:quality`. Si ese gate queda verde, seguir con `npm run loadtest:week-creator` y un smoke prod controlado.
