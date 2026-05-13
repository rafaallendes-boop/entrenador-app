# Entrenador App — Estudio y Plan de Refactor de Prompt Architecture

Fecha: 2026-05-13
Tipo: documento de estudio. Sin implementación. Para revisión y decisión antes de tocar código.

---

## TL;DR

El problema central del prompt builder de Entrenador **no es su tamaño** (2570 líneas en [promptBuilder.ts](src/services/ai/promptBuilder.ts)) sino la **fragmentación del contrato de salida `create_week`**. Ese contrato vive duplicado en al menos cuatro lugares:

1. [week/prompts/weekPrompt.ts](src/services/week/prompts/weekPrompt.ts) — 5 variantes de system prompt casi idénticas (`buildWeekSystemPromptMinimal`, `buildWeekSystemPrompt`, `buildWeekCreatorSystemPrompt`, `buildWeekBatchSystemPromptMinimal`, `buildWeekBatchSystemPrompt`).
2. [weekCreatorResponseSchema.ts](src/services/weekCreator/weekCreatorResponseSchema.ts) — schema JSON para Gemini structured output.
3. [WeekCreatorPromptBuilder.ts](src/services/weekCreator/WeekCreatorPromptBuilder.ts) — define su propia `outputContractLines` para el user prompt.
4. [promptBuilder.ts:1994](src/services/ai/promptBuilder.ts#L1994) `buildResponseInstructions` — describe el mismo schema en prosa, con variantes Full y Compact.

Cuando un campo nuevo se agrega, hay que tocar los cuatro. Cuando uno solo desincroniza, aparecen `actions_parse_failed`, `schema_invalid` y `missing_sport_details`. Los errores reales del [PROJECT_REVIEW_AND_ROADMAP.md](PROJECT_REVIEW_AND_ROADMAP.md) y los hallazgos de QA del 2026-05-13 apuntan a esto.

**Tesis del refactor**: consolidar **una sola fuente TypeScript** del contrato `create_week`, derivar de ahí tanto la prosa para los prompts como el JSON Schema para Gemini, y construir un orquestador modular delgado encima. Empezar por Week Creator porque ahí está el dolor medible y porque ya vive fuera de las 2570 líneas. **chat_general queda al final** porque es el menos riesgoso y el menos costoso.

Este documento describe el plan. No implementa nada. La fase 0 es solo instrumentación; ninguna fase se mergea sin que el `audit:prompt` y los snapshots actuales se mantengan o regresionen documentadamente.

---

## 1. Diagnóstico del estado actual

### 1.1 Inventario por archivo

| Archivo | LOC | Responsabilidad real | Entry points |
|---|---|---|---|
| [promptBuilder.ts](src/services/ai/promptBuilder.ts) | 2570 | Coach prompt para `chat_general`, `chat_action`, `weekly_summary`. Incluye secciones de contexto + reglas + ejemplos + schema en prosa. | `buildCoachSystemPrompt`, `buildCoachPrompt`, `buildLegacyPlannerResponseInstructionsSection` |
| [promptModules/squashPrompt.ts](src/services/ai/promptModules/squashPrompt.ts) | 452 | Squash: selection context, rules section, dynamic selection, match history, create_week examples. | Múltiples `buildXSquashY` |
| [promptModules/strengthPrompt.ts](src/services/ai/promptModules/strengthPrompt.ts) | 232 | Fuerza: selection context, rules, dynamic section, progression. | Idem |
| [promptModules/runningPrompt.ts](src/services/ai/promptModules/runningPrompt.ts) | 232 | Running: idem | Idem |
| [promptModules/cyclingPrompt.ts](src/services/ai/promptModules/cyclingPrompt.ts) | 270 | Cycling: idem | Idem |
| [promptModules/mobilityPrompt.ts](src/services/ai/promptModules/mobilityPrompt.ts) | 223 | Movilidad: idem | Idem |
| [promptModules/shared.ts](src/services/ai/promptModules/shared.ts) | 290 | Helpers compartidos: fatiga derivada, formato de fechas, scoring competitivo, pace utils. | Reutilizado por todos |
| [week/prompts/weekPrompt.ts](src/services/week/prompts/weekPrompt.ts) | 396 | System prompts y user prompts de generación semanal. **Aquí están las 5 variantes duplicadas.** | `buildWeekSystemPrompt*`, `buildWeekCreatorSystemPrompt`, `buildWeekUserPrompt`, `buildWeekBatchUserPrompt` |
| [planBuilder/prompts/weekPrompt.ts](src/services/planBuilder/prompts/weekPrompt.ts) | 1 | Re-export de `week/prompts/weekPrompt.ts`. | (alias) |
| [WeekCreatorPromptBuilder.ts](src/services/weekCreator/WeekCreatorPromptBuilder.ts) | 305 | Construye el user prompt para Week Creator y consume `buildWeekCreatorSystemPrompt`. | `buildWeekCreatorPrompt` |
| [weekCreatorResponseSchema.ts](src/services/weekCreator/weekCreatorResponseSchema.ts) | 118 | JSON Schema para Gemini `responseSchema` (structured output). | `WEEK_CREATOR_RESPONSE_SCHEMA` |
| [validateWeekCreatorResponse.ts](src/services/weekCreator/validateWeekCreatorResponse.ts) | 379 | Validación en TypeScript del create_week parseado. | `validateWeekCreatorResponse` |
| [scripts/audit-prompt-tokens.test.ts](scripts/audit-prompt-tokens.test.ts) | 112 | Imprime tabla de tokens por requestClass. Heurística: 1 token ≈ 4 chars. **No assertea — solo imprime.** | `npm run audit:prompt` |

Observación de alto nivel: el código ya intentó dos rondas de modularización (los `promptModules/*` por deporte, y el split de Week Creator/Plan Builder fuera de `promptBuilder.ts`). El refactor pendiente no es reescribir desde cero — es **terminar lo que ya se empezó** y cerrar la duplicación del contrato de salida.

### 1.2 Duplicaciones y secciones redundantes (con evidencia)

#### A) Contrato `create_week` repetido 5 veces en prosa

[week/prompts/weekPrompt.ts](src/services/week/prompts/weekPrompt.ts) define:

| Función | Líneas | Diferencia con las otras |
|---|---|---|
| `buildWeekSystemPromptMinimal` | [173-186](src/services/week/prompts/weekPrompt.ts#L173-L186) | usa `SESSION_SCHEMA_BLOCK_MINIMAL` |
| `buildWeekSystemPrompt` | [188-202](src/services/week/prompts/weekPrompt.ts#L188-L202) | usa `SESSION_SCHEMA_BLOCK_FULL` + 1 línea extra de revisión |
| `buildWeekCreatorSystemPrompt` | [204-222](src/services/week/prompts/weekPrompt.ts#L204-L222) | minimal + texto extra "puedes crear semana standalone" + ejemplo inline |
| `buildWeekBatchSystemPromptMinimal` | [224-237](src/services/week/prompts/weekPrompt.ts#L224-L237) | minimal + "DOS semanas consecutivas" |
| `buildWeekBatchSystemPrompt` | [239-253](src/services/week/prompts/weekPrompt.ts#L239-L253) | full + "DOS semanas consecutivas" |

El 80% de cada función es el mismo párrafo describiendo: "responde solo con <actions>", "type=create_week", "targetDate=lunes YYYY-MM-DD", "no devuelvas texto fuera del bloque". Los deltas reales son tres ejes ortogonales: **densidad** (minimal vs full), **cantidad** (1 vs 2 semanas), **origen** (plan vs standalone). Eso debería ser un solo builder parametrizado, no cinco copias.

#### B) Schema en prosa duplicado con el JSON Schema

[SESSION_SCHEMA_BLOCK_MINIMAL](src/services/week/prompts/weekPrompt.ts#L98-L120) y [SESSION_SCHEMA_BLOCK_FULL](src/services/week/prompts/weekPrompt.ts#L122-L171) son strings literales que describen los mismos campos que [WEEK_CREATOR_RESPONSE_SCHEMA](src/services/weekCreator/weekCreatorResponseSchema.ts#L1-L118). Hoy hay **tres fuentes** del contrato sesión:

1. La prosa en `SESSION_SCHEMA_BLOCK_FULL` (la que ve el modelo cuando no se usa structured output).
2. El JSON Schema en `WEEK_CREATOR_RESPONSE_SCHEMA` (la que ve Gemini cuando se usa `responseMimeType: application/json`).
3. El validador imperativo en [validateWeekCreatorResponse.ts](src/services/weekCreator/validateWeekCreatorResponse.ts) (lo que el código TypeScript chequea después).

Ejemplo concreto de drift posible: `WEEK_CREATOR_RESPONSE_SCHEMA` declara `cyclingDetails` con campos `intensity`, `targetPowerMin/Max`, `targetCadenceMin/Max` ([weekCreatorResponseSchema.ts:92-101](src/services/weekCreator/weekCreatorResponseSchema.ts#L92-L101)). `SESSION_SCHEMA_BLOCK_FULL` describe cycling como `{"sessionCategory": string, "targetStructure": string, "intensityReference"?: string, "executionNotes"?: string}` ([week/prompts/weekPrompt.ts:151](src/services/week/prompts/weekPrompt.ts#L151)). **Son schemas distintos para el mismo deporte**, en el mismo repo, ambos enviados al modelo según el camino. Esto es exactamente lo que produce `schema_invalid` en QA real.

#### C) Variantes Full vs Compact replicadas 6 veces sin abstracción

En `buildResponseInstructions` ([promptBuilder.ts:1994](src/services/ai/promptBuilder.ts#L1994)) se elige `useCompactExamples` y se ramifica a:

- `buildFullCriticalRulesSection` ([2312](src/services/ai/promptBuilder.ts#L2312)) vs `buildCompactCriticalRulesSection` ([2324](src/services/ai/promptBuilder.ts#L2324))
- `buildFullCompetitionRulesSection` ([2336](src/services/ai/promptBuilder.ts#L2336)) vs `buildCompactCompetitionRulesSection` ([2354](src/services/ai/promptBuilder.ts#L2354))
- `buildFullPlannerExamples` ([2178](src/services/ai/promptBuilder.ts#L2178)) vs `buildCompactPlannerExamples` ([2234](src/services/ai/promptBuilder.ts#L2234)) — con 3 subvariantes cada uno (squash, running, strength)
- Inline ternarios para `intervalStructureSection`, `exerciseSchemaSection`, `warmupCooldownSection`

Cada Compact es una versión más corta del Full con la misma intención. No hay un mecanismo formal "este pack tiene densidad A o B" — es código duplicado con la palabra "compact" en el nombre. Esto multiplica por 2 el espacio de cambios cada vez que se ajusta una regla.

#### D) Cuatro secciones disparadas por la misma flag

En [promptBuilder.ts:230-233](src/services/ai/promptBuilder.ts#L230-L233):

```ts
{ key: 'hybrid', content: hasCompetitionSoon ? buildHybridSection(context) : '' },
{ key: 'competition', content: hasCompetitionSoon ? buildCompetitionSection(context) : '' },
{ key: 'competition_load', content: hasCompetitionSoon ? buildCompetitionLoadSection(context) : '' },
{ key: 'implicit_priority', content: hasCompetitionSoon ? buildImplicitPrioritySection(context) : '' },
```

Son cuatro secciones que comparten la misma condición de activación y conceptualmente forman una unidad: "el atleta compite pronto, ajusta carga y prioridad". Mantenerlas separadas tiene sentido si alguna se activa sola; hoy ninguna lo hace.

#### E) Output contract duplicado en Week Creator

[WeekCreatorPromptBuilder.ts:38-46](src/services/weekCreator/WeekCreatorPromptBuilder.ts#L38-L46) define localmente `outputContractLines` con dos variantes según `structuredOutput`. Esas mismas reglas (responder con JSON puro vs con `<actions>`) están en `buildWeekCreatorSystemPrompt`. El user prompt y el system prompt se repiten en el mismo viaje.

#### F) `chat_general` no tan liviano como aparenta

El target declarado es ~3.5K tokens ([promptBuilder.ts:150](src/services/ai/promptBuilder.ts#L150)). Lo logra con `buildLitePersonaSection`, `buildSlimAthleteProfileSection`, y el `finalizePromptBuildResult` que descarta secciones opcionales si exceden el target ([318-345](src/services/ai/promptBuilder.ts#L318-L345)). Funciona, pero el truncamiento es por orden de aparición — sin priorización explícita por valor del contenido para la pregunta. Aceptable hoy, no es el problema más urgente.

### 1.3 Instrucciones mezcladas dentro del mismo bloque

`buildResponseInstructions` ([promptBuilder.ts:1994-2173](src/services/ai/promptBuilder.ts#L1994-L2173)) mezcla:

- Persona y voz del coach (implícita en otras secciones)
- Reglas críticas de comportamiento
- Reglas de semana competitiva
- Lista de acciones disponibles con sus campos
- Schema de sesión por deporte (cada uno con su variante)
- Formato de respuesta (`<actions>` tags)
- Ejemplos (full o compact, por deporte)

Cualquiera de estas piezas podría vivir en su propio módulo. Mezclar acción + schema + ejemplo + reglas conversacionales hace que cambiar una regla de squash requiera leer 180 líneas para encontrarla.

---

## 2. Mapa de requestClass y qué secciones incluye cada uno

Tabla precisa de qué entra en el system prompt según `requestClass`. Reconstruida desde el código, no desde docs.

| Sección | `chat_general` | `chat_action` | `weekly_summary` | `week_creator` | `plan_builder_week` | `plan_builder_pair` |
|---|---|---|---|---|---|---|
| persona | ✅ lite | ✅ full | ✅ full | — | — | — |
| athlete_profile | ✅ slim | ✅ slim | ✅ full | resumen propio | resumen propio | resumen propio |
| week (rango fechas) | ✅ | ✅ | ✅ | — | — | — |
| sessions planificadas | ✅ (read-only) | ✅ (with IDs) | ✅ | week target subset | — | — |
| today | ✅ | ✅ | ✅ | — | — | — |
| coach_memory | opcional | opcional | ✅ | opcional | — | — |
| fatigue | compact | full | full | (en config) | (en wizard) | (en wizard) |
| macro_plan | si competencia ≤14d | si competencia ≤14d | ✅ | si aplica | ✅ | ✅ |
| nutrition | si keyword | si keyword | — | — | — | — |
| load_analytics | si keyword | si keyword | ✅ | — | — | — |
| recent_proposals | — | ✅ | — | — | — | — |
| week_logs | — | ✅ | ✅ | resumen propio | — | — |
| hybrid + competition + competition_load + implicit_priority | — | si comp soon | — | — | (race rule) | (race rule) |
| sport_match_history:squash | — | si squash | — | — | — | — |
| sport_dynamic:squash | — | si squash | — | (selectors) | (selectors) | (selectors) |
| sport_dynamic:strength | — | si strength | — | (selectors) | (selectors) | (selectors) |
| sport_dynamic:running | — | si running | — | (selectors) | (selectors) | (selectors) |
| sport_dynamic:cycling | — | si cycling | — | (selectors) | (selectors) | (selectors) |
| sport_dynamic:mobility | — | si mobility | — | (selectors) | (selectors) | (selectors) |
| strength_progression | — | si strength | — | — | — | — |
| session_feedback | — | si keyword | ✅ | — | — | — |
| response_instructions (general / adjust / weekly / create_week) | ✅ general | ✅ adjust (full action schema + 6 variantes) | ✅ weekly | ✅ create_week | ✅ create_week | ✅ create_week×2 |
| output schema (prosa) | — | en response_instructions | — | en system prompt | en system prompt | en system prompt |
| output schema (JSON) | — | — | — | en `responseSchema` Gemini | — | — |

Lecturas importantes de esta tabla:

1. **`week_creator`, `plan_builder_week` y `plan_builder_pair` ya viven afuera del builder principal**, en `WeekCreatorPromptBuilder` y `week/prompts/weekPrompt.ts`. El refactor de Week Creator no toca `chat_general` ni `chat_action`. Por eso es la mejor primera fase.
2. **`chat_action` es el más cargado**: 24 secciones, sport dynamic por deporte, recovery, full action schema y ejemplos. Es donde más se va a notar la consolidación del contrato (fase 4).
3. **`chat_general` está ya bastante limitado** por `finalizePromptBuildResult` con su target de 3.5K tokens. Es el menos urgente.
4. **`weekly_summary` tiene su propio camino** ([promptBuilder.ts:259-278](src/services/ai/promptBuilder.ts#L259-L278)) sin la tubería de `PromptSectionSpec`. Tocarlo no es prioridad para este refactor.

---

## 3. Identificación de duplicaciones y secciones largas (resumen accionable)

Repaso priorizado por dolor, no por tamaño:

| # | Duplicación | Dónde | Impacto medido o esperado |
|---|---|---|---|
| 1 | **Contrato `create_week` en 3 fuentes (prosa MINIMAL, prosa FULL, JSON Schema)** | week/prompts/weekPrompt.ts + weekCreatorResponseSchema.ts | Causa raíz probable de `actions_parse_failed` y `schema_invalid` en Week Creator (PROJECT_REVIEW 2026-05-13). |
| 2 | **5 system prompts casi idénticos** | week/prompts/weekPrompt.ts | Cambios duplican esfuerzo; cualquier divergencia por olvido se manifiesta como inconsistencia entre standalone y batch. |
| 3 | **Output contract repetido en user prompt y system prompt de Week Creator** | WeekCreatorPromptBuilder.ts + week/prompts/weekPrompt.ts | Confunde al modelo si las dos versiones se contradicen, especialmente en modo `structuredOutput`. |
| 4 | **Full vs Compact replicado 6 veces** | promptBuilder.ts (criticalRules, competitionRules, plannerExamples × deporte, schemas inline) | Ajustar una regla requiere tocar dos funciones; típico vector de bugs por inconsistencia. |
| 5 | **4 secciones competitivas atadas a la misma flag** | promptBuilder.ts:230-233 | Cambiar lógica competitiva requiere editar 4 builders separados. |
| 6 | **`buildResponseInstructions` mezcla 7 conceptos en 180 líneas** | promptBuilder.ts:1994 | Lectura y diff cost alto; afecta directamente velocidad de iteración del coach. |
| 7 | **`promptModules/*` ya modular pero el builder principal los referencia inline** | promptBuilder.ts | Hay dos arquitecturas conviviendo. Refactor concluye la migración iniciada. |

Lo que NO es duplicación, aunque parezca:

- **Selectors por deporte** (`runningSelector`, `squashWeekPlanner`, `strengthSelector`) viven en `src/services/` aparte y son lógica determinística — no son prompt. No los tocamos en este refactor.
- **Las dos copias de fatigue (compact vs full)** son legítimas: hay requestClasses que necesitan la versión expandida y otras que no. Lo que falta es un mecanismo formal para expresar densidad, pero el contenido divergente está bien justificado.

---

## 4. Propuesta de arquitectura modular (estratégica)

Seis capas. Cada una con un único motivo de cambio. Dependencias estrictamente de arriba hacia abajo. **Cero dependencias circulares**.

```
src/services/ai/prompt/
├── core/
│   ├── coachContract.ts         (persona, idioma, anti-hallucination)
│   ├── requestContract.ts       (qué pide cada requestClass)
│   └── outputContract.ts        (single source of truth para schemas + renderers)
├── packs/
│   ├── sports/
│   │   ├── squash.ts            (consolida promptModules/squashPrompt.ts)
│   │   ├── running.ts
│   │   ├── strength.ts
│   │   ├── cycling.ts
│   │   └── mobility.ts
│   ├── data/
│   │   ├── athlete.ts           (slim + full variants)
│   │   ├── week.ts              (week dates + sessions list)
│   │   ├── fatigue.ts           (compact + full)
│   │   ├── nutrition.ts
│   │   ├── macroPlan.ts
│   │   ├── competition.ts       (fusiona hybrid + competition + load + implicit_priority)
│   │   └── sessionFeedback.ts
│   └── quality/
│       ├── criticalRules.ts     (single source con density variants)
│       ├── competitionRules.ts
│       ├── goldenRule.ts
│       └── recoveryAddendum.ts
├── renderers/
│   ├── proseSchema.ts           (renderiza OutputContract → texto para <actions>)
│   └── jsonSchema.ts            (renderiza OutputContract → JSON Schema Gemini/OpenAI/Claude)
└── buildPrompt.ts               (orquestador < 300 LOC)
```

### 4.1 `core/coachContract`

Responsabilidad: cómo se comporta el coach, no qué hace.

- Persona (entrenador personal, español rioplatense, conciso).
- Voz (directa, sin hedging excesivo, sin disclaimers innecesarios).
- Anti-alucinación (si falta contexto, dilo en una frase; no inventes datos del atleta).
- Idioma y formato de fechas/unidades.

Compartido por **todos** los requestClass. Esta capa es la única que casi nunca cambia.

### 4.2 `core/requestContract`

Responsabilidad: qué se le pide al modelo según el requestClass.

Por cada requestClass: objetivo, formato general (conversacional vs acción), longitud esperada, qué packs incluir por defecto, qué densidad usar (`compact` | `full`).

No describe schemas, no describe deportes, no incluye ejemplos. Solo "para chat_general, respondé conversacional, máximo 3 párrafos". Es la tabla de la sección 2 de este documento materializada en código.

### 4.3 `core/outputContract` (corazón del refactor)

Responsabilidad: **una sola fuente** de qué es una acción válida.

Define en TypeScript la forma de cada acción (`create_week`, `add_session`, `update_session`, `replace_session_type`, etc.) y la forma de una sesión por deporte. De ahí se derivan automáticamente:

- El texto en prosa que se inyecta cuando NO se usa structured output.
- El JSON Schema para Gemini `responseSchema`.
- Idealmente, un schema runtime para `validateWeekCreatorResponse` (este último paso no es bloqueante para este refactor).

Detalle concreto y signatures en la sección 5.

### 4.4 `packs/sports/*`

Responsabilidad: contenido específico del deporte.

Consolida `src/services/ai/promptModules/*.ts`. Cada pack expone:

- `buildSelectionContext(ctx)` — para chat_action y week_creator.
- `buildRulesSection(density)` — reglas de contenido (squash con sus ≥4 drills, fuerza con sus 6-7 bloques, etc.).
- `buildDynamicSelectionSection(ctx, summary)` — drills/ejercicios concretos.
- `buildExamples(opts)` — ejemplos de create_week, update_session.

Convención: cualquier pack es opt-in según `relevantSports` detectado por `requestContract`. Si no es relevante, no se carga. Hoy ya pasa esto, solo se formaliza.

### 4.5 `packs/data/*`

Responsabilidad: secciones de contexto deterministas. Lo que hoy hace `buildXSection` en `promptBuilder.ts`, pero como módulos independientes.

Cada módulo expone:

```ts
{
  key: string,
  appliesTo(req: RequestClass, ctx: ChatContext): boolean,
  build(ctx: ChatContext, density: Density): string,
  estimatedTokens(ctx: ChatContext): number,
}
```

`competition.ts` fusiona los 4 builders actuales (`buildHybridSection`, `buildCompetitionSection`, `buildCompetitionLoadSection`, `buildImplicitPrioritySection`) en una sola sección coherente, manteniendo el output textual equivalente.

### 4.6 `packs/quality/*`

Responsabilidad: reglas de calidad y formato del output.

Hoy duplicadas en Full y Compact dentro de `promptBuilder.ts`. Aquí cada regla vive una vez con dos densidades expuestas vía `build(density)`. La densidad la decide `requestContract`, no el caller.

### 4.7 Orquestador `buildPrompt.ts`

```
buildPrompt(requestClass, ctx) → { systemPrompt, userPrompt, trace }
```

Pseudocódigo:

1. Resolver `requestContract` para el `requestClass`.
2. Decidir `relevantSports` con la heurística actual (`detectMentionedSports` + `getRelevantSportPool`).
3. Recolectar packs aplicables (`data` + `sports` + `quality`).
4. Ensamblar respetando `targetTokens` con el mismo algoritmo de `finalizePromptBuildResult` (drop opcionales si exceden target).
5. Devolver `systemPrompt`, `userPrompt`, y `trace` ampliado.

Target de tamaño: el orquestador debe quedar bajo 300 LOC. Si crece más, indica que la separación de capas está mal hecha.

### 4.8 Lo que **no** está en esta arquitectura (por diseño)

- **No hay** template engine tipo Handlebars/Mustache. Cadenas TypeScript con template literals son suficientes para este tamaño y son grep-eables. Introducir un template engine sería sobrediseño (ver sección 9).
- **No hay** sistema de plugins ni registro dinámico. Los packs se importan explícitamente. La importación es la documentación.
- **No hay** capa de caché ni memoización. La construcción del prompt no es el cuello de botella.
- **No hay** sistema de A/B testing de prompts a nivel framework. Eso pertenece a la capa de provider routing del BETA_AUDIT, no a esta.

---

## 5. Piloto detallado: Week Creator

El piloto profundo. Las interfaces TypeScript de esta sección son referenciales — pseudo-código para evaluar el enfoque, **no para copiar y pegar**. La implementación final se decide en el plan de implementación que sigue a este estudio.

### 5.1 Estado actual de Week Creator

Hoy el flujo es:

1. [WeekCreatorEngine.ts](src/services/weekCreator/WeekCreatorEngine.ts) recibe la solicitud, configura `WeekCreatorEffectiveConfig`, calcula `targetWeekStart`.
2. [WeekCreatorPromptBuilder.buildWeekCreatorPrompt()](src/services/weekCreator/WeekCreatorPromptBuilder.ts#L22) construye `systemPrompt` (delegando en [buildWeekCreatorSystemPrompt](src/services/week/prompts/weekPrompt.ts#L204)) y `userPrompt` (ensamblando perfil + config + reglas squash + historia + day logs + retry).
3. Si `structuredOutput`, se pasa también `WEEK_CREATOR_RESPONSE_SCHEMA` al provider Gemini.
4. La respuesta entra a [validateWeekCreatorResponse.ts](src/services/weekCreator/validateWeekCreatorResponse.ts).
5. Si valida, se repara con `repairGeneratedWeek` (planBuilder); si no, se reintenta con `retryInstruction`. Tras 2 fallos, fallback determinístico.

**Tres fuentes que pueden divergir**:

- Prosa system prompt → `SESSION_SCHEMA_BLOCK_MINIMAL` + reglas adicionales en `buildWeekCreatorSystemPrompt`.
- Prosa user prompt → reglas de squash inline en `buildSquashContentRules` + `outputContractLines` propias.
- JSON Schema → `WEEK_CREATOR_RESPONSE_SCHEMA` con tipos parcialmente distintos a la prosa (caso cycling visto en §1.2.B).

### 5.2 Interfaces propuestas (referencial)

Estas signatures muestran el enfoque. Tipos exactos y narrowing se definen al implementar.

```ts
// core/outputContract.ts ── SINGLE SOURCE OF TRUTH

import type { SupportedSport } from '../../../types'

export type ActionKind =
  | 'create_week'
  | 'add_session'
  | 'update_session'
  | 'replace_session_type'
  | 'move_session'
  | 'skip_session'
  | 'change_rpe'
  | 'shorten_session'
  | 'lengthen_session'
  | 'insert_recovery'
  | 'delete_session'

export type Density = 'minimal' | 'full'

/** Describe un campo de schema una sola vez. */
export interface FieldSpec {
  name: string
  type: 'string' | 'integer' | 'number' | 'enum' | 'object' | 'array'
  required: boolean
  description?: string                  // se usa en prosa
  enumValues?: readonly string[]
  itemSpec?: FieldSpec                  // para arrays
  childFields?: readonly FieldSpec[]    // para objects
  example?: string | number             // se usa en prosa
}

/** Describe el contrato de una sesión por deporte. */
export interface SessionContract {
  sport: SupportedSport | 'recovery' | 'nutrition'
  baseFields: readonly FieldSpec[]
  requiredDetailsField?: FieldSpec      // squashDetails, exercises, etc.
  optionalFields?: readonly FieldSpec[]
}

/** Describe el contrato de una acción. */
export interface ActionContract {
  kind: ActionKind
  description: string
  fields: readonly FieldSpec[]
  sessionContracts?: readonly SessionContract[]  // si la acción contiene sessions[]
}

/** Catálogo completo. Esta constante es la fuente única. */
export const ACTION_CONTRACTS: Readonly<Record<ActionKind, ActionContract>>
```

Y los dos renderers que consumen el mismo `ActionContract`:

```ts
// renderers/proseSchema.ts

/** Convierte un ActionContract a la prosa que hoy vive en SESSION_SCHEMA_BLOCK_FULL. */
export function renderActionAsProse(
  action: ActionContract,
  density: Density,
): string

/** Convierte una lista de acciones permitidas a la sección "ACCIONES DISPONIBLES". */
export function renderActionCatalog(
  actions: readonly ActionKind[],
  density: Density,
): string
```

```ts
// renderers/jsonSchema.ts

/** Convierte un ActionContract al JSON Schema que hoy vive en WEEK_CREATOR_RESPONSE_SCHEMA. */
export function renderActionAsJsonSchema(
  action: ActionContract,
  options?: { providerDialect?: 'gemini' | 'openai' | 'claude' },
): Record<string, unknown>
```

`WeekCreatorPromptBuilder` se vuelve un consumidor delgado:

```ts
// weekCreator/WeekCreatorPromptBuilder.ts ── DESPUÉS

import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { renderActionAsProse } from '../ai/prompt/renderers/proseSchema'
import { buildCoachContract } from '../ai/prompt/core/coachContract'
import { squashPack, runningPack, strengthPack, /* ... */ } from '../ai/prompt/packs/sports'

export function buildWeekCreatorPrompt(
  context: ChatContext,
  input: WeekCreatorPromptInput,
): WeekCreatorPromptBuildResult {
  const createWeekAction = ACTION_CONTRACTS.create_week
  const schemaSection = input.structuredOutput
    ? null  // structured output usa JSON Schema, no prosa
    : renderActionAsProse(createWeekAction, 'minimal')

  const systemPrompt = [
    buildCoachContract({ allowActions: true, requestClass: 'week_creator' }),
    schemaSection,
    'Respondes EXCLUSIVAMENTE con una sola create_week para targetDate=' + input.targetWeekStart,
  ].filter(Boolean).join('\n\n')

  const userPrompt = [
    buildProfileSummary(context.athleteProfile),
    buildConfigSummary(input.config),
    squashPack.buildRulesSection('minimal', input.config),  // solo si squash aplica
    // … resto del user prompt
  ].filter(Boolean).join('\n')

  return { systemPrompt, userPrompt }
}
```

Y el schema Gemini se deriva de la misma fuente:

```ts
// weekCreator/weekCreatorResponseSchema.ts ── DESPUÉS

import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { renderActionAsJsonSchema } from '../ai/prompt/renderers/jsonSchema'

export const WEEK_CREATOR_RESPONSE_SCHEMA = renderActionAsJsonSchema(
  ACTION_CONTRACTS.create_week,
  { providerDialect: 'gemini' },
)
```

### 5.3 Pseudo-ejemplo concreto: el caso cycling

Hoy mismo (§1.2.B) la prosa describe cycling como `{sessionCategory, targetStructure, intensityReference?, executionNotes?}` y el JSON Schema lo describe como `{intensity, targetPowerMin/Max, targetCadenceMin/Max}`. Con el contrato único, ambas fuentes se derivarían de una única declaración:

```ts
// Pseudo-ejemplo. Estructura final puede ajustarse al implementar.
const cyclingSessionContract: SessionContract = {
  sport: 'cycling',
  baseFields: [/* date, timeBlock, sessionType, title, durationMin, objective, rpe? */],
  requiredDetailsField: {
    name: 'cyclingDetails',
    type: 'object',
    required: true,
    description: 'Detalles obligatorios para sesiones cycling.',
    childFields: [
      { name: 'sessionCategory', type: 'string', required: true,
        description: 'Categoría: support aerobic, intervals, recovery, etc.' },
      { name: 'targetStructure', type: 'string', required: true,
        description: 'Estructura del entrenamiento en una frase.' },
      { name: 'intensityReference', type: 'string', required: false,
        enumValues: ['low', 'moderate', 'hard'] },
      { name: 'executionNotes', type: 'string', required: false },
    ],
  },
}
```

A partir de eso:

- `renderActionAsProse(create_week, 'full')` genera el bloque que hoy vive como string en `SESSION_SCHEMA_BLOCK_FULL` lines 150-153.
- `renderActionAsJsonSchema(create_week, { providerDialect: 'gemini' })` reemplaza el objeto literal de `weekCreatorResponseSchema.ts` lines 92-101.

Si alguien quiere agregar un campo nuevo (`avgWatts`, por ejemplo) lo agrega en **un solo lugar**. La prosa, el schema Gemini y, eventualmente, el validador se actualizan juntos.

### 5.4 Cómo este piloto define la API para el resto

Una vez probado en Week Creator, el mismo patrón cubre `chat_action`:

- `chat_action` necesita renderizar **múltiples** actions (`add_session`, `update_session`, `replace_session_type`, etc.), no solo `create_week`.
- `renderActionCatalog(['add_session', 'update_session', /* ... */], 'full')` produce la sección "ACCIONES DISPONIBLES" que hoy vive entre [promptBuilder.ts:2100-2120](src/services/ai/promptBuilder.ts#L2100-L2120).
- `renderActionAsProse(action, 'full')` produce los bloques de schema que hoy se repiten en `buildResponseInstructions`.

`chat_general` no necesita output schema en absoluto, así que ni renderer ni `ActionContract` se invocan.

### 5.5 Hipótesis falsables

El refactor del piloto se justifica si y solo si **al menos una** de estas hipótesis se cumple en QA real:

1. **H1**: La tasa de `actions_parse_failed` en Week Creator (medida con `npm run audit:prompt` + Beta Quality export en 5 corridas reales con Gemini post-refactor) cae respecto del baseline pre-refactor.
2. **H2**: La tasa de `schema_invalid` en Week Creator cae respecto del baseline.
3. **H3**: La tasa de fallback determinístico de Week Creator cae respecto del baseline.

Si ninguna de las tres se cumple, el refactor no logró su objetivo declarado y se revierte. Las métricas de calidad subjetiva deportiva (§7) son condición de **no regresión**, no de éxito.

---

## 6. Tests de contrato necesarios antes de refactorizar

Sin estos tests, no se ejecuta la Fase 1. La idea es congelar el output textual actual y permitir comparación byte-a-byte.

### 6.1 Snapshots por requestClass

Archivo nuevo: `src/services/ai/__tests__/promptSnapshots.test.ts`.

- Fixture mínimo: el mismo de [audit-prompt-tokens.test.ts](scripts/audit-prompt-tokens.test.ts) (squash primary + 3 secundarios, sin sesiones, sin goalEvents).
- Fixtures realistas (3-4): atleta squash con competencia próxima, atleta running con plan activo, atleta mixto con macroPlan, atleta sin perfil completo.
- Para cada fixture × `requestClass` ∈ {`chat_general`, `chat_action`, `weekly_summary`, `week_creator`}, snapshot del `systemPrompt` resultante.

Total esperado: ~16-20 snapshots. Cada cambio textual hace fallar al menos uno, lo cual obliga a documentar el cambio.

### 6.2 Snapshot de Week Creator

Archivo nuevo: `src/services/weekCreator/__tests__/weekCreatorPromptSnapshots.test.ts`.

Casos a cubrir:

- Config defaults (perfil vacío) con `structuredOutput=false`.
- Config defaults con `structuredOutput=true`.
- Squash primary, 5 sesiones/semana, sin competencia.
- Squash primary, 5 sesiones/semana, competencia en 7 días.
- Running primary, 4 sesiones/semana, plan activo.
- Strength primary, 3 sesiones/semana.
- Retry instruction presente.

Total: 7 snapshots de system + user prompt.

### 6.3 Test de paridad schema ↔ prose

Archivo nuevo: `src/services/ai/__tests__/outputContractParity.test.ts`.

Asserta que las reglas obligatorias declaradas en prosa para cada deporte (drills required, exercises required, cyclingDetails required, mobilityDetails required) coincidan con los `required` en `WEEK_CREATOR_RESPONSE_SCHEMA`. Hoy nadie chequea esto; mañana después del refactor, ambas derivan del mismo `ActionContract` y el test se vuelve trivial.

Pre-refactor el test debe pasar contra el estado actual (puede que detecte el drift cycling de §1.2.B — si lo hace, es un bug encontrado, no un fallo del test).

### 6.4 Estabilidad de tokens

Archivo: extender [scripts/audit-prompt-tokens.test.ts](scripts/audit-prompt-tokens.test.ts).

Hoy solo imprime. Agregar una variante que **assertee** que cada `requestClass` se mantiene en un rango de tokens documentado. Pre-refactor el test toma como verdad el estado actual; cada fase del refactor puede subir o bajar el target documentando el motivo.

Tabla baseline (a llenar antes de Fase 1):

```
chat_general:        target X tokens, tolerancia ±10%
chat_action:         target X tokens, tolerancia ±10%
weekly_summary:      target X tokens, tolerancia ±10%
week_creator:        target X tokens, tolerancia ±10%
plan_builder_week:   target X tokens, tolerancia ±10%
```

### 6.5 Smoke tests existentes que NO se tocan

- [WeekCreatorEngine.test.ts](src/services/weekCreator/__tests__/) — debe seguir verde.
- Toda la suite `src/services/__tests__/*` — verde.
- `npm run e2e:dev` (review-only) — verde.
- `npm run e2e:plan` (review-only) — verde.

### 6.6 Tests que NO se agregan en este refactor

- Validación del coach contra prompts adversariales — fuera de scope.
- Comparación de outputs entre providers — pertenece a BETA_AUDIT, no a este refactor.
- Tests de performance de construcción de prompt — no es bottleneck.

---

## 7. Plan por fases

Cada fase es pequeña, reversible y entrega valor incremental. Ninguna fase entra a `main` sin que las anteriores se hayan validado en QA real con Gemini.

### Fase 0 — Baseline e instrumentación (1 día)

Sin tocar prompts. Solo medir.

- Crear los snapshots de §6.1 y §6.2 capturando el estado **actual** del código.
- Crear el test de paridad de §6.3 — si detecta drift hoy, abrir issue separado, no resolverlo en este refactor.
- Extender `audit:prompt` con el assert de §6.4 contra los valores actuales.
- Guardar el output de `audit:prompt` como `docs/prompt-baseline-2026-05-XX.json` (o equivalente).
- Persistir un export de Beta Quality con 3-5 corridas reales actuales de Week Creator y chat_action para tener punto de comparación de outcome real.

Criterio de salida: snapshots verdes, tests de tokens verdes, baseline guardado en el repo.

### Fase 1 — Consolidación del contrato `create_week` (2-3 días)

**Esta fase debe mantener comportamiento equivalente.** Cualquier cambio en el prompt final que llega al modelo debe quedar explicado en el commit con qué cambió y por qué. Si el cambio es solo cosmético (reordenar campos, normalizar whitespace) se documenta como "cosmetic". Si cambia la semántica, la fase **no se mergea** sin re-correr las 5 corridas de QA real con Gemini y comparar contra el baseline.

Pasos:

1. Crear `core/outputContract.ts` con `ActionContract` para `create_week` solamente.
2. Crear `renderers/proseSchema.ts` y `renderers/jsonSchema.ts` (versión mínima: solo soporta lo necesario para create_week).
3. Reescribir `WEEK_CREATOR_RESPONSE_SCHEMA` derivándolo del contrato. **Snapshot debe ser idéntico al actual** — si no lo es, documentar y aceptar/rechazar.
4. Reescribir `SESSION_SCHEMA_BLOCK_MINIMAL` y `SESSION_SCHEMA_BLOCK_FULL` derivándolos del contrato. Snapshot del system prompt de `week_creator` debe ser idéntico o regresión documentada.
5. Eliminar las 5 variantes de `buildWeekSystemPrompt*` reemplazándolas por una sola función parametrizada. Snapshot de cada caso debe coincidir con su predecesor o tener regresión documentada.
6. Correr `e2e:dev`, `e2e:plan`, `audit:prompt`, `loadtest:week-creator` y 5 corridas reales del Week Creator con Gemini. Comparar Beta Quality export contra baseline.

Criterio de salida: contrato único de `create_week` en el repo, snapshots iguales o con regresión justificada, métricas de outcome no peores que el baseline.

### Fase 2 — Mover Week Creator a la arquitectura modular del piloto (2 días)

1. Mover `WeekCreatorPromptBuilder` a consumir `outputContract` + `coachContract` + un primer `squashPack`.
2. Eliminar `outputContractLines` y `buildSquashContentRules` locales — pasan al pack.
3. Snapshots del user prompt de Week Creator deben mantenerse equivalentes.
4. Re-correr `e2e:dev`, `e2e:plan`, `audit:prompt`, `loadtest:week-creator` y 5 corridas reales.

Criterio de salida: Week Creator usa la nueva arquitectura, snapshots equivalentes, métricas de outcome iguales o mejores.

### Fase 3 — Extraer `quality` del builder principal (2 días)

Esta fase **no toca `chat_general` aún**.

1. Mover `criticalRules`, `competitionRules`, `goldenRule` de `promptBuilder.ts` a `packs/quality/*`.
2. Reescribir las variantes Full y Compact como un solo módulo con `build(density)`.
3. `promptBuilder.ts` consume los packs en lugar de definirlos inline.
4. Snapshot de `chat_action` debe mantenerse equivalente o tener regresión documentada.

Criterio de salida: `promptBuilder.ts` reduce ~200 LOC, snapshots de `chat_action` equivalentes o documentados.

### Fase 4 — Refactor de `buildResponseInstructions` (chat_action) (3 días)

La fase más larga porque toca el camino del coach activo.

1. Extender `outputContract` para cubrir el catálogo completo de acciones (`add_session`, `update_session`, `replace_session_type`, `move_session`, etc.).
2. Reemplazar la sección "ACCIONES DISPONIBLES" inline en `buildResponseInstructions` con `renderActionCatalog`.
3. Reemplazar los esquemas de sesión inline con `renderActionAsProse`.
4. Unificar `buildFullPlannerExamples` y `buildCompactPlannerExamples` bajo `packs/sports/*` con `build(density)`.
5. Beneficio esperado pero **no garantizado**: 15-25% menos tokens en `chat_action`. Si no se cumple, el refactor sigue siendo válido por el lado de mantenibilidad, pero se documenta el delta real.

Criterio de salida: snapshots de `chat_action` equivalentes o con delta justificado, `audit:prompt` no peor que baseline, 5 corridas reales de chat_action sin regresión de outcome.

### Fase 5 — Refactor mínimo de `chat_general` (1-2 días)

Bajo riesgo. Solo migrar las secciones que ya consume a la nueva estructura modular. `chat_general` ya está limitado por `finalizePromptBuildResult` así que el cambio es más estético que funcional.

Criterio de salida: snapshots equivalentes, `chat_general` sigue bajo target de tokens.

### Fase 6 — Futuro, sin compromiso

Cosas que el contrato único habilita pero que **no son parte de este refactor**:

- Migrar `chat_action` a JSON-only output cuando el normalizer y el provider lo soporten en paralelo (requiere coordinación con BETA_AUDIT roadmap).
- Generar `validateWeekCreatorResponse` desde el `ActionContract` para tener 3 fuentes en 1.
- Plan Builder podría adoptar la misma arquitectura — pero el constraint actual lo excluye (sección 10).

---

## 8. Métricas antes/después

Cada fase reporta estas métricas con números concretos. Si una métrica empeora sin justificación, la fase se revierte.

### 8.1 Métricas técnicas

- **Tokens por requestClass** (`npm run audit:prompt`): baseline guardado en Fase 0, delta por fase. Tolerancia ±10% sin justificación; >10% requiere nota explicativa en el commit.
- **LOC del builder principal** ([promptBuilder.ts](src/services/ai/promptBuilder.ts)): objetivo declarado al final del refactor: **< 800 líneas** (hoy 2570). Si quedan más, indica que la separación no funcionó.
- **Tiempo de construcción de prompt** (en `buildCoachSystemPrompt`): no debe empeorar. No es bottleneck pero medir igual.

### 8.2 Métricas de calidad de Week Creator (las que justifican el refactor)

Medidas con Beta Quality export local (`npm run e2e:dev:quality` o uso real con feedback):

- **Reducción de `actions_parse_failed`**: baseline = tasa actual en ~5 corridas reales pre-refactor; objetivo = menor tras Fase 2.
- **Reducción de `schema_invalid`** (incluyendo `missing_sport_details`, `low_density:strength:*` cuando vienen del modelo y no del repair): baseline = tasa actual; objetivo = menor tras Fase 2.
- **Reducción de fallback determinístico**: cuántas veces el `WeekCreatorEngine` cae a `buildDeterministicSessions()` tras 2 intentos fallidos. Hoy es la métrica que demuestra que el modelo "no entrega". Debe **bajar** post-refactor; si se mantiene igual, el refactor no resolvió el problema declarado.
- **Calidad deportiva subjetiva mantenida o mejorada en 5 corridas reales**: el dueño ejecuta 5 generaciones reales de Week Creator pre y post Fase 2 con configs equivalentes, y rankea calidad subjetiva (1-5 estrellas) por sesión squash/fuerza/running. La media post-refactor no puede ser peor que la pre.

### 8.3 Métricas de calidad de chat_action (Fase 4)

- Mismas tres métricas técnicas de outcome (`parse_invalid`, `schema_invalid`, repair rate) pero medidas sobre chat_action.
- Mismo criterio de 5 corridas reales con calidad subjetiva mantenida.

### 8.4 Lo que **no** medimos en este refactor

- Velocidad del modelo (latencia Gemini) — no es nuestra variable independiente.
- Costo en USD — Gemini Flash mantiene el costo bajo independiente del prompt (ver [OPTIMIZATION_AND_COSTS.md](OPTIMIZATION_AND_COSTS.md)). Este refactor no se justifica por costo.
- Tasa de aceptación de proposals — depende de demasiadas variables ajenas al prompt.

---

## 9. Riesgos y rollback

Ordenados por probabilidad × impacto.

| # | Riesgo | Probabilidad | Impacto | Mitigación / Rollback |
|---|---|---|---|---|
| 1 | **Sobrediseñar la arquitectura: introducir un framework de prompts más grande que el problema.** | media | alto | Los packs son módulos TypeScript simples, sin registry dinámico, sin template engine, sin DSL propia. Si una fase introduce más de 1 capa nueva, se rechaza. El orquestador debe quedar < 300 LOC. Si crece, indica que estamos modelando complejidad que no existe. |
| 2 | **Cambio invisible en el prompt que altera el comportamiento del modelo aunque los snapshots cambien poco.** | media | alto | 5 corridas reales con Gemini en cada fase, comparando outcome y calidad subjetiva. Si la métrica de outcome regresiona, la fase se revierte. |
| 3 | **Drift no detectado entre prose y JSON Schema durante el refactor.** | media | medio | Test de paridad de §6.3 corre en CI. Si falla, no se mergea. |
| 4 | **Bloquear iteración del coach: si el refactor dura semanas, el dueño pierde la capacidad de tocar prompts rápido.** | baja-media | alto | Fases pequeñas (1-3 días cada una). Cada una mergea o se revierte. Nunca hay una rama de 2 semanas sin tocar `main`. |
| 5 | **Crear duplicación nueva: terminar con la duplicación vieja Y la nueva arquitectura conviviendo.** | media | medio | Cada fase elimina lo que reemplaza. No se acepta una fase que solo agregue código nuevo sin borrar el viejo equivalente. |
| 6 | **Romper Plan Builder por movimiento de archivos compartidos** (`week/prompts/weekPrompt.ts` es re-exportado desde planBuilder). | baja | alto | Plan Builder no se toca en este refactor (constraint §10). Si la consolidación de la Fase 1 cambia la firma de `buildWeekSystemPrompt`, se mantiene un shim para Plan Builder hasta que se decida tocarlo en otro refactor. |
| 7 | **Snapshots demasiado frágiles: cualquier cambio cosmético hace fallar 20 tests.** | media | bajo | Snapshots a nivel de output completo del system prompt, no de cada subsección. Aceptamos que actualizar snapshots es parte del flujo de cada fase; lo importante es que el cambio sea **visible y aprobado**, no automáticamente verde. |
| 8 | **El piloto Week Creator no mueve las métricas declaradas (§8.2).** | media | medio | Si tras Fase 2 las métricas no mejoran y el código tampoco quedó más simple, se revierte. Las fases 3+ no se ejecutan. El refactor se cierra como "exploración fallida documentada". |
| 9 | **Tiempo del dueño consumido en 5 corridas reales por fase.** | alta | bajo | Es el costo real del refactor. Se asume explícitamente: ~30 min de QA real por fase × 5 fases = ~2.5 horas. |

### 9.1 Reglas firmes de rollback

- Una fase puede ser revertida con `git revert` sin tocar las anteriores ni las siguientes.
- Ninguna fase introduce una migración irreversible (renombres masivos, eliminación de archivos sin shim).
- Si una fase requiere más de 3 días de implementación efectiva, se divide en sub-fases antes de mergear.

### 9.2 Antipatrón explícito a evitar

**No construir el "framework de prompts perfecto".** El proyecto tiene un usuario, una beta cerrada que no superará 10 usuarios en su primera ronda, y un alcance deportivo acotado (squash + running + fuerza + cycling + mobility). Una arquitectura proporcional son **6 carpetas y un orquestador**, no un sistema de plantillas con herencia, mixins, ni runtime de composición. Cualquier propuesta que apunte en esa dirección durante la implementación debe ser rechazada en favor de "hard-coded modules + grep-able imports".

---

## 10. Qué NO tocar todavía

Lista explícita de límites del refactor. Tocar cualquiera de esto sale del scope y requiere otro plan separado.

- **No tocar el provider default ni el routing por requestClass.** Eso pertenece a [BETA_AUDIT_AND_PROVIDER_PLAN.md](BETA_AUDIT_AND_PROVIDER_PLAN.md) §4 y §6.
- **No tocar [responseNormalizer.ts](src/services/ai/responseNormalizer.ts).** Es el último resort cuando el modelo falla; cambiarlo en paralelo al refactor del prompt enmascararía qué causa qué.
- **No tocar [coachRecovery.ts](src/services/ai/coachRecovery.ts).** Mismo argumento.
- **No tocar sync, auth, monetización ni notificaciones.** Constraint del usuario.
- **No tocar Plan Builder más allá de la lectura.** Plan Builder usa `week/prompts/weekPrompt.ts` vía re-export; mientras la firma se mantenga, no se rompe. Si la Fase 1 lo necesita cambiar, se mantiene un shim hasta que un refactor futuro decida adoptar la nueva arquitectura.
- **No introducir un nuevo proveedor de IA.** Mantener Gemini Flash como default durante todo el refactor.
- **No consolidar `chat_general` antes de tener `chat_action` migrado.** El orden importa: chat_general es el más liviano y el último en migrarse precisamente porque tiene menos margen de error perceptible.
- **No introducir tipos zod/runtime validation libraries.** Si el contrato necesita validación runtime, se hace con código TS plano. Agregar dependencias en este refactor es expandir scope.
- **No introducir un template engine** (Handlebars, Mustache, Nunjucks). Las plantillas string actuales son suficientes y grep-eables.
- **No documentar la arquitectura en un wiki externo.** El código TypeScript + jsdoc + este documento son la documentación.

---

## 11. Cierre — criterios de éxito del refactor completo

El refactor entra a `main` (todas las fases mergeadas) cuando se cumplen **todos** estos criterios:

1. **Una sola fuente de verdad** para el contrato `create_week` en TypeScript.
2. **`SESSION_SCHEMA_BLOCK_*` y `WEEK_CREATOR_RESPONSE_SCHEMA` derivados** de esa fuente, no escritos a mano.
3. **`promptBuilder.ts` bajo 800 LOC** (hoy 2570).
4. **`buildWeekSystemPrompt*` reducidos** de 5 funciones a 1 parametrizada.
5. **Test de paridad schema ↔ prose verde** en CI.
6. **`audit:prompt` con assertions** que correrían en CI cada commit, no solo a mano.
7. **Snapshots de cada requestClass** estables y reviewable.
8. **Métricas de Week Creator** (`actions_parse_failed`, `schema_invalid`, fallback determinístico) **iguales o mejores** que el baseline pre-refactor en 5 corridas reales con Gemini.
9. **Calidad deportiva subjetiva mantenida o mejorada** en 5 corridas reales pre/post.
10. **Lint, test, build, e2e:dev, e2e:plan, audit:prompt en verde.**

Si después de la Fase 2 el piloto de Week Creator no consigue (8) o (9), el refactor se cierra como exploración fallida y se documenta. No se ejecutan fases siguientes solo porque la arquitectura "es más linda".

---

## Apéndice A — Decisiones intencionalmente dejadas abiertas

Cosas que no son parte de este estudio porque cada una merece su propio debate:

- **¿Migrar Plan Builder al mismo contrato único?** Análisis: probablemente sí, pero está fuera del scope por constraint del usuario. Decisión: posponer; abrir issue después de Fase 2 si las métricas justifican expandir.
- **¿Generar el validador runtime desde el contrato?** Análisis: técnicamente posible (zod, ajv, o code generation). Decisión: posponer hasta que las 3 fuentes (prosa, JSON Schema, validador imperativo) demuestren drift real en producción.
- **¿Consolidar también el contrato de `add_session` y `update_session` que hoy vive en chat_action?** Análisis: la Fase 4 lo hace de hecho. Decisión: confirmar en el momento, no antes.
- **¿Usar Gemini structured output también para chat_action?** Análisis: tentador pero arriesgado porque chat_action mezcla texto conversacional con acciones. Decisión: posponer; pertenece a BETA_AUDIT roadmap, no a este refactor.

---

## Apéndice B — Glosario corto

- **requestClass**: discriminator de tipo de petición al coach. Hoy: `chat_general`, `chat_action`, `weekly_summary`, `week_creator`, `plan_builder_week`, `plan_builder_pair`, `import_extract`.
- **OutputContract / ActionContract**: estructura TypeScript que describe una acción válida (nombre, campos, tipos, requeridos, ejemplos). Fuente única.
- **Renderer**: función pura que toma un `ActionContract` y devuelve prosa para prompt, JSON Schema para provider, o (futuro) validador runtime.
- **Density**: variante de tamaño de un pack. Hoy implícita en `Full` vs `Compact`; en el refactor se vuelve un parámetro explícito `'minimal' | 'full'`.
- **Pack**: módulo TypeScript con responsabilidad única (un deporte, una sección de datos, una regla de calidad). Importado explícitamente por el orquestador.
- **Snapshot test**: test que captura el output textual de una función. Falla cuando el output cambia, obliga a revisar y aprobar el cambio manualmente.
