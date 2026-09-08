# Revisión de máquinas en la biblioteca de pesas

Fecha: 6 de septiembre de 2026. Alcance: inventario completo de `STRENGTH_EXERCISE_LIBRARY`, búsqueda de catálogo, resolución de nombres, selección por equipamiento y referencias de carga. Revisión y propuesta; no se incorporaron ejercicios ni se modificó código funcional.

## Resultado

La biblioteca tiene **77 ejercicios**. Solo **3 incluyen máquinas de fuerza como alternativa** y ninguno es exclusivo de máquina. Otros 2 usan la etiqueta `machine`, pero son cardio: bici de asalto y trotadora curva. No hay máquinas de fuerza para piernas ni press de pecho/hombros en máquina.

El catálogo está orientado a pesos libres, tronco, saltos y preparación deportiva. La cobertura de un gimnasio convencional es insuficiente.

## Cobertura existente

| ID | Ejercicio | Equipamiento declarado | Evaluación |
|---|---|---|---|
| assisted_pull_up | Dominada asistida | machine, bands | Existe; conviene distinguir máquina y banda para registrar asistencia correctamente. |
| chest_supported_row | Remo con pecho apoyado | dumbbell, machine | Cobertura parcial: la descripción habla de banco inclinado y no hay alias «remo en máquina». |
| lat_pulldown | Jalón al pecho | machine, cable | Existe; ampliar alias en español sin duplicar el ejercicio. |
| pallof_press | Press Pallof | cable, bands | Existe como trabajo de tronco en polea/banda. |
| cable_chop | Corte diagonal en polea | cable, bands | Existe. |
| half_kneeling_row | Remo en media rodilla | cable, bands, dumbbell | Existe, pero no equivale al remo sentado en polea baja. |
| assault_bike_30_30 | Bici de asalto 30/30 | assault_bike, machine | Cardio; no contabilizar como máquina de pesas. |
| air_treadmill_20_20 | Trotadora curva 20/20 | air_treadmill, machine | Cardio; no contabilizar como máquina de pesas. |

## Primera ampliación recomendada: 16 ejercicios

Prioridad propuesta por cobertura del catálogo, no como prescripción de entrenamiento individual. Los IDs son propuestas pendientes de implementación.

| Ejercicio | ID propuesto | Aporte |
|---|---|---|
| Press de pecho en máquina | machine_chest_press | Falta completamente el empuje horizontal guiado. |
| Press de hombros en máquina | machine_shoulder_press | Falta el empuje vertical guiado. |
| Remo sentado en máquina con apoyo de pecho | machine_seated_row | Identidad explícita frente al remo con mancuernas; revisar solapamiento con chest_supported_row conservando IDs históricos. |
| Aperturas de pecho en máquina / peck deck | machine_pec_fly | Movimiento de pecho diferente del press. |
| Aperturas inversas en máquina / reverse peck deck | machine_reverse_fly | Variante posterior; no mezclarla con aperturas de pecho aunque compartan aparato. |
| Prensa de piernas a 45° | leg_press_45 | Primer ejercicio de prensa; identificar la variante. |
| Prensa de piernas horizontal | horizontal_leg_press | Variante distinta; mantener historial de cargas separado. |
| Extensión de rodilla en máquina / cuádriceps | machine_leg_extension | Patrón aislado de rodilla ausente. |
| Curl femoral sentado | seated_leg_curl | Flexión de rodilla ausente. |
| Curl femoral tumbado | lying_leg_curl | Variante diferenciada del sentado. |
| Abducción de cadera en máquina | machine_hip_abduction | Hoy solo hay alternativas como caminata con banda. |
| Aducción de cadera en máquina | machine_hip_adduction | Diferente de la plancha Copenhagen existente. |
| Elevación de talones sentado en máquina | seated_calf_raise | Trabajo de pantorrilla con rodilla flexionada. |
| Elevación de talones de pie en máquina | standing_machine_calf_raise | Variante de pie diferenciada. |
| Remo sentado en polea baja | seated_cable_row | Falta una alternativa de tirón horizontal en polea. |
| Extensión de tríceps en polea | cable_triceps_pushdown | Accesorio de brazos ausente. |

## Segunda ampliación: 15 ejercicios o variantes

- Press inclinado en máquina.
- Sentadilla hack en máquina.
- Empuje de cadera en máquina / glute drive.
- Extensión de cadera en máquina / patada de glúteo.
- Curl de bíceps en máquina.
- Extensión de tríceps en máquina.
- Fondos asistidos en máquina; la dominada asistida actual no cubre fondos.
- Elevación lateral en máquina.
- Curl de bíceps en polea.
- Face pull en polea.
- Aperturas de pecho en poleas.
- Jalón de brazos rectos en polea.
- Sentadilla en Smith.
- Press banca en Smith.
- Press inclinado en Smith.

