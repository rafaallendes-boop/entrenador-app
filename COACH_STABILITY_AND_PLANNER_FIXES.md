# Coach Stability And Planner Fixes

Implementado: 2026-03-31
Limpiado: 2026-04-02

## 1. Objetivo

Endurecer el flujo del coach planner para evitar respuestas truncadas, acciones malformadas y perdida de datos utiles en propuestas complejas.

## 2. Problemas atacados

- bloques `<actions>` visibles en el chat
- respuestas truncadas
- contratos inconsistentes entre prompt, normalizer y executor
- perdida de detalles en sesiones running
- week objectives no persistidas
- chat multi-sesion con migracion incompleta

## 3. Cambios principales

### Normalizacion

`responseNormalizer.ts` se reforzo para:

- limpiar fences y markup tecnico
- detectar JSON roto o truncado
- evitar exponer basura tecnica en la UI

### Engine

`CoachEngine.ts` gano:

- retry silencioso cuando falla el parse estructurado
- metadatos de normalizacion
- mejor manejo de respuestas invalidas

### Tipos y contrato

Se alinearon:

- `update_session`
- ejercicios propuestos
- objetivos semanales
- running details completos
- `rpe` / `newRpe`

### Persistencia

Se reforzo:

- migracion a chat multi-sesion
- persistencia de proposals
- memoria del atleta
- coach note semanal

## 4. Resultado

El coach planner quedo mas estable y mucho menos propenso a:

- mostrar JSON tecnico al usuario
- crear semanas incompletas
- perder contexto reciente
- dejar historiales inaccesibles

## 5. Estado posterior

Despues de este documento se cerraron ademas:

- streaming
- import/export de backup
- notificaciones mas robustas
- limpieza de docs base

