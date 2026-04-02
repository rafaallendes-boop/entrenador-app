# Entrenador App - Review y Roadmap

Generado: 2026-04-01
Actualizado: 2026-04-02 (sync multi-dispositivo en produccion — COMPLETO)
Base de revision: codigo del repo + `npm run lint` + `npm run build`

---

## 1. Resumen ejecutivo

Entrenador ya no esta en fase de idea ni de prototipo basico. Hoy es una PWA funcional para planificacion y seguimiento deportivo con:

- plan semanal y vista diaria
- coach AI con propuestas ejecutables
- chat multi-sesion con streaming
- persistencia local en Dexie
- backup JSON
- importacion de PDFs
- resumenes semanales y memoria persistente del coach
- notificaciones basicas de sesiones

El estado real al 2026-04-02 es:

**MVP avanzado y utilizable**, con la mayor parte del roadmap historico ya implementado. El cuello de botella ya no es "crear features basicas", sino cerrar huecos de producto y operacion:

- ~~sincronizacion entre dispositivos~~ → **COMPLETO Y EN PRODUCCION** (Supabase + Google OAuth)
- versionado y opciones avanzadas del restore
- robustez real de notificaciones
- control del peso del bundle de importacion PDF
- ~~reload de stores post-sync~~ → resuelto

---

## 2. Estado verificado hoy

### Salud tecnica

- `npm run lint`: OK
- `npm run build`: OK
- Build de produccion generado correctamente con Vite 8

### Estado del producto

Implementado y visible en codigo:

- coach planner con `create_week`, `add_session`, `update_session`, `delete_session`
- proposals persistidas en Dexie
- chat multi-sesion
- streaming de respuesta del coach
- memoria persistente del atleta/coach
- resumen semanal generado por AI
- historial de partidos de squash
- `actualRpe` por sesion
- `bodyWeight` en check-in diario y metricas semanales
- Settings con export, memoria, permisos de notificaciones y limpieza local
- importacion PDF con `pdfjs-dist` y extraccion asistida por AI
- provider proxy para produccion via Netlify
- lazy loading y code splitting inicial

### Nuevos archivos (2026-04-02, sync multi-dispositivo)