Separar Smith de barra libre y de una máquina genérica. No crear una variante por marca comercial salvo que exista una diferencia relevante de ejecución/equipamiento. Para poleas, los agarres pueden ser parámetros salvo que requieran identidad y seguimiento propios.

## Candidatos posteriores

Crunch abdominal en máquina, extensión de espalda en máquina, rotación de torso en máquina, belt squat, sentadilla pendular, remo alto y variantes unilaterales con discos. No son necesarios para cerrar la primera brecha. Su incorporación requiere describir bien ejecución, regiones cargadas y compatibilidad con restricciones; una máquina no debe etiquetarse automáticamente como apropiada para recuperación de espalda.

## Hallazgos técnicos que deben acompañar la ampliación

1. **Identidad errónea por coincidencia parcial.** Comprobación directa de `resolveStrengthExerciseName('Press banca en máquina')`: devuelve `bench_press`, coincidencia `substring`, referencia de carga de press banca con factor 1. Esto permite heredar una referencia de barra para una variante diferente. «Press de pecho en máquina», «Remo en máquina», «Remo sentado en polea», «Prensa de piernas» y «Curl femoral sentado» no resuelven. Agregar identidades explícitas y evitar que modificadores de equipamiento se pierdan en la resolución parcial.
2. **Tildes en equipamiento.** `normalizeEquipment(['máquinas'])` devuelve el fallback `bodyweight,dumbbell,bands`; `['maquinas']` sí devuelve `machine`. `['Smith']` también cae al fallback. Normalizar acentos y reconocer equipo específico.
3. **Búsqueda incompleta.** `coachExerciseCatalog.ts` indexa nombre, alias y tags, pero no equipment ni descripción. «Máquina» no encuentra un ejercicio simplemente por tener equipment=machine. Añadir términos visibles en español y alias consistentes.
4. **Equipamiento demasiado amplio.** Un solo `machine` no distingue prensa, press, remo o máquina asistida. Además, `filterByEquipment` acepta cualquier coincidencia en el array: los arrays representan alternativas, no requisitos conjuntos. Separar requisitos de cada variante y capacidades disponibles; no asumir que tener una máquina equivale a disponer de todas.
5. **Cardio mezclado con máquinas de pesas.** Assault bike y trotadora curva también declaran machine. El filtro genérico puede habilitarlas cuando solo se declaró una máquina de fuerza.
6. **Selección por bloques no aplica un filtro estricto de equipo.** `selectExerciseForBlockSlot` y `pickBlockFillers` parten de toda la biblioteca y luego puntúan disponibilidad (+8 o −30). Una penalización no garantiza exclusión. Corregir antes de prometer sesiones «solo máquinas». Esto se observó por inspección de código; no se midió su frecuencia en sesiones de usuarios.
7. **Sesgo de selección.** La puntuación por bloques da +35 a una referencia de 1RM disponible y +30 a un grupo de rotación preferido. Las máquinas existentes no tienen esa referencia. Añadir ejercicios no asegura que el selector los use: incorporar preferencia explícita por máquinas y revisar plantillas. No hay evidencia de telemetría para afirmar cuántas veces se proponen actualmente.
8. **El fallback de acciones de chat no pasa availableEquipment.** `buildStrengthSelectionContextForAction` construye el contexto sin ese campo; el selector considera disponible todo el equipamiento cuando no recibe información. Conectar el equipamiento y la preferencia del pedido a este flujo.
9. **Taxonomía insuficiente para accesorios nuevos.** Los patrones actuales son squat, hinge, push, pull, rotation, carry, locomotion. Extensión/flexión de rodilla, abducción/aducción y flexión plantar necesitan representar su función para no sustituir inadvertidamente un ejercicio principal. Puede hacerse con patrones adicionales o metadatos específicos y reglas de slots.
10. **Cargas y asistencia.** Propuesta de producto: las máquinas nuevas no deben recibir factores arbitrarios del 1RM de barra. Usar esfuerzo objetivo e historial de la variante/equipo. Diferenciar peso seleccionado, discos por lado y asistencia; en dominadas/fondos asistidos, más asistencia no representa mayor carga levantada.
11. **Seguridad e identidad histórica.** Cada alta necesita safety.loadsRegions y safety.loadPatterns, alias, dificultad, fatiga y fases apropiadas. Conservar referencias guardadas al aclarar `chest_supported_row`; no reutilizar su ID para una variante incompatible con su significado previo.

