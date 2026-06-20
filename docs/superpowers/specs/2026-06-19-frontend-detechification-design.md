# De-tecnificar el frontend (app completa)

**Estado:** Diseño aprobado, pendiente de implementación.
**Fecha:** 2026-06-19
**Autor:** Rafael Allendes (colaboración con Claude)
**Stakeholder:** beta privada + posible venta de RallyIQ.

---

## Contexto y motivación

La app es usable y técnicamente sólida, pero expone internals de ingeniería a quien debería ver solo "tengo mi plan de entrenamiento". El usuario no debe enterarse de retries, fallbacks, reparaciones, scores de calidad, polling ni estado de sync. Hoy ve, por ejemplo, la pantalla de validación del Plan Builder con `73/100 Revisar`, `10 warnings`, `40 reparaciones`, `Estrategia: single`, `6/6 semanas listas` (capturada el 2026-06-19) — eso es debug interno filtrado a producción.

**Principio rector:** *el usuario quiere su plan, no la maquinaria.* Toda señal técnica se oculta; donde quede un hueco funcional, se reemplaza por una versión mínima y humana (enfoque B). El sync es ambiente/silencioso.

**Objetivo:** que en producción la app se sienta como producto de consumidor terminado, sin perder ninguna herramienta de debug para desarrollo (quedan tras un flag, prod-off).

**Métrica de éxito:** un usuario nuevo recorre onboarding → generar plan → aceptar → usar la semana → registrar sesión sin encontrar ni una sola palabra de jerga técnica (`retry`, `fallback`, `validación`, `reparaciones`, `sync`, `pendientes`, `provider`, `jobId`, `stalled`, score numérico de calidad).

**No-objetivos en este spec:**

- Mejorar la calidad real del generador (monotonía, periodización): es el Spec 2 (`2026-06-19-generator-quality-design.md`).
- Rediseño visual / branding / nuevas pantallas.
- Reescritura UX completa con copy nuevo amable por superficie (enfoque C). Acá solo ocultamos y ponemos fallback mínimo.

---

## Mecanismo: una sola fuente de verdad para debug

Hoy existe `src/services/ai/showPlanQualityFlag.ts` con `shouldShowPlanQuality()` (PROD→`false`, si no `VITE_SHOW_PLAN_QUALITY === 'true'`). El problema es doble:

1. Solo cubre Plan Builder quality.
2. Hay superficies que se filtran igual porque están gateadas por **estado del plan**, no por el flag (ej. `PlanBuilderV2Page.tsx:683-685`: `showPlanQualityDebug || generationState === 'complete' || 'partial'`).

**Decisión:** generalizar a un único helper de developer tools.

- Nuevo `src/services/devTools.ts` con `isDevToolsEnabled(): boolean` → `import.meta.env.PROD === true ? false : import.meta.env.VITE_DEV_TOOLS === 'true'`.
- `shouldShowPlanQuality()` se mantiene como alias delgado de `isDevToolsEnabled()` para no romper imports existentes (o se reescribe internamente para delegar). Conservar `VITE_SHOW_PLAN_QUALITY` como alias de entrada reconocido para no romper `.env.local`.
- **Regla:** ninguna superficie de debug puede gatearse por estado de datos. Solo por `isDevToolsEnabled()`.

Esto es de menor riesgo y reversible: en dev se ve todo igual que hoy; en prod desaparece.

---

## Inventario de superficies y tratamiento

### 1. Plan Builder (`src/pages/PlanBuilderV2Page.tsx`, `src/components/planBuilder/`)

| Elemento | Hoy | Después (prod) |
|---|---|---|
| Tarjeta "Validación" (score, `N warnings`, `N reparaciones`, `Estrategia`, `N/M semanas listas`) | Visible por estado del plan (`generationState === 'complete'`) | **Solo dev** (`isDevToolsEnabled()`) |
| Lista de warnings técnicos (`week.primary_sport.underweighted`, etc.) | Visible | **Solo dev** |
| Labels de semana: `"reintentando por validación"` (`:99`), `"generando"` (`:101`) | Visible | Copy de outcome: "Preparando…" / sin estado técnico |
| Botones `Regenerar semana`, `Reintentar pendientes` (`:1460`), `Regenerar fallidas` (`:1482`), `Reparar semanas marcadas` (`:1505`), `Regenerar plan` (`:1517`) | Visible por estado | **Solo dev** |
| Acción del usuario (Aceptar / Descartar plan, `:1440`) | Dentro de la tarjeta técnica | **Tarjeta limpia de consumidor**: "Tu plan está listo · N semanas · hasta tu evento" + Aceptar / Descartar |
| `PlanQualityBadge` (`PlanDashboard.tsx:582`) | Ya gateado con `shouldShowPlanQuality()` ✅ | Sin cambios (pasa a `isDevToolsEnabled()` vía alias) |

