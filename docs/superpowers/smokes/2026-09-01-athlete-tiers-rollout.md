# Rollout de producción — separación Free / Weekly / Advanced

Fecha de ejecución: __________  
Owner que ejecuta: __________  
Producción: `app.rallyiq.cl`  
Deploy anterior (rollback): __________  
Deploy del servidor (Paso 1): __________  
Redeploy del cliente (Paso 5): __________

Este guion se ejecuta **después** de que el gate local completo esté verde. No
ejecutar los `update` de este documento contra otro entorno por accidente. El
orden es deliberado: primero queda activo el gate de servidor; el gate
preventivo del cliente se publica sólo después de probarlo. Nunca encender
`VITE_ENTITLEMENTS` antes de que el servidor esté desplegado y verificado.

## Gate local previo

- [ ] `npm run lint` — resultado: __________
- [ ] `npm test` — resultado y conteo: __________
- [ ] `npx tsc -b` — resultado: __________
- [ ] `npm run build` — resultado: __________
- [ ] `git diff --check` — resultado: __________

Detenerse si cualquiera falla.

## 0. Preflight: flags y padrón

En el contexto **Production** de Netlify, confirmar el estado efectivo de las
variables antes de desplegar:

| Variable | Valor requerido | Observado |
| --- | --- | --- |
| `ENTITLEMENTS_ENABLED` | `true` | __________ |
| `AI_USAGE_LIMITS_ENABLED` | `true` | __________ |
| `AI_KILL_SWITCH_ENABLED` | `false` | __________ |
| `VITE_ENTITLEMENTS` | apagada (no `true`) | __________ |

- [ ] Las cuatro condiciones coinciden.

Si alguna no coincide, **detenerse**. Este rollout presupone que el servidor ya
gatea y que el cliente todavía no oculta preventivamente las affordances.

### 0b. Revisar el padrón afectado

Antes de desplegar, ejecutar en producción en modo lectura:

```sql
select u.id, u.email, e.tier, e.expires_at
from auth.users u
left join public.user_entitlements e on e.user_id = u.id
order by u.created_at;
```

Resultado / cuentas que requieren aviso: __________

- [ ] Revisado: toda cuenta `free` distinta del owner perderá las propuestas
  aplicables de `chat_action` al desplegar y fue avisada o está fuera de uso.

### 0c. Snapshot del owner y preparación del rollback

Registrar el UUID del owner: `<OWNER_UUID> = ________________________________`.

Antes de cambiar el tier, guardar el resultado completo de esta consulta:

```sql
select user_id, tier, expires_at, source, updated_at
from public.user_entitlements
where user_id = '<OWNER_UUID>';
```

| Campo | Valor original |
| --- | --- |
| `user_id` | __________ |
| `tier` | __________ |
| `expires_at` | __________ |
| `source` | __________ |
| `updated_at` | __________ |

El smoke de este guion sólo modifica `tier`. El owner debe resolver a `free`
para el Paso 2 y contar con una fila explícita en `user_entitlements`; si no se
cumple, detenerse y preparar una cuenta de smoke que sí lo cumpla. No crear ni
alterar cuentas fuera de este guion sólo para continuar.

- [ ] Deploy de producción activo antes del cambio anotado arriba.
- [ ] Snapshot del owner guardado y tier original = `free`.
- [ ] Plan de rollback entendido: mantener `VITE_ENTITLEMENTS` apagada,
  restaurar el tier original y volver al deploy anterior anotado arriba.

### Regla de detención y rollback

Si falla cualquier smoke de entitlement o cuota:

1. Detener el rollout; no compensar encendiendo o apagando flags a medias.
2. Mantener `VITE_ENTITLEMENTS` apagada.
3. Si el tier del owner cambió, restaurarlo al valor del snapshot, protegido por
   el tier esperado actual. Por ejemplo, desde `advanced`:

   ```sql
   update public.user_entitlements
   set tier = '<TIER_ORIGINAL>'
   where user_id = '<OWNER_UUID>' and tier = 'advanced'
   returning user_id, tier, expires_at, source, updated_at;
   ```

4. Verificar que el `returning` coincide con el snapshot en todo salvo
   `updated_at`.
5. Revertir al deploy de producción anotado en el preflight.
6. Registrar el error, deploy revertido y resultado de la restauración:
   __________.

## 1. Desplegar el servidor con el cliente aún apagado

Desplegar el bundle de esta entrega conservando `VITE_ENTITLEMENTS` apagada.
El servidor aplicará la nueva separación de tiers y cuotas; la UI todavía no
bloqueará preventivamente la interacción.

- [ ] Deploy completado. URL/ID: __________
- [ ] Confirmado que `VITE_ENTITLEMENTS` sigue apagada en el bundle publicado.

