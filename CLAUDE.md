# Entrenador App — CLAUDE.md

## Proyecto
App web personal de entrenamiento para squash, running y fuerza.
Stack: React + TypeScript + Vite + Tailwind + Dexie (local-first) + Supabase (sync) + Google OAuth.
Deploy en Netlify. El usuario principal es Rafael Allende (squash competitivo, masters).

## Comandos clave
- Dev: `./start.sh` o `npm run dev`
- Lint: `npm run lint`
- Build: `npm run build`
- Antes de commitear: `npm run lint && npm run build`

## Arquitectura
- `src/pages/` — vistas principales
- `src/services/` — lógica de negocio (AI, sync, notificaciones, PDF, export)
- `src/store/` — estado global con Zustand
- `src/types/` — tipos compartidos
- `src/utils/` — helpers
- `src/services/ai/promptBuilder.ts` — prompt del coach IA (tocar con cuidado)
- `public/sw.js` — service worker para notificaciones

## Estado actual del producto
Ver `PROJECT_REVIEW_AND_ROADMAP.md` para el estado completo.
Resumen: producto usable, lint OK, build OK.
El chunk más pesado es `pdf.worker.min` — ya optimizado, no tocar sin razón.

## Prioridades abiertas (en orden)
1. Robustez de notificaciones (scheduling persistente por navegador)
2. Explotar athlete profile en propuestas de fuerza y running
3. Personalización real por usuario (desacoplar defaults de "Rafael")
4. Nutrición más robusta integrada al coach
5. Merge conflict-aware en backup

## Reglas del proyecto
- No modificar `promptBuilder.ts` sin revisar el contexto completo del coach
- El modelo de datos local es Dexie — cualquier cambio de schema requiere migración
- Sync con Supabase ya está implementado — no duplicar lógica de sync
- No agregar dependencias pesadas sin revisar el impacto en el bundle
- Las notificaciones web tienen límites reales por navegador — documentar antes de cambiar

## Referencias clave
@./PROJECT_REVIEW_AND_ROADMAP.md