**Estado de generación visible al usuario:** mientras el plan se genera (incluyendo background), mostrar un único mensaje de progreso amable ("Preparando tu plan…", con barra/spinner) sin distinguir generando vs reintentando vs reparando. Si todo falla de forma no recuperable, un mensaje único: "No pudimos preparar tu plan ahora. Probá de nuevo en un momento." (sin códigos ni "fallback").

### 2. Sync (app-wide) — `src/components/sync/`, `src/pages/SettingsPage.tsx`

El sync pasa a **silencioso por defecto**. El usuario no ve "Sincronizando / pendientes / reintentar".

| Elemento | Hoy | Después (prod) |
|---|---|---|
| `SyncStatusBadge` (header/Settings): "Sincronizando", "Revisar sync", "N pendientes", "N pendientes offline", "Sin conexion", "Sincronizado" | Badge técnico siempre visible | **Sin badge técnico.** A lo sumo un microestado de confianza: nada cuando está OK; "Sin conexión — tus cambios se guardan en este dispositivo" solo cuando realmente está offline. |
| `SyncDiagnosticsPanel` (Settings `:659`): "Reintentar cola", "Cola vacía", "Quedaron pendientes; se reintentarán" | Visible en Settings | **Solo dev** (`isDevToolsEnabled()`) |
| Sección sync en Settings (`:544`, `:560-688`, `:1558-1585`): "problema de configuración en el servidor", "La conexión a la nube no está configurada", "Reintentar ahora", "Reintentando…", "Se reintentará automáticamente" | Visible | Reducir a estado mínimo de confianza para el usuario; los detalles técnicos (reintentar manual, contador de ops) van a dev. Mensajes de error de cuenta: 1 sola línea humana, sin jerga de servidor. |

**Garantía:** ocultar el badge NO debe cambiar el comportamiento de sync (sigue corriendo igual). Solo se oculta la *visualización* del estado.

### 3. Otras superficies

| Elemento | Hoy | Después (prod) |
|---|---|---|
| `WeeklyView.tsx:348`: "Generando…" / "Regenerar nota RallyIQ" | Texto técnico aceptable pero mejorable | "Preparando nota…" / "Actualizar nota". Sin "regenerar". |
| `SettingsPage` exports/import: `error.message` crudo (`:204,217,231,245,264,286,439,461`) | Muestra el mensaje de error técnico | Mensaje humano fijo por acción ("No se pudo exportar. Probá de nuevo."); el `error.message` real solo a consola/dev. |

### 4. Barrido de jerga (catch-all)

Pasada final sobre `src/pages/` y `src/components/` buscando strings visibles con: `retry`, `reintent`, `fallback`, `stalled`, `polling`, `jobId`, `provider`, `validación` (en contexto técnico), `reparacion`, `warning`, `sync`/`sincroniz` (en contexto técnico de estado). Cada hallazgo visible al usuario: ocultar tras flag o reemplazar por copy de outcome.

---

## Arquitectura del cambio

- **Una función nueva** (`isDevToolsEnabled`) + alias del flag viejo. Sin dependencias nuevas.
- Cambios son sobre todo **condicionales de render** y **strings**; no se toca lógica de sync, generación ni Dexie.
- `SyncStatusBadge` se simplifica a un componente que en prod devuelve `null` salvo el caso offline real; mantiene su API actual para no romper call sites.
- Tarjeta de aceptar plan: extraer un componente `PlanReadySummary` (consumidor) separado del bloque de debug, así el debug se puede envolver entero en `isDevToolsEnabled()`.

## Testing

- Test unitario de `isDevToolsEnabled()`: prod→false; dev sin flag→false; dev con flag→true.
- Tests de render con `import.meta.env.PROD` mockeado a `true`:
  - `PlanBuilderV2Page`/componente extraído: NO renderiza score, "warnings", "reparaciones", "Estrategia", ni botones de regeneración; SÍ renderiza Aceptar/Descartar.
  - `SyncStatusBadge`: en prod OK→`null`; offline→mensaje de confianza, sin "pendientes/reintentar".
  - `SyncDiagnosticsPanel`: no se monta en prod.
- Test de barrido (opcional, guardrailes): assert de que ciertos strings prohibidos no aparecen en el árbol renderizado de las pantallas clave en modo prod.
- `npm run lint && npm run build && npm test` verdes.

## Riesgos

- **Ocultar sync de más:** si el usuario nunca ve nada, podría no saber que sus datos están a salvo. Mitigación: microestado de confianza solo en el caso offline real; el resto silencioso (es lo esperado en apps de consumidor).
- **Olvidar una superficie:** mitigado por el barrido catch-all + test de strings prohibidos.
- **Romper call sites de `shouldShowPlanQuality`:** mitigado manteniéndolo como alias.

## Rollout

1. Mecanismo (`devTools.ts` + alias) y tests.
2. Plan Builder (mayor leak visible).
3. Sync silencioso.
4. Barrido catch-all + WeeklyView + Settings errors.
5. Verificación en build de prod (`import.meta.env.PROD`).
