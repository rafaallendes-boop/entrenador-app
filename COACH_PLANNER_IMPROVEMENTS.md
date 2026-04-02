# Coach Planner Improvements

Implementado: 2026-03-30
Limpiado: 2026-04-02

## 1. Problema original

El coach respondia como chatbot conversacional. Al pedir crear una semana o agregar una sesion, devolvia solo texto y no cambiaba nada en la app.

## 2. Causas

- `CoachActionType` no incluia acciones para crear sesiones
- el prompt estaba orientado a conversacion, no a planificacion
- el modelo no recibia siempre las fechas absolutas de la semana

## 3. Cambios aplicados

### Tipos

Se agregaron:

- `add_session`
- `create_week`
- `delete_session`

Tambien se agregaron estructuras para propuestas de sesion y campos extra en `CoachAction`.

### Prompt

Se reescribio el prompt para que el rol sea planner primero y advisor despues.

Ahora incluye:

- fechas absolutas de la semana
- reglas explicitas para usar `create_week`
- ejemplos concretos
- contexto para semana vacia

### Executor

En `useCoachActionsStore` se implementaron ejecutores para:

- `add_session`
- `create_week`
- `delete_session`

### UI

En `ChatCoach` y `ProposalDrawer` se mejoro:

- visualizacion de propuestas de semana
- feedback despues de aceptar
- etiquetas de acciones

## 4. Acciones soportadas

- `create_week`
- `add_session`
- `skip_session`
- `change_rpe`
- `shorten_session`
- `lengthen_session`
- `move_session`
- `replace_session_type`
- `insert_recovery`
- `delete_session`

## 5. Flujo objetivo

```text
Usuario pide crear semana
  -> prompt fuerza modo planner
  -> AI responde con create_week
  -> normalizer valida actions
  -> se crea proposal
  -> usuario acepta
  -> training store crea sesiones reales
```

## 6. Limitaciones historicas

Varias de estas ya se resolvieron despues:

- colisiones en `create_week`
- proposals persistidas
- navegacion a WeeklyView despues de aceptar
- mejor continuidad de chat

## 7. Valor del cambio

Este fue el paso que transformo al coach desde un chat informativo a un planner que realmente modifica el calendario.

