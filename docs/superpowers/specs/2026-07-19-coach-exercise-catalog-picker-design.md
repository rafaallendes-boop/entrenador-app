# Coach Exercise Catalog Picker — Design

Fecha: 2026-07-19
Estado: aprobado en brainstorming, pendiente de plan de implementación

## Objetivo

Que el coach arme sesiones eligiendo ejercicios desde las librerías curadas que ya existen en la app (drills de squash y ejercicios de fuerza), en vez de tipear texto libre de memoria. La biblioteca es una herramienta del coach; la IA (Plan Builder) es apoyo, no reemplazo — este flujo no involucra IA.

Incluye además un fix de UX reportado: el editor del coach muestra campos de resultado de partido ("Games ganados/perdidos") que no corresponden a planificación.

## Alcance v1

- Deportes: **squash** (drillLibrary, ~90 drills) y **fuerza** (exerciseLibrary, ~79 ejercicios). Running/ciclismo/movilidad/recovery quedan fuera (son librerías de sesiones completas, no de ejercicios sueltos).
- Superficie: `SessionForm`, compartido por el editor del coach en Planificación (`CoachSessionModal`), la creación/edición de plantillas (`CoachLibraryPanel`) y el modal del atleta (`AddSessionModal`). Sin gating: es data estática local.
- Sin migraciones Dexie ni Supabase.

Explícitamente fuera de alcance (diferido):
- Edición rica de la estructura de bloques/warmup/cooldown de sesiones de squash generadas por Plan Builder.
- Que el Plan Builder o el coach IA lean `libraryRef` (v1 lo estampa como metadata pasiva).
- Catálogo navegable en la tab Biblioteca del workspace.

## Sección 1 — Catálogo unificado (`coachExerciseCatalog`)

Nuevo servicio de solo lectura `src/services/training/coachExerciseCatalog.ts`:

```ts
interface CatalogEntry {
  libraryId: string          // id original en su librería
  source: 'squash_drill' | 'strength_exercise'
  sport: 'squash' | 'strength'
  name: string
  category: string           // etiqueta legible: "Técnico", "Tren inferior", etc.
  intensity: 'low' | 'moderate' | 'high'
  description: string
  searchText: string         // nombre + aliases + tags, lowercase y sin tildes
  defaults: { sets?: number; reps?: string; notes?: string }
}
```

Mapeo:
- **Squash** (`SQUASH_DRILL_LIBRARY`): `defaults.notes` lleva la descripción del drill; sets/reps usan los defaults actuales del formulario (3×10, editables). No se inventa estructura nueva para drills.
- **Fuerza** (`STRENGTH_EXERCISE_LIBRARY`): defaults por `intensityType` — strength 4×5, hypertrophy 3×10, power 4×3, stability/recovery 3×8. Siempre editables.
- `intensity` de fuerza se deriva de `intensityType` (strength/power → high, hypertrophy → moderate, stability/recovery → low).

API:
- `getCatalogForSport(sport: SessionType): CatalogEntry[]`
- `searchCatalog(sport: SessionType, query: string): CatalogEntry[]` — matching sobre `searchText`, incluye aliases de fuerza.

Visibilidad por deporte de la sesión:
- Sesión de squash → drills de squash + ejercicios de fuerza (el accesorio de fuerza es común en sesiones de squash).
- Sesión de fuerza → solo ejercicios de fuerza.
- Otros deportes → sin picker (texto libre como hoy).

Etiquetas de categoría: mapas explícitos definidos en el catálogo — squash: technical "Técnico", tactical "Táctico", physical "Físico", match "Partido"; fuerza: lower "Tren inferior", upper "Tren superior", core "Core", full_body "Cuerpo completo".

### Dónde viven los ejercicios de squash

