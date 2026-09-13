# Coach Entrega 2 — revisión e implementación local

Fecha: 2026-09-12. Rama: `codex/coach-entrega-2`.
Plan: [2026-09-12-coach-role-separation-entrega-2.md](../superpowers/plans/2026-09-12-coach-role-separation-entrega-2.md).

## Resultado

Implementadas las Tasks 1–6, 7 y 7b. Runbook de Task 8 escrito y documentación
de Task 10 actualizada. Task 9 pendiente del smoke real aprobado. La entrega queda en un commit separado, sin deploys ni cambios en producción;
se conservaron los cambios previos y concurrentes del workspace.

- Roster, switch, hidratación y operaciones scoped usan elegibilidad por
  membresía. El coach confirmado no adopta self residual.
- Dexie v21 persiste `membershipSnapshots` en la misma transacción que las
  membresías. Una revocación total no vuelve al fallback por owner y un fallo
  de localStorage no cambia esa decisión. El marcador se limpia con la cuenta,
  no con la purga de un atleta.
- Las escrituras scoped revalidan membresía y estado dentro de la transacción.
  Se probó una revocación entre la validación previa y la entrada a esa transacción.
- El alta local de managed escribe atleta y membresía atómicamente. Un vínculo
  `pendingCreation` permanece durante el pull previo al replay offline; la
  confirmación del INSERT o un snapshot remoto lo convierte en definitivo,
  permitiendo que una revocación posterior lo elimine.
- Sync no fabrica self para coach, no reinserta padres ajenos y comparte UPDATE
  entre envío directo, replay y preparación de padres propios. Los tres
  DELETE comparten la operación por ID: visible no borrable es `denied`;
  ausente/invisible es `gone`, incluido el reintento de un DELETE ya aplicado.
- UI admite roster sin self y salida a `none` al archivar/eliminar el activo.
- `037` provisiona el rol y transfiere membresías sin modificar owner/linked.
  Serializa provisión con inserts y transferencias sobre la misma identidad.
- El runbook ya no propone eliminar una cuenta tras inspeccionar sólo su self:
  la cascada puede alcanzar otros atletas, incluso transferidos. Requiere una
  identidad nueva y agrega un DELETE real sobre un transferido desechable.

## Verificación

- **725 tests dirigidos aprobados en 79 archivos**, tras el último cambio de
  código: servicios athlete/sync, manifest y upgrade Dexie, componentes coach,
  guards, harness de sync y contratos SQL.
- **18 pruebas SQL de comportamiento/RLS**, incluidas en ese total, con
  PGlite **0.5.8**. El fixture usa las funciones y policies reales de
  007/013b/031: upsert ajeno rechazado, UPDATE y DELETE por membresía,
  revocación efectiva, veto de self, atomicidad y ejecución bajo roles reales
  (`anon`, `authenticated`, `service_role`). No sustituye un dump ni el smoke
  de producción; no se simularon conexiones SQL concurrentes.
- `npm run lint`: aprobado.
- `npm run build`: aprobado, incluido TypeScript.
- `git diff --check`: aprobado.
- Última suite global: **5332 aprobados, 1 fallido y 4 omitidos** en un
  workspace con cambios concurrentes ajenos a esta entrega. El fallo es
  `scripts/audit-prompt-tokens.test.ts`: `chat_general` calcula 730 tokens y
  supera el techo de 619 de su baseline. Se reprodujo también aisladamente.
  No se modificó la auditoría ni se relajó su umbral. Por ello el gate global
  completo no se declara verde.

## Pendiente operativo

Aplicar manualmente `037`, desplegar el cliente y ejecutar el
[runbook](../superpowers/smokes/2026-09-12-coach-entrega-2-runbook.md) con perfiles
separados, antes de transferir el gestionado real. Sólo tras smoke APROBADO
se ejecuta la Task 9 y se retira `VITE_COACH_ACCOUNTS`. `enforce` conserva su
ventana de auditoría y smoke independientes. Alta administrativa definitiva
y rutas deportivas `/coach/*` quedan registradas como entregas posteriores.