No continuar si el deploy no corresponde al commit validado por el gate local.

## 2. Smoke Free

Con el owner aún en `free`, refrescar la sesión y comprobar contra producción:

- [ ] `chat_general` responde.
- [ ] Una solicitud concreta de ajuste de una sesión (`chat_action`) devuelve
  `403 entitlement_required` con oferta de plan; no un error técnico.
- [ ] «Crear semana» devuelve `403 entitlement_required` con oferta.
- [ ] `/competition-plan` permite consultar un plan existente en sólo lectura.

Resultado / evidencia (URL, mensaje o request ID): __________

Ante cualquier resultado distinto, aplicar la regla de rollback.

## 3. Smoke Weekly

Promover temporalmente al owner desde Free. Ejecutar en producción:

```sql
update public.user_entitlements
set tier = 'weekly'
where user_id = '<OWNER_UUID>' and tier = 'free'
returning user_id, tier, expires_at, source, updated_at;
```

- [ ] El `returning` contiene exactamente una fila con `tier = weekly`.

Refrescar la sesión y verificar:

- [ ] `chat_action` aplica un cambio real al calendario.
- [ ] «Crear semana» genera una semana real.
- [ ] Plan Builder devuelve `403 entitlement_required` con oferta de Advanced.

Resultado / evidencia: __________

## 4. Smoke Advanced

Promover temporalmente al owner desde Weekly:

```sql
update public.user_entitlements
set tier = 'advanced'
where user_id = '<OWNER_UUID>' and tier = 'weekly'
returning user_id, tier, expires_at, source, updated_at;
```

- [ ] El `returning` contiene exactamente una fila con `tier = advanced`.
- [ ] Plan Builder genera un plan real.

Resultado / evidencia: __________

## 4b. Restaurar el owner a su tier original

Antes de activar el gate preventivo de cliente, restaurar el valor que se
capturó en el Paso 0c. En este piloto debe ser `free`:

```sql
update public.user_entitlements
set tier = '<TIER_ORIGINAL>'
where user_id = '<OWNER_UUID>' and tier = 'advanced'
returning user_id, tier, expires_at, source, updated_at;
```

- [ ] El `returning` confirma el tier original y coincide con el snapshot salvo
  por `updated_at`.

Si el snapshot no era `free`, no dejar al owner en un estado alterado: usar una
segunda cuenta Free para el Paso 5, después de restaurar al owner exactamente a
su tier original.

## 5. Publicar y probar el gate preventivo de cliente

Sólo después de los smokes de servidor exitosos, activar
`VITE_ENTITLEMENTS=true` en Netlify y **redesplegar**. Es una variable de
build-time: cambiarla sin redeploy no cambia el bundle servido.

- [ ] Variable actualizada y redeploy completado. URL/ID: __________
- [ ] Con una cuenta Free, la oferta/bloqueo preventivo aparece antes de gastar
  una request de IA.

Resultado / evidencia: __________

Si este paso falla, aplicar la regla de rollback: apagar `VITE_ENTITLEMENTS`,
redesplegar o volver al deploy anterior y confirmar que el owner conserva su
tier original.

## 6. Verificar y anunciar `/pricing`

`PricingPage` forma parte del bundle del Paso 1; por tanto `/pricing` quedó
publicada técnicamente con el deploy de servidor. Este paso no es un deploy
adicional: ocurre después de los smokes exitosos para revisar el copy live y
anunciarlo.

- [ ] `/pricing` live no publica cifras de cuotas ni promesas numéricas.
- [ ] Describe Free, Coach Semanal y Advanced conforme a los gates desplegados.
- [ ] Anuncio realizado: __________

Si el copy no puede ser público antes de los smokes, separar explícitamente la
tarea de pricing en otro commit y deploy posterior; no reinterpretar este paso
como si ocultara la página ya incluida en el bundle del Paso 1.

## Pendientes que este rollout no cierra

1. **Fase 0 / Task 1** bloquea congelar números: mientras no se mida
   `coach_requests` sobre uso real, cuotas y caps son provisionales.
2. `coach_assistant_message` continúa clasificado como capacidad de atleta
   Advanced. Debe migrar a `coach_workspace` en Proyecto 2.
3. Las cuotas aún cuentan intentos del proveedor. Antes de self-serve se debe
   implementar una cuota mensual por unidad de producto ponderada (`week = 1`,
   `pair = 2`), no sólo una cuota diaria por intento.
4. `GLOBAL_DAILY_SPEND_CAP_USD` sigue en US$5 y está dimensionado para 1–3
   personas. Revisarlo antes de abrir a 10–20 cuentas.

## Cierre

Resultado global: ☐ aprobado ☐ rollback aplicado ☐ bloqueado  
Hallazgos y responsables: __________  
Fecha / hora de cierre: __________
