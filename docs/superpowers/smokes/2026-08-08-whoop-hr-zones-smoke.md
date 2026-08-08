# Smoke — Whoop: zonas de frecuencia cardíaca (`019`)

Estado: **pendiente de ejecución.** Requiere sesión real; no cuesta API.

Plan: `docs/superpowers/plans/2026-08-08-whoop-hr-zones.md`
Spec: `docs/superpowers/specs/2026-08-07-whoop-hr-zones-design.md`

El orden de abajo asume el rollout de Task 0. Los pasos 1 y 2 se ejecutan
**después** de aplicar `019` y desplegar con `WHOOP_ZONES_ENABLED=false`; los
pasos 3 a 5, después del Deploy 3 que la enciende.

---

## Antes de empezar

- [ ] `019_whoop_workout_zones.sql` aplicada en producción.
- [ ] Bundle desplegado confirmado (hard refresh).
- [ ] `CONSENT_GATE_ENABLED=true` y `VITE_CONSENT_GATE=true` (preflight del spec §3.5).
- [ ] Anotar el valor efectivo de `WHOOP_ZONES_ENABLED` en el deploy bajo prueba.

---

## 1. Flag apagado: no escribe ni borra

El contrato es que apagado **omite** las siete claves, nunca las escribe como
`null`. Si las escribiera, un sync posterior al Deploy 3 borraría zonas ya
guardadas.

Antes del sync:

```sql
select count(*) as con_zonas from whoop_workouts where zone_zero_milli is not null;
```

- [ ] Forzar un sync completo desde Ajustes.
- [ ] Repetir la consulta: el conteo **no cambia**.
- [ ] Confirmar que un workout recién sincronizado tiene las siete columnas en
      `null` y el resto de sus campos poblados.

## 2. Las cinco `CHECK` rechazan lo que deben

Contra la base, con un `workout_id` real. Cada `update` debe **fallar**:

- [ ] `whoop_workouts_zones_all_or_none` — poblar cinco zonas y dejar una en `null`.
- [ ] `whoop_workouts_zones_non_negative` — una zona en `-1`.
- [ ] `whoop_workouts_zones_positive_total` — las seis en `0`.
- [ ] `whoop_workouts_percent_recorded_range` — `percent_recorded = 100.1`.
- [ ] `whoop_workouts_score_data_requires_scored` — zonas válidas sobre una fila
      `PENDING_SCORE`.
- [ ] Revertir cualquier cambio que sí haya quedado aplicado.

---

## 3. Flag encendido: la UI

Después del Deploy 3 y de un sync con al menos un workout `SCORED` con zonas.

- [ ] **Tarjeta de sesión** (`/day/:date`, sesión auto-completada): aparece la
      métrica `Zona alta` en minutos, la barra apilada y el desplegable
      `Distribución por zona` con seis filas en `m:ss`, orden Z5 → Z0.
- [ ] El desplegable abre y cierra; `aria-expanded` acompaña.
- [ ] **Cobertura**: si el workout trae `percent_recorded < 90`, el aviso sale
      **fuera** del desplegable, en ámbar. Entre 90 y 100 sale **dentro**. Con
      100 no aparece nada.
- [ ] **Paridad**: una sesión vieja **sin** zonas se ve igual que antes de esta
      entrega — mismas métricas, mismos valores, mismo copy, mismo orden, y
      **ningún** elemento de zonas.
- [ ] **Resumen semanal** (`/week`): la tarjeta `Carga medida por Whoop` muestra
      el titular en zona alta, el subtítulo con conteo y minutos registrados, las
      siete columnas (incluidas las vacías) y la leyenda Z0-Z5.
- [ ] Navegar a una semana **sin** workouts con zonas: la tarjeta no se monta.
- [ ] Navegar rápido entre semanas: el titular nunca muestra datos de la semana
      anterior. Es el bug que el test de carrera cubre; acá se confirma en vivo.

## 4. Bloque del coach

- [ ] Abrir el chat y mandar cualquier mensaje.
- [ ] En **Beta Quality** (Ajustes → export de trazas), buscar el bloque
      `Carga objetiva registrada por Whoop`.
- [ ] Cada línea con zonas trae `· N min zona alta` **entre** strain y FC.
- [ ] La guardia final dice `No propongas objetivos por zona: el producto no los tiene.`
- [ ] Un workout sin zonas produce la línea de la Entrega 2, sin `zona alta` ni
      `cobertura`.
- [ ] El coach **no** propone objetivos por zona en su respuesta.

## 5. Atleta gestionado

El spec §2.1 pide verificar que **no hay datos en ese scope**, no que una
superficie los filtre.

- [ ] Cambiar a un atleta gestionado.
- [ ] `/week`: la tarjeta semanal **no** se monta (corta antes de consultar).
- [ ] `/day/:date`: ninguna sesión muestra zonas.
- [ ] Confirmar en Supabase que ese `athlete_id` no tiene filas en
      `whoop_workouts`.

---

## 6. Auditoría: ¿qué deportes reciben distribución?

Responde de una vez la decisión abierta 2 del spec §11 — si squash recibe zonas
o si el valor de la entrega se concentra en running.

```sql
select sport_name,
       count(*) filter (where zone_zero_milli is null) as sin_zonas,
       count(*) as total
from whoop_workouts
where score_state = 'SCORED'
group by sport_name
order by total desc;
```

- [ ] Ejecutar después de al menos una semana con el flag encendido.
- [ ] Registrar el resultado acá y en el roadmap §24.

Resultado:

```
(pendiente)
```

---

## Notas de la ejecución

(pendiente)
