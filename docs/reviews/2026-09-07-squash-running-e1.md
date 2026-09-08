# Revisión de E0 e implementación de E1

Fecha: 2026-09-07. Alcance: duración de squash en chat y reparación, composición de running por tiempo, objetivos por bloque y verificación antes de guardar. Sin proveedor IA, commits ni deploy.

## Revisión de E0

Se ejecutó `probe:selectors:check` antes de modificar el motor: sin deriva, SHA-256 `f0bcd136e78f9d65c9cf901ee3de190cc78dcce472f448a2d42729e93ff78b9d`. El probe y su clasificación permiten empezar E1. No acreditaban el cierre completo de E0 tal como estaba escrito: faltaban Week Creator y persistencia, y la comprobación de determinismo sólo compara dos ejecuciones dentro de un mismo runtime.

Matices a las conclusiones:

- «Llega al calendario» no estaba probado: E0 llegaba a acciones postprocesadas y sesiones reparadas. E1 añade pruebas con Dexie y aceptación.
- «Sólo base» describe las fases y el perfil de squash ejercitados; no prueba todos los perfiles/fases.
- Squash de 60 min reparado a 55 min no cumple la tolerancia de E1, aunque no exceda el máximo.
- Los seis casos de R4 no acreditan aumento de intensidad. Tampoco bastan para establecer monotonía longitudinal: sí acreditan que se excluye la familia fácil por recencia.
- S6 sigue siendo un camino de código pendiente de un contraejemplo. No se cambió en E1.
- El guard bloquea fetch/XHR, no todos los mecanismos de red de Node. Se añadió fallo terminal cuando registra un intento, incluso si el código llamado captura la excepción.

La evidencia E0 original se conserva en su ubicación. E1 escribe en `fixtures/squash-running-selection/e1/`; los comandos npm del probe apuntan ahora a esa etapa. `node scripts/probe-selectors.mjs --stage=e0 --check` permite contrastar el motor nuevo contra el baseline antiguo y debe detectar los cambios intencionales. No regenerar E0 para hacer pasar esa comparación.

## Decisiones de composición

Los siguientes son mínimos configurados de **esta composición del producto**, no umbrales clínicos ni mínimos universales para obtener beneficio deportivo:

| Modalidad | Mínimo total | Reserva de entrada/cierre |
|---|---:|---|
| Squash técnico/control | 15 min | 5–10 min por extremo según tiempo total |
| Squash sombras | 20 min | 5–10 min por extremo |
| Partido por marcador | 20 min de reserva mínima | Incluidos en la reserva; total estimado |
| Running suave o rodaje por tiempo | 15 min | 5–10 min por extremo |
| Tempo/intervalos por tiempo | 20 min | 5–10 min por extremo |

La [American Heart Association](https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/warm-up-cool-down) propone entrada gradual de 5–10 minutos. Esa referencia orienta la reserva; no valida por sí sola los mínimos por modalidad elegidos aquí. El tiempo principal se obtiene después de reservar entrada y cierre. Debajo del mínimo se rechaza la composición con un mensaje concreto, sin alargar silenciosamente la sesión ni comprar otro intento de IA.

Squash reparte el tiempo en segundos, reduce el número de drills si no caben al menos tres minutos de práctica/pausa por drill y reconstruye `blocks` desde la misma dosis que `drills`. La duración de cada drill incluye su parte de calentamiento, práctica, pausas y cierre. Las notas separan esas partes y explican que las repeticiones del catálogo no son trabajo adicional obligatorio. Los partidos mantienen contenido por marcador y se etiquetan como estimación; no se promete terminar un mejor de cinco en un tiempo exacto.

Running usa bloques planos ya soportados por `RunningIntervalStructure`: entrada, trabajo, recuperaciones separadas y cierre. No hizo falta ampliar `types/index.ts`, ni una migración. Intervalos genéricos usan 2–5 repeticiones de hasta 3 minutos y 1 minuto suave entre repeticiones; el tiempo restante es suave. Tempo conserva un máximo de 35 minutos de trabajo; el exceso queda como rodaje suave. Estos valores son defaults de composición revisables, no la materialización definitiva de las 27 plantillas.

Se conservó la banda de umbral derivada del perfil existente. Se retiraron ritmos y frecuencias absolutos de fallback sin perfil. Entrada, pausas y cierre sólo toman ritmo fácil del perfil; sin dato válido usan instrucciones de esfuerzo. No se copia `typicalStructure` de una plantilla seleccionada independientemente como nota de otro tipo de bloque.

## Qué cambió

