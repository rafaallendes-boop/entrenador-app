# Revisión de 411556a y 7bcfc38; avance de Entrega 2

Revisión local del 2026-09-09. No se consultó ni modificó producción.

## Hallazgos

- **P1 — revocación diferida sin suscripción al rol (7bcfc38).**
  `enforceCoachScopeGuard` devuelve temprano con `unknown`, pero
  `CoachScopeGuard` sólo dependía de usuario y atleta activo. Si ambos se
  mantienen al confirmar el rol, el efecto no vuelve a evaluar la revocación.
  Corregido: suscripción reactiva al rol y prueba del componente manteniendo
  idénticos usuario y atleta entre `unknown` y `athlete`.
- **P1 — transferencia por membresía todavía incompatible con el cliente.**
  Preexistente, bloquea la Entrega 2: `listOwnedAthletes` y
  `listArchivedAthletes` filtran por propietario; `switchActiveAthlete`,
  `assertRosterAthlete` en `coachScopedReads` y la revalidación transaccional de
  `coachScopedWrites` también exigen propietario. El nuevo coach no podrá ver,
  seleccionar ni gestionar el atleta transferido sólo por membresía. Debe
  resolverse antes de transferir y sin reparentar `owner_account_id`.
- **P2 — ciclo del roster presupone self.** Preexistente:
  `CoachWorkspacePage.withRosterAction` necesita volver a self antes de archivar
  o borrar al atleta activo. `CoachContextBar` exige self no nulo para mostrar
  el contexto gestionado. Una cuenta coach pura no cumple esas condiciones.
  Pendiente junto con el ciclo de selección por membresía.
- **P2 — onboarding global exige perfil deportivo al coach.** Preexistente:
  el guard global no distinguía el producto y `/onboarding` podía montar el
  formulario antes de hidratar identidad. Corregido para el primer ingreso de
  una cuenta ya provisionada con rol coach.

En las modificaciones de dosis, importación y formato de `411556a` no se
identificaron nuevos defectos reproducibles durante esta revisión. Esto no
sustituye el smoke remoto ni valida las evidencias SQL contra producción.

## Implementado localmente

- Guard de onboarding extraído y probado como componente: espera la identidad
  de la cuenta actual, envía coach sin atleta activo a `/coach`, permite páginas
  de cuenta y conserva el onboarding del atleta gestionado seleccionado.
- El Workspace queda fuera del onboarding deportivo, incluso cuando el atleta
  seleccionado aún no tiene perfil. Las cuentas atleta conservan su onboarding.
- `/coach` usa un shell propio con configuración y cierre de sesión. Las vistas
  deportivas del gestionado siguen en sus rutas actuales; no se declara completa
  la migración de todas las vistas a `/coach/*`.
- Se mantiene el puente de allowlist y el modo audit.

## Próxima implementación y operación

El owner confirmó que hoy es el único coach y quiere poder incorporar más
en el futuro. Para este avance se mantiene alta administrativa antes del primer
login, Workspace como entrada y cuentas separadas para quien ya tenga self.
El alta debe ser repetible por cuenta; no se introduce una identidad de coach
única ni una nueva allowlist. Registro público e invitaciones quedan para una
entrega posterior.
No se implementó registro público ni conversión de una cuenta existente.

1. Unificar elegibilidad local por membresía coach para roster, selección,
   lecturas, escrituras y su revalidación transaccional. Probar propietario
   distinto, revocación, self ajeno y estados archivados.
2. Resolver selección `none` al archivar/borrar sin self; adaptar la barra de
   contexto. Revisar alta managed: hoy escribe localmente y encola, mientras el
   contrato definitivo exige el camino administrativo de 030.
3. Provisionar la identidad concreta del nuevo coach antes de su primer ingreso;
   verificar rol y ausencia de self. No convertir la cuenta híbrida existente.
4. Transferir la membresía del gestionado y probar login, roster, selección,
   planificación, persistencia y reingreso con esa cuenta.
5. Completar rutas deportivas propias, retirar allowlist tras el smoke y evaluar
   `enforce` sólo con sus precondiciones.

Las tres filas del smoke anterior siguen pendientes: esta revisión no intentó
su DELETE ni ejecutó el SQL del documento de smoke.

## Verificación

- Suite completa: **5061/5061**, 590 archivos (13 pruebas nuevas).
- `npm run lint`, `npm run build` (incluye `tsc -b`) y `git diff --check`: OK.
- Pruebas nuevas verifican transiciones reactivas, aislamiento de identidad al
  cambiar de cuenta, entrada directa a onboarding y conservación del flujo de
  atleta/gestionado. No hubo smoke con una cuenta coach real ni deploy.
