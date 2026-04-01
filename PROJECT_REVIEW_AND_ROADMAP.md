# Entrenador App - Review y Roadmap

Generado: 2026-04-01
Actualizado: 2026-04-01 (backup import hardening)
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

El estado real al 2026-04-01 es:

**MVP avanzado y utilizable**, con la mayor parte del roadmap historico ya implementado. El cuello de botella ya no es "crear features basicas", sino cerrar huecos de producto y operacion:

- sincronizacion entre dispositivos
- versionado y opciones avanzadas del restore
- robustez real de notificaciones
- pulido de docs y encoding
- control del peso del bundle de importacion PDF

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

### Observaciones relevantes del build

- El build pasa, pero el asset mas pesado sigue siendo `pdf.worker.min` (~1.24 MB).
- `ImportPDF` sigue siendo una pantalla cara (~418 kB gzip 125 kB).
- El core de la app esta bastante mas contenido que antes; el costo grande hoy esta concentrado en PDF.

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

El roadmap anterior mezclaba varios de estos items como si siguieran pendientes. Eso lo hacia menos confiable.

---

## 4. Prioridades reales desde hoy

### Ola 1 - Cerrar huecos operativos

#### P1. Restauracion de backups

La base ya existe y ya tiene validacion estructural fuerte por tabla, enums, fechas e IDs duplicados.

Impacto:
- alto

Motivo:
- la app sigue siendo local-first
- ahora ya hay recuperacion local confiable, pero todavia falta estrategia de versionado/migracion y opciones de importacion

Entrega minima:
- soportar versionado/migraciones de importacion
- considerar `replace` vs `merge` en futuras versiones
- opcionalmente mostrar preview antes de importar

#### P2. Notificaciones mas confiables

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

#### P3. Arreglar encoding y documentos base

Los docs base ya quedaron limpios, pero todavia conviene revisar archivos historicos secundarios.

Impacto:
- medio

Entrega minima:
- mantener README, roadmap y Settings sin mojibake
- revisar documentos historicos secundarios cuando toque limpiarlos

#### P4. Reducir peso del flujo PDF

La funcion existe y sirve, pero sigue siendo la zona mas pesada del bundle.

Entrega minima:
- aislar mejor `pdfjs-dist`
- cargar worker y pantalla PDF solo bajo demanda
- revisar si hay assets importados de mas

### Ola 2 - Consolidacion de producto

#### P5. Sync multi-dispositivo

Sigue siendo el mayor salto pendiente de producto.

Alcance minimo razonable:
- auth simple de un usuario
- sync de sesiones, day logs, summaries, chat y memoria
- estrategia de merge simple y explicita

Opciones candidatas:
- Supabase
- PocketBase

#### P6. Restore + export versionado

Si se hace restore, conviene cerrar el circuito completo:

- versionado del backup
- validacion estructural
- migraciones de importacion
- opcion merge o replace

#### P7. Mejoras de coaching con impacto real

No hace falta abrir mas features "vistosas" todavia. Conviene ir a mejoras que aumenten confianza y utilidad:

- mejores mensajes de colision/duplicado al crear semana
- explicaciones mas claras en propuestas complejas
- mas contexto deportivo en el prompt de resumen semanal
- herramientas para editar objetivos semanales desde UI

### Ola 3 - Expansiones mayores

#### P8. Modo torneo

Sigue siendo una buena expansion, pero todavia no debe competir con sync y restore.

Recomendacion:
- mantenerlo en backlog largo

#### P9. Analitica deportiva mas rica

Posibles extensiones:

- tendencia de carga
- comparacion plan vs real por disciplina
- vista de rivales y resultados por periodo
- correlacion simple entre sueno, peso, dolor y rendimiento

---

## 5. Backlog priorizado

| Item | Impacto | Esfuerzo | Estado |
|------|---------|----------|--------|
| Importar backup JSON | Alto | Medio | Hecho |
| Robustecer notificaciones | Alto | Medio | Parcial |
| Corregir encoding/docs base | Medio | Bajo | Parcial |
| Reducir peso de PDF import | Alto | Medio | Pendiente |
| Sync multi-dispositivo | Muy alto | Alto | Pendiente |
| Backup versionado + restore seguro | Alto | Medio | Parcial |
| Mejoras UX del coach planner | Medio | Bajo | Pendiente |
| Modo torneo | Alto | Alto | Backlog |
| Analitica deportiva avanzada | Medio | Medio | Backlog |

---

## 6. Riesgos actuales

### Persistencia solo local

Sin backend, los datos siguen atados al navegador/dispositivo actual.

Mitigacion actual:
- export JSON manual

Mitigacion faltante:
- sync
- versionado/migraciones de backup

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

### Documentacion desactualizada

README y documentos historicos todavia describen estados anteriores del producto.

---

## 7. Recomendacion de ejecucion

Orden sugerido para las proximas iteraciones:

1. versionado/migraciones de backup
2. robustez de notificaciones
3. limpieza de encoding secundaria
4. optimizacion del flujo PDF
5. diseno de sync multi-dispositivo

Ese orden mantiene foco en resiliencia y uso real antes de abrir una capa nueva de complejidad.

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
- `src/services/dataExport.ts`