## Secuencia de implementación propuesta

1. Corregir resolución de nombres, normalización de equipamiento y filtro estricto por disponibilidad.
2. Definir variantes, capacidades de máquinas y registro de cargas/asistencia.
3. Incorporar los 16 ejercicios prioritarios con descripciones y alias en español/inglés, metadatos y referencias estables.
4. Integrarlos en búsqueda, selector, chat y sustituciones, respetando una preferencia explícita por máquinas.
5. Verificar que una sesión solo máquinas no incluya barra/mancuernas; que prensa o leg extension no hereden cargas de sentadilla; que press de máquina no resuelva a bench_press; que los ejercicios nuevos respeten restricciones; y que referencias antiguas sigan funcionando.
6. Ampliar con el segundo grupo según el equipamiento real de los usuarios.

## Evidencia y límites

Inventario y resolución comprobados cargando la biblioteca real mediante transpilación TypeScript en memoria. Normalización comprobada ejecutando la función extraída del selector, también en memoria. No se modificaron funciones para estas comprobaciones. Se revisó todo el inventario, pero no se hicieron pruebas de generación con proveedor IA ni se consultaron historiales personales.

Referencias de código: `src/services/training/exerciseLibrary.ts`, `src/services/training/coachExerciseCatalog.ts`, `src/services/training/strengthSelector.ts`, `src/services/training/strengthLoadPrescription.ts`, `src/services/ai/actionPostProcessor.ts`.