- `sessionTimeBudget.ts`: aritmética en segundos y duración desconocida explícita.
- `squashSessionDose.ts` + hidratador: dosis por presupuesto, proyecciones consistentes y mínimos explícitos.
- `runningSessionMaterializer.ts`: composición genérica compartida para chat, repair y running de soporte; desaparecen los constructores fijos de 800 m y las notas contradictorias.
- `sessionDoseFinalizer.ts` / `coachActionDose.ts`: comprobación posterior a mutaciones, altas, updates, acortar/alargar y create_week. Las estructuras provistas por distancia sin tiempo o con recuperaciones sólo textuales no se consideran computables. Las estructuras ajenas incompatibles se rechazan con explicación en vez de sustituirlas silenciosamente por otro entrenamiento.
- `applyCreateWeek` y aceptación de acciones: segunda comprobación al guardar; la semana se verifica antes de reemplazar registros existentes. Se conserva el aislamiento por atleta y el comportamiento de fuerza.
- `trainingProtocols.ts`: las tarjetas de entrada/cierre de composiciones nuevas describen los minutos ya reservados, con duración alineada y aviso de que están incluidos.
- `quality.session.dose_infeasible`: rechazo de composición que no habilita fallback local ni otro intento de proveedor en el loop de Plan Builder o Week Creator.

No se editó el frente de fuerza/equipamiento. Los cambios en `actionPostProcessor.ts` y `package.json` se aplicaron sobre el contenido que ya existía. El árbol sigue compartido con ese frente; las comprobaciones acreditan el árbol combinado, no un commit aislado.

## Evidencia nueva y límites

Tests nuevos:

- `sessionDose.test.ts`: 20/30/45/60, perfiles incompletos/ritmos inválidos, recuperaciones, mínimos, estructuras provistas e idempotencia de dosis de squash.
- `selector-dose-routes.test.js`: casos E0 contra contratos de dosis nuevos, reparación repetida de running y entrada real de `hydrateWeekCreatorResponse`.
- `sessionDosePersistence.test.ts`: chat → postproceso → aceptación → Dexie para squash/running; aceptación semanal, conservación de bloques y rechazo previo al reemplazo ante duración desconocida.

Hallazgo pendiente: una semana completa puede cambiar nombres de drills de squash en la segunda reparación. Se reprodujo también usando un plugin de Vite que sustituye **sólo en memoria** `repairWeek.ts` y `squashSessionHydrator.ts` por sus versiones de HEAD: `baseline idempotent: false`. La sesión «Squash - Técnica Aplicada» pasó de volea + boast de fondo + boast de media cancha a ambos boasts + lob ofensivo. No se modificaron esos archivos para realizar la comparación. La dosis de E1 es idempotente; la identidad de squash a escala de semana necesita seguimiento en E2a/S7.

Sigue pendiente la fidelidad e identidad de las 27 plantillas (E3), y que los parámetros declarados participen en la selección (R1/E2b). El selector de prompt aún puede recomendar su estructura textual original; la sesión materializada por E1 tiene una dosis propia por tiempo y no se atribuye una identidad de plantilla. No se ampliaron catálogos ni políticas de carga/restricciones.

Estas pruebas no son un smoke autenticado del navegador ni una sincronización multidispositivo. No se ejecutó un proveedor de IA ni se desplegó.

## Verificación

- Gate completo: `npm test -- --maxWorkers=4`, **582 archivos / 4927 tests**, todos verdes. Concurrencia limitada para reducir la contención del allocator; no se cambió su timeout ni se omitieron pruebas.
- Después se añadieron dos casos de no-reintento, uno por engine: ambas suites focalizadas pasan (**10/10**, incluidos los dos casos nuevos). No se ejecutó una segunda suite completa por añadir sólo estos tests.
- `npm run lint`, `npm run build` (incluye TypeScript), `npx tsc -b` y `git diff --check`: correctos. El build mantiene sus avisos habituales de manifest `dev` y archivo de sourcemaps desactivado.
- `probe:selectors:check`: sin deriva, SHA-256 E1 `f7fb96311378f36ec7cfab977666f7a6df6fa12d35d4da428b10b36ba2f6e166`. Dos ejecuciones por corrida; cero intentos de fetch/XHR. La procedencia E1 incluye hashes de los archivos fuente principales, además de revisión y paths modificados.
- Se compararon E0/E1: sólo cambian `chat`, `repairRunning`, `repairSquash` y `squashHydration`. Inventario, elegibilidad, selección e historial no cambian.
- Los dos archivos originales E0 se compararon byte a byte contra la copia inicial y permanecen intactos.
- Regresiones ajustadas explícitamente: no esperar FC inventada de 62–72, esperar nueva dosis en un update de duración, permitir el sufijo de dosis tras la descripción canónica de squash y contar rodaje suave después de los 35 min máximos de tempo.
- Las filas legacy de squash sin drills conservan el contrato de validación de contenido anterior; no se certifica una dosis inexistente ni se bloquea retrospectivamente la reconciliación de planes por ese motivo.

## Seguimiento del 2026-09-08

La implementación de E1–E3 y el backlog autorizado, su verificación y sus límites están en el [informe de cierre](2026-09-08-squash-running-implementation.md). Este documento conserva el diagnóstico y los resultados históricos de su fecha.
