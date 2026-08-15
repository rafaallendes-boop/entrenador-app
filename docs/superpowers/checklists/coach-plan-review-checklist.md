# Checklist manual de revisión de entrenador — Plan Builder

Propósito: antes de entregarle un plan generado por Plan Builder a un
atleta/cliente real (piloto premium o interno), un entrenador humano debe
revisarlo con esta lista. No requiere acceso a código ni a Supabase — todo se
verifica desde la UI de la app (`/plan`, `/week`, `/settings`) y, si hace
falta profundizar, desde un backup JSON exportado (`Ajustes → Respaldo JSON →
Exportar Respaldo`).

Origen: producido a partir del smoke de 5 arquetipos del 2026-08-13
(`docs/superpowers/smokes/2026-08-13-archetype-plans-prod-smoke.md`) y de los
criterios de la sección E de `PROJECT_REVIEW_AND_ROADMAP.md`.

Cómo usar esta lista: recorrerla de arriba a abajo por cada plan nuevo antes
de entregarlo. En cada línea, reemplazar `__________` por **OK**, **REVISAR**
(algo raro pero no bloqueante) o **BLOQUEA** (no entregar el plan sin
corregirlo primero). No dejar ningún estado en blanco. Un plan con cualquier
ítem en BLOQUEA no se entrega sin que alguien del equipo técnico lo revise.

## 0. Antes de empezar

- **Estado: __________** — Confirmar de qué atleta es el plan (nombre visible en el banner
  "Entrenando a X" si es gestionado, o el self si no hay banner). **Nunca**
  revisar/editar un plan con el banner de otro atleta activo.
- **Estado: __________** — Confirmar que el atleta tiene como máximo **un** plan de competencia
  con `status: active` para el rango de fechas actual. Si `/competition-plan`
  muestra un plan pero el Home/Semana dice "Sin plan de competencia" (o
  viceversa), **detenerse**: es el síntoma del Hallazgo 7 del smoke de
  2026-08-13 (múltiples planes activos simultáneos). Reportarlo antes de
  seguir revisando ese plan.
- **Estado: __________** — Anotar: nombre del evento, fecha del evento, cantidad de semanas,
  fase actual mostrada en `/competition-plan`.

## 1. Camino feliz — semana por semana

Repetir para **cada** semana del plan (usar los tabs "Sem 1", "Sem 2"... en
el builder si el plan recién se generó, o navegar semana a semana en `/week`
si ya está aceptado):

- **Estado: __________** — La fase mostrada (Base/Build/Peak/Taper/Competencia) es coherente con
  la distancia al evento. Una semana a 1-2 días del evento en fase Build o
  Peak es un error.
- **Estado: __________** — La cantidad de sesiones de la semana no excede la
  capacidad configurada (días disponibles, con hasta dos sesiones por día
  solo cuando la doble sesión está activada). El taper, una lesión u otra
  restricción justificada pueden requerir menos sesiones que ese máximo; no
  es necesario completarlo. Una semana que excede esa capacidad es un error.
- **Estado: __________** — Cada sesión de squash declara una sola modalidad principal
  (control/técnico/sombras/partido) — leer el título y el primer bloque de
  contenido. Si una sesión mezcla pelota de "control en solitario" con
  drills cooperativos de pareja en el mismo bloque, es un error (ver
  Hallazgo del smoke 2026-08-11: la modalidad nunca debería cruzarse).
- **Estado: __________** — Si hay ejercicios de fuerza y el atleta tiene 1RM cargado en su
  perfil, las cargas propuestas (`peso` o `%1RM`) tienen sentido aritmético
  contra ese 1RM (ej.: 70% de un sentadilla de 100 kg debería rondar 70 kg,
  no 40 ni 95). Si el atleta **no** tiene 1RM cargado, no debería haber
  pesos absolutos inventados sin base.
- **Estado: __________** — Si aparece running o ciclismo, hay una razón visible en el objetivo o
  las notas de la sesión (recuperación activa, aporte aeróbico específico).
  Si aparece sin ningún contexto y el atleta no señaló esos deportes como
  complementarios, marcar REVISAR.

## 2. Fuerza — variedad y progresión