Hoy `SessionForm` solo permite ejercicios en fuerza/movilidad (`showExercises`, `SessionForm.tsx`), los borra al cambiar a otro tipo (`handleTypeChange`), el serializer solo los materializa para esos tipos (`EXERCISE_TYPES` en `coachSessionSerializer.ts`) y `SessionCard` no los muestra en squash. Contrato v1:

- Las selecciones del picker — drills y accesorios — se guardan en `Session.exercises`.
- `squashDetails.drills/blocks` (estructura rica del Plan Builder) permanece **opaco e intacto**: el editor no lo toca.
- **Squash se agrega a los tipos con ejercicios editables** en `SessionForm` (`showExercises`), en el serializer (`EXERCISE_TYPES`) y en plantillas.
- `SessionCard` muestra también `exercises` en sesiones de squash.
- Cambio de tipo: entre squash/fuerza/movilidad las filas de ejercicios **se conservan**; al cambiar a un tipo sin ejercicios se descartan, conforme al contrato actual.

## Sección 2 — UX del picker

Dos entradas al mismo catálogo, ambas dentro de `SessionForm`:

**a) Typeahead en el campo nombre del ejercicio**
- Con 2+ caracteres aparece un dropdown con hasta 6 sugerencias filtradas por deporte, cada una con nombre + badge de origen ("Drill squash" / "Fuerza") + categoría.
- Al seleccionar: completa el nombre y prellena sets/reps/notas según flags internos `touched` por campo (estado de UI, no se persiste):
  - Una fila nueva (3×10 sin tocar) recibe los defaults del catálogo.
  - Cambiar de una entrada de catálogo a otra actualiza los campos nunca editados manualmente.
  - Un campo tocado manualmente **nunca** se pisa, aunque su valor coincida con el default.
- Teclado completo (flechas, Enter, Escape), patrón ARIA combobox.
- El texto libre sigue funcionando igual que hoy; el dropdown es sugerencia, no obligación.

**b) Explorador "Agregar desde biblioteca"**
- Botón nuevo junto a "Agregar ejercicio" en la sección de ejercicios.
- Panel (modal en desktop, sheet a pantalla completa en mobile) con búsqueda, chips de filtro (origen drill/fuerza cuando la sesión es de squash, categoría, intensidad) y lista de entradas: nombre, categoría, intensidad, descripción recortada a 2 líneas.
- "Agregar" apila una fila de ejercicio prellenada **sin cerrar el panel**, con feedback "Agregado ✓" **transitorio** (no bloquea: la misma entrada puede agregarse varias veces). Cerrar devuelve al formulario con las filas listas.

## Sección 3 — `libraryRef` + fix del bloque de partido

**Referencia a biblioteca**
- Tipo compartido nuevo:
  ```ts
  export interface ExerciseLibraryRef {
    source: 'squash_drill' | 'strength_exercise'
    id: string
  }
  ```
  Los ejercicios (en `Session`, `CoachSessionDraft` y `SessionTemplateExercise`) ganan `libraryRef?: ExerciseLibraryRef`.
- Se estampa al seleccionar desde typeahead o explorador. Metadata pasiva en v1; semilla para convergencia futura con Plan Builder.
- **Invalidación:** editar el *nombre* del ejercicio después de elegir borra la referencia. Editar sets/reps/peso/notas la conserva.
- Viaja dentro del JSON de la sesión: sin migraciones Dexie/Supabase, y **sync** lo conserva (el objeto viaja entero).
- **Backup/import NO lo lleva gratis:** el importador reconstruye cada ejercicio con una allowlist campo a campo (`optionalExercises` y pares en `dataExport.ts`) que hoy lo descartaría. Se actualiza esa allowlist y se valida `source` (uno de los dos literales) e `id` (string no vacío) en los límites de importación y de plantillas; un `libraryRef` inválido se descarta sin invalidar el ejercicio. Test de round-trip export→import obligatorio.
- Plomería adicional: `coachSessionSerializer` lo pasa por draft/patch; el payload allowlisted de plantillas lo agrega para que sobreviva guardar/aplicar (los UUIDs de ejercicios se regeneran al aplicar, como hoy; `libraryRef` se copia).

