# Whoop → "Esfuerzo" prefill (mini spec)

**Fecha:** 2026-07-08
**Estado:** Aprobado (cambio acotado; implementación directa con TDD, sin plan largo)
**Contexto:** Extiende la integración Whoop ya implementada. El check-in diario tenía "RPE real"
(`dayLog.rpeActual`), que como campo diario resultaba confuso. Se reformula a **"Esfuerzo"** y se
autollena desde el **strain** de Whoop.

## Decisión

`dayLog.rpeActual` **se mantiene como storage** (sin migración; no se re-cablean los ~15 consumidores:
fatiga, progression, plan builder, weekly loop, export). Cambia el **significado de producto** y el
**label**: de "RPE real post sesión" a **"esfuerzo percibido / final del día (1-10)"**. Whoop lo
prefilла desde el strain del día, editable; al editarlo pasa a ser esfuerzo percibido del atleta.

## Alcance

1. **Tipo/comentario** (`src/types/index.ts`): recomentar `rpeActual` como "1-10 esfuerzo percibido/final
   del día (autollenable desde Whoop strain)". Extender `prefillSource` para incluir `rpeActual`.
2. **Prefill** (`prefillDayLog.ts`): si `rpeActual` está vacío y hay `strain`,
   `rpeActual = clamp(round(strain / 2.1), 1, 10)` (strain 0-21 → 1-10) y `prefillSource.rpeActual = 'whoop'`.
3. **Save/procedencia** (`dayLogPrefillSave.ts`): agregar `'rpeActual'` a `PrefillField` (editar limpia el
   tag; auto-persist hoy+self reusa el gate existente sin cambios).
4. **Coach sin doble conteo** (`promptBuilder.ts`): cuando `rpeActual` es `prefillSource:'whoop'`, NO
   mostrarlo como esfuerzo percibido en las líneas legibles del prompt (extiende `isWhoopPrefilled`, ya
   usado para energía/sueño). Relabel de copy "RPE real" → "Esfuerzo" en el prompt para el caso manual.
   Los agregados de fatiga (`rpeActual >= 8`) usan el valor final (ver Punto 5).
5. **Alertas de fatiga (v1):** usan el valor **final** aunque venga de Whoop. Un strain que mapea a 8-10
   es objetivamente un día cargado; si no calza con la percepción, editarlo corrige la señal. Si en uso
   real mete ruido, se agrega gate por procedencia después.
6. **UI**: `DailyCheckInCard` y `DayDetail` relabelan a **"Esfuerzo"** ("Esfuerzo del día" en DayDetail
   para no mezclar con `Session.actualRpe`). Mostrar hint "desde Whoop" cuando `prefillSource.rpeActual`,
   igual que sueño/energía. El control de edición pasa `editedPrefillFields: ['rpeActual']`.
7. **Completitud**: el auto-fill satisface el gate del check-in (`rpeActual != null`) para conectados;
   no-conectados lo ponen a mano. Sin cambios extra.

## No-goals

- **Peso corporal:** NO se mapea. El "peso" de Whoop es un valor estático de perfil (no medición diaria)
  y pide scope extra `read:body_measurement`. Sigue manual.
- **Dolor / molestia:** sigue manual (subjetivo, sin equivalente en Whoop).
- **`Session.actualRpe`** (RPE por sesión que alimenta ACWR/load) queda intacto — es otro campo.

## Escala

`clamp(round(strain / 2.1), 1, 10)`. Ej.: strain 15.3 → 7; 21 → 10; 8 → 4; 0 → 1.

## Tests (mínimos, TDD)

- `prefillDayLog` mapea `strain` → `rpeActual` y setea `prefillSource.rpeActual = 'whoop'`; no pisa un
  `rpeActual` ya presente (incl. 0).
- Editar `rpeActual` (`editedPrefillFields: ['rpeActual']`) limpia la procedencia en `buildDayLogSavePatch`.
- El prompt del coach no incluye la línea de esfuerzo cuando `rpeActual` viene de Whoop; sí la incluye
  (como "Esfuerzo") cuando es manual.
- Check-in queda completo (`weeklyActionLoop`/`actionAlerts`) con esfuerzo autollenado.
- Export/import preserva `prefillSource.rpeActual`.