- `src/services/auth.ts` — cliente Supabase singleton (lee env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`)
- `src/services/syncService.ts` — capa completa de sync: push/pull/offline queue para 6 tablas
- `src/store/useAuthStore.ts` — estado de auth (user, syncStatus, signInWithGoogle, signOut)
- `src/components/auth/AuthGate.tsx` + `LoginScreen.tsx` — Google OAuth flow
- `MULTI_DEVICE_SYNC_FOR_NETLIFY_APP.md` — documento de arquitectura completo con SQL

### Observaciones relevantes del build

- `npm run build`: OK (0 errores TypeScript)
- Asset mas pesado: `pdf.worker.min` (~1.24 MB). Sin cambios.
- `ImportPDF` sigue siendo la pantalla mas cara (~418 kB gzip 125 kB).
- El core de la app se mantiene contenido; la deuda de bundle esta concentrada en PDF.
- Warning de dynamic import de `db.ts`: preexistente, no introducido por sync.

---

## 3. Lo que ya no deberia seguir en "roadmap"

Estos frentes ya deben considerarse cerrados salvo bugs puntuales:

- coach planner base
- proposals persistidas
- chat multi-turno reciente
- streaming
- historial de partidos
- resumen semanal AI
- memoria del coach
- Settings minima
- export JSON
- notificaciones basicas
- PDF import v1.1 y v2 asistido por AI
- `weekLoaded` para evitar el flicker obvio de semana vacia
- **sync multi-dispositivo** — codigo completo (Supabase + Google OAuth + push/pull/offline queue)

El roadmap anterior mezclaba varios de estos items como si siguieran pendientes. Eso lo hacia menos confiable.

---

## 4. Prioridades reales desde hoy

### ~~Ola 1 - Cerrar huecos del sync implementado~~ → COMPLETADO (2026-04-02)

#### ~~P1. Setup infraestructura Supabase~~ → HECHO

- Proyecto Supabase creado
- Google OAuth habilitado y vinculado a Google Cloud Console
- 6 tablas + 24 politicas RLS ejecutadas en Supabase SQL Editor
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` agregadas en Netlify Dashboard
- Deploy produccion exitoso y verificado

#### ~~P2. Reload de stores tras pullAll~~ → HECHO

`pullAll()` en `App.tsx` llama `loadWeek()` y `loadAllSummaries()` al completar.

#### P3. Notificaciones mas confiables

La implementacion actual agenda `setTimeout` dentro del service worker usando horarios fijos por `AM` y `PM`.

Riesgos actuales:
- si el worker se reinicia, los timers no sobreviven
- no hay hora real por sesion, solo bloque AM/PM
- no hay reprogramacion al reabrir al dia siguiente salvo paso por Dashboard

Entrega minima:
- reprogramacion robusta al abrir la app
- timestamps por sesion cuando existan
- fallback claro cuando solo haya `timeBlock`
- documentar limitaciones por navegador/PWA

#### P4. Reducir peso del flujo PDF

La funcion existe y sirve, pero sigue siendo la zona mas pesada del bundle.

Entrega minima:
- aislar mejor `pdfjs-dist`
- cargar worker y pantalla PDF solo bajo demanda
- revisar si hay assets importados de mas

### Ola 2 - Consolidacion de producto

#### ~~P5. Sync multi-dispositivo~~ → COMPLETO Y EN PRODUCCION (2026-04-02)

Implementado con Supabase. Infraestructura activa. Verificado en produccion.

#### P5. Indicador de sync en navegacion principal

Hoy el sync status (`idle | syncing | error | offline`) solo se muestra en la pagina de Settings.

Mejora util: un pequeno icono de nube en el `AppShell`/`BottomNav` para que el usuario vea el estado sin ir a Settings.

Impacto: bajo-medio
Esfuerzo: bajo (el `SyncStatusBadge` ya existe, solo moverlo)

#### P6. Restauracion de backups versionada

Si se hace restore desde un backup JSON antiguo, hoy no hay migracion ni merge — se reemplaza todo.

Mejora minima:
- mostrar preview de conteos antes de importar
- considerar opcion `merge` vs `replace`
- versionado del schema del backup para futuras migraciones

#### P7. Mejoras de coaching con impacto real

No hace falta abrir mas features "vistosas". Conviene ir a mejoras que aumenten confianza y utilidad:

- mejores mensajes de colision/duplicado al crear semana
- explicaciones mas claras en propuestas complejas
- mas contexto deportivo en el prompt de resumen semanal
- editar objetivos semanales desde UI (hoy solo los genera el coach)

### Ola 3 - Expansiones mayores

#### P8. Real-time sync entre dispositivos

El sync actual es pull-on-load. Si dos dispositivos estan abiertos simultaneamente, los cambios de uno no aparecen en el otro hasta recargar.

Mejora: `supabase.channel().on('postgres_changes', ...)` para listeners en tiempo real.

Cuando aplica: solo si hay uso simultaneo activo en multiples dispositivos.

#### P9. Modo torneo

Sigue siendo una buena expansion, pero no debe competir con las prioridades operativas.

Recomendacion: mantenerlo en backlog largo.

#### P10. Analitica deportiva mas rica

Posibles extensiones:
- tendencia de carga semana a semana
- comparacion plan vs real por disciplina
- vista de rivales y resultados por periodo
- correlacion simple entre sueno, peso, dolor y rendimiento

---

## 5. Backlog priorizado

| Item | Impacto | Esfuerzo | Estado |
|------|---------|----------|--------|
| Importar backup JSON | Alto | Medio | Hecho |
| Sync multi-dispositivo completo | Muy alto | Alto | **Hecho (prod)** |
| Indicador sync en nav principal | Bajo | Bajo | Pendiente |
| Robustecer notificaciones | Alto | Medio | Parcial |
| Reducir peso de PDF import | Alto | Medio | Pendiente |
| Backup versionado + restore seguro | Alto | Medio | Parcial |
| Mejoras UX del coach planner | Medio | Bajo | Pendiente |
| Real-time sync entre dispositivos | Medio | Medio | Backlog |
| Modo torneo | Alto | Alto | Backlog |
| Analitica deportiva avanzada | Medio | Medio | Backlog |

---

## 6. Riesgos actuales

### ~~Sync sin stores recargados~~ → RESUELTO (2026-04-02)

`pullAll()` ahora llama `loadWeek()` y `loadAllSummaries()` al completar, desde `App.tsx`.

### ~~Sync activo solo con infraestructura configurada~~ → RESUELTO (2026-04-02)

Infraestructura Supabase activa en produccion. Sync verificado.

### Notificaciones no realmente persistentes

La app ya muestra el feature, pero la estrategia actual depende de timers en memoria del service worker.

Esto es util como base, no como implementacion final totalmente fiable.

### Peso del modulo PDF

La importacion PDF aporta valor, pero hoy es la parte mas costosa del build.

### Dependencia del provider AI real para ciertas funciones

Funciones como extraccion AI de PDF o resumenes semanales dependen de provider real correctamente configurado.

Mitigacion actual:
- fallback parcial en PDF
- modo demo/mock para no romper la UX base

---

## 7. Recomendacion de ejecucion

Sync completo y en produccion. Proximas iteraciones:

1. **Robustez de notificaciones** (P3) — mejora de fiabilidad para uso diario
2. **Optimizacion del flujo PDF** (P4) — reduce el costo del bundle
3. **Indicador sync en nav** (P5) — UX feedback del estado de sync
4. **Mejoras de coaching** (P7) — calidad del producto existente

---

## 8. Referencias de codigo revisadas

- `src/store/useCoachActionsStore.ts`
- `src/store/useChatStore.ts`
- `src/store/useTrainingStore.ts`
- `src/pages/WeeklyView.tsx`
- `src/pages/History.tsx`
- `src/pages/SettingsPage.tsx`
- `src/services/pdfImport.ts`
- `src/services/notifications.ts`
- `public/sw.js`
- `src/db/db.ts`
- `src/db/queries.ts`
- `src/services/dataExport.ts`
- `src/services/auth.ts` (nuevo)
- `src/services/syncService.ts` (nuevo)
- `src/store/useAuthStore.ts` (nuevo)
- `src/components/auth/AuthGate.tsx` (nuevo)
- `src/App.tsx`