**Fix del bloque de partido**
- `SessionForm` gana prop `allowMatchResult` (default `true` → comportamiento actual del atleta intacto en `AddSessionModal`, donde registrar un partido jugado es válido).
- `CoachSessionModal` pasa `false`: se ocultan **resultado (Gané/Perdí) y games ganados/perdidos**. **Rival se mantiene visible** en el editor de sesión del coach (planificar contra un rival conocido es información de planificación).
- **Plantillas: contrato actual intacto.** El modo plantilla sigue ocultando el bloque de partido completo, **incluido Rival**, y `SessionTemplatePayload` sigue excluyendo `opponent` (una plantilla es reutilizable entre atletas/días; un rival concreto es dato de la instancia, no de la plantilla). `matchResult`/`gamesWon`/`gamesLost` siguen excluidos. El test existente que exige Rival oculto en plantillas no cambia.
- **La serialización depende del subtipo y del estado, no de la visibilidad:** los campos de partido se materializan cuando la sesión es match/competitive, siempre desde el estado del formulario — que se siembra de `initialValues`, así ocultar no borra un resultado existente. `allowMatchResult` afecta solo el render. Cambiar el subtipo fuera de partido limpia el resultado y volver a partido no lo resucita.

## Sección 4 — Testing y casos borde

Tests nuevos:
- `coachExerciseCatalog.test.ts`: mapeo drill/ejercicio → entry, defaults por `intensityType`, búsqueda insensible a tildes/mayúsculas, aliases, filtro por deporte, mapas de etiquetas de categoría.
- **Ejercicios en squash (end-to-end del contrato nuevo):** guardar un drill como ejercicio en una sesión de squash, reabrirla en el editor y verlo; verlo también en `SessionCard`; y comprobar que `squashDetails.drills/blocks` de una sesión del Plan Builder sobrevive intacto a una edición del coach.
- Cambio de tipo: squash↔fuerza↔movilidad conserva filas; cambiar a running/recovery las descarta (contrato actual).
- `SessionForm` typeahead: sugerencias desde 2 caracteres, semántica `touched` (fila nueva recibe defaults; cambiar de entrada actualiza solo campos no tocados; campo tocado nunca se pisa), estampado de `libraryRef`, borrado del ref al editar el nombre, navegación por teclado, texto libre intacto.
- `SessionForm` explorador: abrir/cerrar, filtros, agregados múltiples sin cerrar el panel, feedback transitorio no bloqueante.
- `allowMatchResult`: resultado oculto en `CoachSessionModal` con Rival visible; plantillas mantienen todo el bloque oculto (test existente intacto); atleta sin cambios; round-trip de valores de resultado existentes al guardar con el bloque oculto; serialización de campos de partido condicionada al subtipo match/competitive.
- Serializer/plantillas: `libraryRef` sobrevive draft→session→draft y guardar/aplicar plantilla con regeneración de UUIDs; validación de `source`/`id` en el límite de plantillas descarta refs inválidos sin perder el ejercicio.
- **Backup/import:** round-trip export→import conserva `libraryRef`; un ref con `source` desconocido o `id` vacío se descarta y el ejercicio importa igual.

Casos borde resueltos por diseño:
- Cambiar el deporte tras agregar ejercicios: entre squash/fuerza/movilidad las filas se conservan; al pasar a un tipo sin ejercicios se descartan. El picker cambia o desaparece según el tipo. `libraryRef` es inerte.
- Mismo drill dos veces: permitido, sin dedupe.
- Catálogo ~170 entradas estáticas: sin virtualización; typeahead cap 6.
- Todo local: sin estados de red/error nuevos.

Regresión: suites existentes de `SessionForm`, `CoachSessionModal`, `CoachLibraryPanel` y serializer siguen verdes. Gate final: `npm run lint && npm test && npm run build`.