Contraste externo: [catálogo oficial Life Fitness Insignia](https://www.lifefitness.com/en-us/catalog/strength-training/selectorized/insignia-series), que enumera press de pecho/hombros, remo, aperturas, brazos, prensa, extensión/curl de piernas, cadera, pantorrillas y tronco. Se utilizó para verificar familias de máquinas disponibles comercialmente, no para afirmar prevalencia en gimnasios ni prescribir ejercicios para una lesión. La priorización anterior es una recomendación de cobertura del producto.

---

## Estado de implementación (2026-09-07)

Implementado y verificado con la suite completa (579 archivos / 4898 tests), `tsc -b`, lint y build.

**Hallazgo que la auditoría no registró y que cambió el orden de trabajo.** `availableEquipment`
nunca se poblaba en producción: `PlanWizardConfig` no declaraba el campo y
`profileAdapter.ts` lo leía con un cast de una propiedad inexistente, así que
`normalizeEquipment` siempre resolvía «todo». El hallazgo 6 era por eso inocuo hoy
y el paso 5 de la secuencia propuesta —verificar una sesión sólo de máquinas— no
era expresable. Por eso la captura del equipamiento se hizo antes que la ampliación.

| Entrega | Alcance | Estado |
|---|---|---|
| E1 | Guard de modificador de equipamiento en el tier `substring` | hecho |
| E2 | Captura en el perfil + propagación a los 6 productores + UI del wizard | hecho |
| E3 | Filtro estricto por disponibilidad en el camino de bloques | hecho |
| E4 | Patrones de función, campo `isolation` y elegibilidad para principal | hecho |
| E5 | 16 altas prioritarias | hecho |
| E6 | Verificación diferencial | hecho |
| E7 | Los 15 de la segunda tanda | **implementado**, tras perfilar y corregir el selector; ver [cierre](2026-09-07-strength-pending-completion.md) |

### Decisiones que se apartan de lo propuesto

- **El equipamiento vive en `AthleteProfile`, no en `PlanWizardConfig`.** Es una
  propiedad del gimnasio del atleta, y el chat y el prompt nunca ven un
  `PlanWizardConfig`. Viaja dentro de `athlete_profiles.data` por el rest-spread
  de `athleteProfileToRow`, así que **no requiere migración**.
- **Tres estados distintos, ninguno confundido con otro:** ausente = sin declarar
  (todo disponible, comportamiento previo); `[]` = seleccionó nada y el wizard no
  deja avanzar; texto no interpretable = no se entendió, se conserva la
  compatibilidad y el término queda registrado. Fallar en interpretar no es
  evidencia de ausencia.
- **El guard de nombres sólo puede quitar confianza, nunca agregarla.** Sobre un
  candidato único rechaza («press banca en máquina» ya no hereda la carga de la
  banca libre). Sobre un empate no estrecha la lista: hacerlo dejaba un solo
  candidato y los consumidores que miran `candidates` para decidir si exponen un
  %1RM se volvían más confiados por un filtro pensado para lo contrario.
- **La elegibilidad para levantamiento principal es un predicado explícito
  compartido** (`isMainLiftEligible`), no una consecuencia de la taxonomía. Hay
  cuatro caminos que pueden coronar un principal y ninguno mira el patrón; el
  cuarto —`resolveSessionStrengthRoles`— otorga además la **única exención** del
  conteo de repetición, así que un aislamiento primero se autoeximía del detector
  de diversidad.
- **Sin `loadReference` no bastaba.** `buildSelectionExercise` no prescribía
  `targetRpe`, así que por el camino del chat y del prompt una máquina llegaba sin
  ninguna señal de intensidad. Ahora lo prescribe. Además, un aislamiento ya no
  expone `targetPercent1RM`: sin 1RM propio ni derivado, era un número sin referente.
- **El inventario es por familia, no por máquina.** Declarar `machine` no acredita
  prensa, peck deck y hack squat; el copy del preset lo dice. Modelar máquina por
  máquina se descarta explícitamente para un piloto de 1–3 personas.

### Verificación diferencial

Barrido de 192 escenarios (4 inventarios × 4 fases × 3 perfiles deportivos × 2
rutas × 2 niveles de fatiga), ejecutando el selector con el catálogo anterior y
con el nuevo sobre los mismos inputs:

| Inventario | Idéntico | Sólo prescripción | Selección distinta |
|---|---:|---:|---:|
| Todo disponible | 24 | 24 | **0** |
| Barra + mancuernas + polea | 24 | 24 | **0** |
| Mancuernas + bandas + peso corporal | 15 | 24 | 9 |
| Máquinas + poleas | 0 | 0 | 48 |

Lecturas: ampliar el catálogo **no desplaza nada** para quien tiene todo
disponible. Los 9 cambios del inventario de casa no vienen de las altas —ninguna
es accesible con mancuernas y bandas— sino del filtro estricto, que reemplaza
equipo ausente por una alternativa real. Los 48 de máquinas son la corrección: antes
ese atleta recibía sentadilla con barra.

La invariante quedó congelada como test permanente
(`strengthEquipmentSweep.test.ts`): en los 192 escenarios, ningún ejercicio
propuesto requiere equipo no declarado, y un atleta de sólo peso corporal sigue
recibiendo una sesión ejecutable de al menos 3 ejercicios.

Los barridos congelados confirman que **los 77 ejercicios previos no cambiaron**:
`strengthBehaviorContract` y `strengthExerciseCopyInvariants` quedaron byte a byte
idénticos salvo `targetRpe` (de `null` a número) y la supresión de
`targetPercent1RM` en las **9 altas de aislamiento** —ningún id previo entre ellas—.

### Alcance de la afirmación de compatibilidad

Los planes ya guardados no cambian. **Las generaciones nuevas sí pueden cambiar**,
y ése es el objetivo del trabajo: un atleta que declare su equipamiento recibirá
sesiones distintas de las que habría recibido ayer.

### Costo medido y riesgo abierto en la primera entrega

Actualización: el perfil de CPU posterior identificó normalización repetida como costo dominante. Se corrigió antes de E7; mediciones y límites en el [cierre de pendientes](2026-09-07-strength-pending-completion.md). Las cifras e hipótesis siguientes corresponden a la primera entrega.

El allocator escala con el tamaño del catálogo. `strengthAllocatorDomain.test.ts`
pasó de **4,84–4,89 s** a **5,60–6,83 s** aislado (+15% a +40%), contra un
`testTimeout` de 10 s; bajo carga paralela de la suite completa expiró en 2 de 3
corridas, aunque pasa siempre aislado y la suite completa termina en verde. El test
ya era flaky antes de este cambio, pero el margen es ahora medible y menor.
Indexar el catálogo por `id` no lo movió: el costo está en filtrar y puntuar un
pool 21% mayor, no en búsquedas lineales.

**Esto es el argumento concreto para separar la segunda tanda:** 15 altas más
suben el catálogo a 108 (+40% sobre el original) y estrecharían el margen otra
vez. Antes de E7 conviene medir la complejidad del allocator, no sólo agregar
ejercicios.

### Fuera de alcance, declarado

- Los 15 ejercicios de la segunda tanda, incluidas las variantes en Smith.
- El `targetPercent1RM` que `lat_pulldown` y `chest_supported_row` exponen sin
  referencia de carga: es comportamiento anterior a esta entrega y cambiarlo
  movería contenido ya generado. Queda registrado como pregunta abierta.
- Backfill de sesiones existentes y del equipamiento de perfiles ya creados.
- Registro diferenciado de asistencia en dominadas y fondos asistidos (hallazgo 10):
  las altas de esta entrega no incluyen fondos asistidos.
