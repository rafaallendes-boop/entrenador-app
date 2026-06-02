# Entrenador App - Review and Roadmap

Actualizado: 2026-06-02

## Resumen Ejecutivo

Entrenador esta listo para una nueva ronda de beta interna solo como candidato controlado, no como apertura amplia. El repo esta en mejor estado que el ultimo corte de Mayo: Plan Builder ya tiene estrategia `single` por defecto, degradacion pair->single, structured output, parser streaming, selector de fuerza por bloques, uso de perfil/1RM, quality review persistido y badge interno flag-gated.

La conclusion importante: el spec `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md` no esta completo de forma literal. Fases 1 y 2 estan mayormente implementadas con adaptaciones documentadas; Fase 3 esta parcial; Fase 4 sigue fuera del MVP. El paso a produccion puede hacerse despues de gates de QA real, pero el retorno a beta interna debe mantener alcance pequeno y monitoreo manual.

## Estado del Corte 2026-06-02

Working tree con cambios sin commit relacionados con Plan Builder, quality review, tests y dos fixes de release hechos durante esta revision.

Validacion local corrida hoy:

```bash
npm run lint
npm test
npm run build
npm run audit:prompt
```

Resultados:

- `npm run lint`: OK.
- `npm test`: 100 archivos, 686 tests OK.
- `npm run build`: OK.
- `npm run audit:prompt`: OK.
  - `chat_general`: 2012 chars / ~503 tokens.
  - `chat_action`: 14648 chars / ~3662 tokens.
  - `week_creator`: 14648 chars / ~3662 tokens.
  - `plan_builder_week`: 14648 chars / ~3662 tokens.
  - `weekly_summary`: 14956 chars / ~3739 tokens.

Pruebas focalizadas posteriores a esta revision:

```bash
npx vitest run src/services/planBuilder/__tests__/generatePlanDegradation.test.ts src/services/__tests__/dataExportStrengthLoad.test.ts
```

Resultado: 2 archivos, 8 tests OK.

No revalidado hoy y sigue siendo gate antes de invitar terceros:

- `npm run loadtest:week-creator`
- `npm run e2e:dev`
- `npm run e2e:dev:apply`
- `npm run e2e:dev:quality`
- `npm run e2e:plan`
- `npm run e2e:plan:generate`
- `npm run e2e:plan:generate:quality`
- `npm run e2e:plan:accept` en dev/local seguro.

## Cambios De Esta Revision

- `src/services/planBuilder/generatePlan.ts`: si `plan_builder_pair` falla por completo, ahora marca `degradeToSingle: true` para intentar weeks single antes de fallback local.
- `src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`: cubre batch failure completo -> dos llamadas `plan_builder_week`.
- `src/services/dataExport.ts`: backup/import acepta `TrainingPlanWeek.status = 'regenerating'`.
- `src/services/__tests__/dataExportStrengthLoad.test.ts`: cubre import de `regenerating` y aisla fixtures para evitar contaminacion entre tests.

## Estado Del Spec Plan Builder

Referencia: `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md`.

### Fase 1 - IA Confiable

Estado: mayormente implementada con ajustes post-review.

Implementado:

- `single` es default y `pairs` se activa por `VITE_PLAN_BUILDER_STRATEGY`.
- `plan_builder_week` y `plan_builder_pair` usan response schema.
- Provider routing por requestClass existe via `getProviderForRequestClass`.
- Parser streaming existe y se usa para recuperar acciones completas en batch truncado.
- Pair degrada a single antes de fallback local, incluyendo fallo completo del request batch.
- Timeouts estan alineados a Netlify Pro sync real: `plan_builder_week` 18s, `plan_builder_pair` 23s, proxy wallclock 24s.

Adaptaciones/no literal:

- El spec original pedia `plan_builder_pair` 5500/45s y `plan_builder_week` 3500/30s. El hardening bajo los limites por Netlify Pro 26s.
- `drillIds` por referencia quedo diferido.
- La metrica real >=80% semanas IA aun requiere `npm run e2e:plan:generate` con provider real.

### Fase 2 - Especificidad Deportiva

Estado: mayormente implementada, pero no con las carpetas exactas del spec.

Implementado:

- `exerciseLibrary` y `drillLibrary` se enriquecieron como fuente unica de verdad, en vez de crear `exerciseCatalog/` y `squashCatalog/`.
- `strengthBlocks/` tiene templates por fase y rotacion.
- `profileAdapter` traduce perfil + wizard a parametros de selector.
- `selectStrengthSession` usa fase, bloque, recent exercises, fatiga y referencias 1RM.
- `repairWeek` hidrata/densifica fuerza, pasa contexto deportivo y conserva `metadata.starLift`.
- `qualityReview` advierte `quality.strength.repeated_template`.

Pendiente de evidencia real:

- Plan 8-12 semanas con perfil squash competitivo y 1RM completos.
- 0 sesiones de fuerza clonadas con 3+ ejercicios repetidos dentro del mismo bloque.
- Al menos 4 ejercicios usando referencias 1RM.
- Al menos 6 drills squash distintos across plan.
- Ausencia de `quality.strength.repeated_template` en planes nuevos.

### Fase 3 - Trust y Observabilidad