- **Estado: __________** — Comparar los ejercicios de fuerza de dos semanas consecutivas de la
  misma fase (ej. dos semanas de Peak). Si comparten **todos o casi todos**
  los ejercicios con los mismos parámetros, es una plantilla clonada —
  revisar si `generationSummary.qualityReview` en el backup marcó
  `quality.strength.repeated_template`. Si el warning existe pero el
  contenido no cambió entre semanas, marcar REVISAR (el sistema lo detectó
  pero no lo corrigió). La UI interna también puede usarse como origen si
  ese flag aparece visible allí.
- **Estado: __________** — Si hay superseries (icono de corchete / etiqueta "Superserie" en la
  UI, o campo `supersetGroup` en el backup), confirmar que los ejercicios
  agrupados comparten el mismo número de series (`sets`). Un grupo con series
  distintas entre sus miembros es un error de datos.

## 3. Taper y semana de competencia

- **Estado: __________** — Dentro de la ventana del evento (desde su inicio hasta su término),
  hay como máximo **2 sesiones de apoyo** además del ancla competitiva. No
  contar aquí las sesiones previas a la ventana aunque estén en la misma semana
  `race`; esas se evalúan con las reglas de taper siguientes.
- **Estado: __________** — Ninguna sesión de apoyo en la semana de taper/competencia supera
  ~30 minutos o RPE 4, salvo el partido/evento mismo.
- **Estado: __________** — No hay fuerza pesada, sesiones largas de running/ciclismo, ni una
  segunda sesión el mismo día del evento.
- **Estado: __________** — Si el atleta tiene **doble sesión** en taper/competencia, verificar que
  la suma diaria siga siendo liviana y que dentro de la ventana del evento no
  se supere el máximo anterior. Cuatro sesiones previas repartidas en la semana
  no infringen por sí solas el contrato; marcar BLOQUEA solo por exceso dentro
  de la ventana o por carga/duración incompatible con taper.

## 4. Restricciones médicas y disponibilidad

- **Estado: __________** — Si el atleta tiene una lesión/restricción cargada en su perfil
  ("Lesiones y restricciones" en Ajustes), ningún ejercicio de fuerza ni
  drill de squash contradice explícitamente esa restricción (ej.: restricción
  "evitar saltos" y aparece un `jump_squat` o pliométrico sin marcar).
- **Estado: __________** — Si la restricción menciona evitar partido competitivo, no debería
  aparecer ningún partido de práctica **adicional** al evento real
  (el evento en sí, si es obligatorio, puede seguir apareciendo — es una
  decisión de producto, no un bug).
- **Estado: __________** — Todas las sesiones caen en los días marcados como disponibles en el
  perfil del atleta. Una sesión en un día no disponible es un error, salvo
  que sea el día del evento real (los eventos no están atados a la
  disponibilidad semanal configurada).

## 5. Perfil y persistencia (verificación rápida anti-regresión)

Este bloque existe específicamente por el Hallazgo 1 del smoke de
2026-08-13 (el perfil del atleta se vació dos veces durante esa sesión).

- **Estado: __________** — Después de generar o aceptar un plan, recargar la página completa
  (F5 / hard refresh) y volver a Ajustes → Perfil del atleta. Confirmar que
  nombre, edad, peso, disciplinas, 1RM y disponibilidad **siguen** con los
  valores que se guardaron, no en blanco/placeholder.
- **Estado: __________** — Si el perfil aparece vacío después de un refresh, **no seguir
  generando planes para ese atleta** hasta confirmar si es reproducible —
  puede bloquear silenciosamente al chat ("necesito conocer tus deportes y
  disponibilidad") en la siguiente interacción.

## 6. Cierre

- **Estado: __________** — Exportar un backup (Ajustes → Respaldo JSON → Exportar Respaldo)
  después de aceptar el plan, y guardarlo con un nombre que identifique al
  atleta y la fecha. Sirve como evidencia si después aparece una
  discrepancia.
- **Estado: __________** — Si algún ítem quedó en BLOQUEA, no entregar el plan al atleta. Avisar
  al equipo técnico con: nombre del atleta, `plan_id` (visible en el backup,
  campo `trainingPlans[].id`), y el ítem específico que falló.
- **Estado: __________** — Si todos los ítems fueron evaluados y ninguno quedó
  en BLOQUEA, el plan está listo para revisión final de contenido/tono con el
  atleta; los ítems en REVISAR deben quedar anotados para seguimiento.
