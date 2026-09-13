# Entrega 2 — provisión de la cuenta coach, transferencia y smoke

Fecha de escritura: 2026-09-12. Plan: `docs/superpowers/plans/2026-09-12-coach-role-separation-entrega-2.md`.
Consultas: `supabase/queries/2026-09-12-coach-entrega-2-checks.sql`.

**Criterio de parada inmediato** (roadmap §2): pérdida o no convergencia de datos,
acceso cruzado, sync que no vuelve a «Al día». Ante cualquiera, detener, no
transferir más y registrar.

## Precondiciones

- [ ] Bundle con las Tasks 1–6 desplegado y verificado con la cuenta híbrida:
      sync «Al día», cola vacía, roster igual al anterior.
- [ ] `037_coach_account_provisioning.sql` aplicada en el SQL Editor. Consulta A → 2 filas OK.
- [ ] Una cuenta Google para el coach distinta de la híbrida.
- [ ] **Dos perfiles de navegador separados** (o dos navegadores): uno por cuenta.
      Motivo: los tombstones de borrado de atleta son cross-usuario en `localStorage`.
- [ ] Saldo de API sin usar en este smoke: no se genera ningún plan.

## Paso 1 — provisionar el rol ANTES del primer ingreso

### 1a (preferido) — crear el usuario desde el dashboard

1. Supabase → Authentication → Users → *Add user* → email de la cuenta coach,
   *Auto confirm*. Copiar el `uuid`.
2. SQL Editor: `select public.admin_set_account_role('<uuid>', 'coach', 'advanced');`
   (`advanced` durante el piloto: la delegación consume el tier del coach, spec §8.4).
3. Consulta B → `account_role = coach`, `self_memberships = 0`, `self_rows = 0`.
4. Primer login con Google en el perfil del coach. Supabase enlaza la identidad
   por email verificado al usuario creado.

### 1b — si el primer login ya ocurrió como atleta

Cerrar sesión en todos los dispositivos de esa identidad y detener la provisión
sobre ella. No borrar su self ni `auth.users` para hacer pasar este smoke.

La comprobación por `athlete_id = ath_<uuid>` no demuestra que una cuenta esté
vacía: puede ser propietaria de otros atletas (incluidos transferidos) o tener
datos por cuenta. Eliminar `auth.users` también elimina los atletas cuyo owner
sigue siendo esa cuenta, aunque sus membresías pertenezcan ya a otro coach.

Usar para el paso 1a una identidad Google realmente nueva. Si se necesita
reutilizar la identidad anterior, la evaluación/exportación de sus datos y su
eliminación deben seguir el proceso de borrado de cuenta del proyecto en una
operación separada. No hay SQL destructivo de recuperación en este runbook.

Resultado: pendiente.

## Paso 2 — primer ingreso de la cuenta coach

Con el perfil del coach:

- [ ] Redirige a `/coach` sin pasar por `/onboarding`.
- [ ] Roster vacío, sin `Tú` y sin perfil deportivo propio.
- [ ] Sync «Al día», cola 0, consola sin `[sync]` de error. En particular **no**
      aparece `a coach account cannot own a self athlete` ni `pullAthletes:error`.
- [ ] Consulta B de nuevo → sigue `self_memberships = 0`, `self_rows = 0`.
- [ ] `/settings` y `/ops` abren; `/week` redirige a `/coach`.

Resultado: pendiente.

## Paso 3 — alta propia desde la cuenta coach (camino owner)

- [ ] Crear «Prueba coach» desde Alumnos → aparece en el roster de inmediato y
      la app abre el onboarding del gestionado.
- [ ] Completar un perfil mínimo, crear una sesión manual en `/week`.
- [ ] Sync «Al día». SQL: `select * from public.athlete_memberships where athlete_id = '<id nuevo>'` → una fila `coach` del coach.
- [ ] Archivar → Restaurar → Archivar → Eliminar «Prueba coach». Tras eliminar:
      `select count(*) from public.athletes where id = '<id nuevo>'` → 0.

Resultado: pendiente.

### 3b — DELETE de un transferido desechable

1. En el perfil híbrido, crear «Prueba transferencia» y sincronizar hasta cola 0.
2. Anotar su ID y transferirlo con `admin_transfer_coach_membership` al coach.
3. En el perfil del coach, sincronizar, archivar y eliminar **ese ID de prueba**.
4. SQL: comprobar que el ID ya no existe y que el gestionado real sigue intacto.
5. Sincronizar nuevamente ambas cuentas. Registrar cola 0 y ausencia de errores.

No usar el gestionado real para esta comprobación. Es parte del resultado del
Paso 3; si falla, no continuar al Paso 4.

## Paso 4 — transferir el gestionado de la cuenta híbrida

1. Identificar el atleta: `select id, display_name from public.athletes where owner_account_id = '<hybrid_uuid>' and linked_account_id is null;`
2. Consultas C y D **antes** (guardar).
3. `select public.admin_transfer_coach_membership('<athlete_id>', '<hybrid_uuid>', '<coach_uuid>');`
4. Consultas C, D y E **después**: coach tiene la fila, híbrida no, owner intacto, E vacía.

Resultado: pendiente.

## Paso 5 — la cuenta coach opera al transferido

Perfil del coach, «Sincronizar ahora»:

- [ ] El transferido aparece en Alumnos y en la barra de contexto.
- [ ] «Entrenar como este atleta» → `/` muestra su dashboard; `/week` muestra las
      sesiones existentes (las escribió la cuenta híbrida).
- [ ] Crear una sesión manual y cambiar el estado de otra → sync «Al día», cola 0.
      Consulta F → `sessions` ≥ 1.
- [ ] `/plans/builder` abre sin error (no generar).
- [ ] Recargar: el atleta sigue seleccionado. Cerrar sesión y volver a entrar:
      roster y selección persisten.
- [ ] Archivar el transferido → Restaurar. SQL D → `status` cambia y vuelve; owner intacto.
      (Es la rama UPDATE de Task 5. **No eliminarlo**: son datos reales.)

Resultado: pendiente.

## Paso 6 — la cuenta híbrida ya no lo ve

Perfil de la híbrida, «Sincronizar ahora»:

- [ ] El transferido desaparece del roster y del switcher; el self queda intacto.
- [ ] Consola: `pullAthletes:remote_delete_applied` para ese `athleteId` (es el
      contrato de §28: ausencia remota de un id reconocido = purga local).
- [ ] Sync «Al día», cola 0. Las sesiones propias no cambian.
- [ ] Anotar: esta cuenta deja un tombstone local para el transferido. **No usar
      este perfil de navegador con la cuenta coach.**

Resultado: pendiente.

## Paso 7 — reingreso cruzado

- [ ] Coach: cerrar sesión, entrar de nuevo, sincronizar → todo igual que al final del Paso 5.
- [ ] Híbrida: idem Paso 6.

Resultado: pendiente.

## Veredicto

| Paso | Resultado | Evidencia |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |

**APROBADO** sólo con los siete pasos en verde. Recién entonces se ejecuta la
Task 9 (retiro de `VITE_COACH_ACCOUNTS`).