Estado: parcial.

Implementado:

- `commitPlan` recalcula y persiste `generationSummary.qualityReview`.
- `PlanQualityBadge` existe y esta flag-gated por `VITE_SHOW_PLAN_QUALITY`.
- En produccion el flag queda forzado a off.
- `PlanWeekStatus` incluye `regenerating`.

Pendiente o no encontrado:

- Servicio `regeneratePlanWeek` para regenerar una semana ya aceptada y reemplazar sesiones con confirmacion.
- `RegenerateWeekButton` flag-gated.
- Rollup de planes en Settings/Beta Quality con N/M semanas IA vs fallback.
- Export Beta Quality de planes con quality review agregado.

Decision para beta interna: Fase 3 parcial es aceptable para owner QA y beta 1:1. Para beta ampliada, completar rollup y regeneracion o documentar explicitamente que quedan fuera.

### Fase 4 - Telemetria Persistida

Estado: no implementada y fuera del MVP actual.

No empezar antes de:

- Fase 3 completa o explicitamente recortada.
- Beta interna activa al menos 2 semanas.
- Volumen suficiente de `aiRequestLogs` y feedback.
- Decision de privacidad sobre que se persiste remotamente.

## Readiness Para Produccion

Estado recomendado: avanzar a smoke prod controlado despues de correr E2E/loadtests reales. No abrir beta ampliada todavia.

Bloqueantes antes de deploy prod:

- Correr `npm run loadtest:week-creator`.
- Correr `npm run e2e:dev:quality`.
- Correr `npm run e2e:plan`.
- Correr `npm run e2e:plan:generate:quality` con Gemini/proxy real.
- Revisar un export Beta Quality nuevo.
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

### 1. Rebaseline Tecnico y Deportivo

Objetivo: generar evidencia fresca de Junio antes de decidir invitaciones.

Checklist:

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run audit:prompt`
- `npm run loadtest:week-creator`
- `npm run e2e:dev:quality`
- `npm run e2e:plan`
- `npm run e2e:plan:generate:quality`
- Generar 1 plan real de 8-12 semanas con squash + fuerza + 1RM completos.
- Exportar Beta Quality y guardar hallazgos accionables.
- Fijar Node/npm de proyecto antes del corte de deploy.
- Crear CI minima para `lint`, `test`, `build` y `audit:prompt`, o documentar un sustituto manual firmado para el primer deploy.

### 2. Cierre Plan Builder Trust

Objetivo: decidir si Fase 3 se completa antes de beta interna o queda explicitamente recortada.

Prioridad:

- Completar `regeneratePlanWeek` para semanas aceptadas si se quiere QA interno rapido.
- Agregar `RegenerateWeekButton` solo bajo flag interno.
- Agregar rollup de planes a Settings/Beta Quality.
- Mantener `VITE_SHOW_PLAN_QUALITY` off en prod.
- Convertir cada fallo real de plan en test focalizado.

### 3. QA Sync y Multi-Dispositivo

Objetivo: evitar sorpresas de datos antes de usuarios reales.

Escenarios:

- Desktop crea sesion, mobile la ve.
- Mobile completa sesion, desktop la ve.
- Proposal aceptada en un dispositivo converge en el otro.
- Delete/tombstone no reaparece.
- Offline/online con cola pendiente converge.
- Backup/export conserva campos nuevos de fuerza y estados de Plan Builder.

### 4. Smoke Prod Controlado

Objetivo: validar build, env vars, Netlify Function, auth, Supabase y proxy real.

Pasos:

- Deploy prod.
- Login real.
- Crear una sesion puntual desde chat.
- Crear una semana desde Week Creator.
- Crear un plan con Plan Builder.
- Aceptar una propuesta simple.
- Revisar Settings/Beta Quality.
- Probar app en mobile.

### 5. Beta Interna 3-5 Personas

Objetivo: aprender con usuarios cercanos sin abrir el producto.

Reglas:

- Invitar de a uno.
- Pedir feedback semanal.
- Clasificar fallos por provider, schema, prompt, logica deportiva, fechas, sync o UI.
- No perseguir todo comentario como feature request.
- Pausar invitaciones si aparece perdida de datos, auth roto o sync inconsistente.

### 6. Antes De Beta Ampliada

Objetivo: pasar de QA manual a operacion basica.

Pendientes:

- Telemetria remota resumida en Supabase.
- Feedback remoto asociado a trace/proposal/session.
- Usage limits server-side por usuario/requestClass.
- Rollup admin de calidad por planes.
- Decision de provider routing server-side por requestClass basada en datos.

## Que No Hacer Ahora

- No abrir beta publica.
- No agregar monetizacion/paywall.
- No migrar todo a Claude/OpenAI sin datos.
- No sumar features grandes antes de cerrar estabilidad.
- No persistir prompts completos o respuestas largas en remoto.
- No refactorizar prompts por estetica.

## Nota De Direccion

La prioridad de Junio es confianza operativa: generar semanas razonables, respetar fechas, sostener fuerza accionable, que Plan Builder no dependa del fallback local en casos normales, que sync no sorprenda y que cada fallo deje evidencia. Cuando eso ocurra repetidamente en dev y en smoke prod, la beta interna puede volver con buena calma.
