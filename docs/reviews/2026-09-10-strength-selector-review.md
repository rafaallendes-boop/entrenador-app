Revisión integral del selector de fuerza — 10 de septiembre de 2026

Actualización posterior: se implementó la [ampliación de potencia, escalera y finishers](2026-09-10-athletic-strength-expansion.md). El catálogo actual contiene 117 ejercicios. Las cifras de 108 ejercicios y 576 sesiones de este informe conservan la fotografía de la revisión previa a esa ampliación.

La prioridad es mejorar la calidad de la programación: selección por función, continuidad del estímulo, dosis ejecutable y compatibilidad con el trabajo en cancha. El catálogo ya es suficientemente amplio para dar ese paso. Añadir más ejercicios antes de resolver esos criterios ampliaría también las decisiones inconsistentes.

Esta entrega incluye la revisión del sistema, correcciones acotadas del selector y una propuesta de implementación completa. Las correcciones están diferenciadas de los cambios de arquitectura pendientes. No se modifican sesiones históricas ni se publica una versión.

**1. Cómo está construido**

| Capa | Archivo principal | Responsabilidad y observación |
|---|---|---|
| Catálogo | `src/services/training/exerciseLibrary.ts` | 108 identidades con nombres, alias, patrones, material, unidades y restricciones declarativas. Parte de las fases y referencias de carga se añade en un enriquecimiento del catálogo. |
| Inventario | `src/services/training/equipmentVocabulary.ts` | Normaliza nombres de equipo. Distingue inventario ausente, vacío y desconocido. |
| Selección | `src/services/training/strengthSelector.ts` | Dos rutas: puntuación por contexto e historial, o slots de plantillas. Tener índice de semana, 1RM disponible o ajuste de RPE activa la segunda. |
| Plantillas | `src/services/training/strengthBlocks/` | Build A/B/C, peak A/B/C, taper A/B y race. Base reutiliza build; transition reutiliza taper B. |
| Dosis y estructura | `src/services/training/strengthSessionStructure.ts`, `strengthLoadPrescription.ts`, `strengthExerciseProposal.ts` | Ordena grupos, añade core cuando corresponde, calcula cargas y aproximaciones, y convierte la selección en propuestas. Algunas rutas vuelven a inferir intensidad después de seleccionar. |
| Planificación | `src/services/planBuilder/repairWeek.ts`, `strengthBlockAllocator.ts`, `strengthRoleContract.ts` | Repara las semanas, mantiene identidad, rota accesorios y controla repeticiones entre semanas. |
| Restricciones | `src/services/training/strengthSafetyConstraints.ts`, `strengthSafetyFinalizer.ts` | Filtra candidatos y revalida la sesión final según restricciones y equipo. |
| Elección manual | `src/components/session/ExerciseLibraryBrowser.tsx`, `src/services/training/coachExerciseCatalog.ts` | Búsqueda por nombre, alias, etiquetas y equipo; filtros visibles por categoría e intensidad. No muestra la función dentro del plan ni equivalencias de reemplazo. |

Las bases que conviene conservar son la identidad mediante `libraryRef`, los alias indexados, las restricciones declarativas, la revalidación final y el RPE para máquinas sin conversión ficticia del 1RM de barra.

**2. Lectura como preparador físico**

Para squash, propongo organizar la fuerza alrededor de producción de fuerza, apoyo unilateral, frenado, desplazamiento lateral, control del tronco y capacidad de repetir esfuerzos en cancha. La investigación con jugadores de squash respalda evaluar capacidades mediante tareas específicas e intermitentes; no permite asumir que una etiqueta `squash_specific` demuestra transferencia del ejercicio a resultados competitivos. [James, Jones y Farra, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8851109/).

Las máquinas pueden contribuir a desarrollar fuerza y masa muscular y permiten ajustar el trabajo según material y experiencia. Un ensayo en adultos principiantes encontró mejoras con máquinas, pesos libres y su combinación. Esa evidencia no demuestra que cualquier ejercicio en máquina sustituya cualquier necesidad de squash. [Ensayo sobre máquinas y pesos libres en principiantes](https://pubmed.ncbi.nlm.nih.gov/33114782/).

La posición ACSM de 2026 respalda la sobrecarga progresiva y distingue la prescripción para fuerza, hipertrofia y potencia. También encuentra ventajas de priorizar al comienzo los ejercicios cuyo desarrollo de fuerza interesa más. Por eso recomiendo distinguir una activación breve de tronco de un bloque completo de core antes de los ejercicios principales. El documento estudia adultos sanos; los rangos generales deben adaptarse al calendario y al nivel deportivo. [ACSM, 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/).

La potencia requiere calidad de ejecución y una dosis propia. Existe investigación de pliometría en tenistas jóvenes, pero su aplicación a squash adulto es una extrapolación de entrenamiento, no una validación directa del selector. El sistema debería separar saltos/lanzamientos, coordinación en escalera y acondicionamiento por intervalos. Actualmente comparten parte de su taxonomía. [Estudio en tenis, 2023](https://pubmed.ncbi.nlm.nih.gov/36673841/).

**3. Catálogo: cobertura y vacíos**

| Clasificación actual | Cantidad |
|---|---:|
| Tren inferior / superior | 31 / 39 |
| Core / cuerpo completo | 12 / 26 |
| Fuerza / hipertrofia | 16 / 49 |
| Potencia / estabilidad / recuperación | 21 / 19 / 3 |

Estas cifras describen etiquetas, no la utilidad exclusiva de cada ejercicio. Un press en máquina etiquetado `hypertrophy` también puede formar parte de un programa de fuerza. Mezclar tipo de ejercicio y objetivo de la dosis dificulta esa elección.

Hay buena cobertura de sentadillas, bisagras, empujes, tirones, zancadas y saltos. La expansión añadió trabajo útil de flexión de rodilla, aducción de cadera y pantorrilla/sóleo. Conviene asegurar su presencia cuando corresponda al plan, en lugar de dejarlos competir únicamente como relleno con accesorios de brazos.

Vacíos a resolver antes de otra expansión masiva:

- **22 ejercicios sin `riskLevel` ni `fatigueCost` explícitos**, incluidos peso muerto, push press y swing. Sí tienen perfil `safety`; son campos distintos. La ausencia de coste de fatiga no equivale a coste bajo. El JSON adjunto enumera las identidades.
- Falta una clasificación funcional de empuje/tirón horizontal y vertical, antirotación frente a rotación, apoyo unilateral y bilateral, y frenado frente a rebote. Muchas distinciones dependen de etiquetas libres.
- Conviene evaluar variantes accesibles para rotadores externos de hombro, control escapular, muñeca/antebrazo y progresiones de frenado. Deben añadirse con identidad, dosis y equipo propios, sin prometer prevención de lesiones por incluir un ejercicio aislado.
- `med_ball_rotational_throw` y `rotational_med_ball_throw` merecen revisión editorial y funcional. La similitud de nombres puede producir variedad aparente. No deben fusionarse IDs sin conservar las referencias históricas.
- El equipo mezcla alternativas con requisitos: `['trx', 'bodyweight']` deja pasar un remo TRX con sólo peso corporal; `['stability_ball', 'bodyweight']` presenta el mismo problema. `machine` también habilita una bici de asalto y una trotadora curva. Pasar el filtro actual no demuestra que la sesión sea físicamente ejecutable.

**4. Defectos corregidos en esta entrega**

| Antes | Después |
|---|---|
| El slot `lunge` aceptaba cualquier unilateral: un remo, una plancha o un salto podían satisfacerlo. | Exige trabajo unilateral no aislado de piernas, con patrón de sentadilla o locomoción. |
| Un slot de empuje, tirón o bisagra podía cubrirse con un aislamiento del mismo patrón. | Los slots estructurales excluyen aislamientos; éstos siguen disponibles en el relleno limitado. |
| Principiante excluía avanzados, pero aceptaba intermedios. | El nivel explícito principiante selecciona ejercicios declarados principiantes. |
| El fallback rebajaba artificialmente la fatiga hasta 6 para completar cantidad. | Reutiliza el pool elegible sin relajar fatiga. Una sesión puede quedar más corta si falta material o candidatos. |
| El historial buscaba el principal en posición cero, aunque la propia aplicación coloca core antes. | Identifica el primer compuesto de fuerza/hipertrofia de piernas o torso después del core. |
| Tres variantes del mismo patrón en un día podían contarse como tres exposiciones. | La frecuencia cuenta una exposición por patrón y sesión. |
| Tres planchas declaradas por segundos llegaban como `3 × 10` repeticiones. | Se respeta `prescriptionUnit`: `3 × 30s` en el selector. |
| La descarga de un bloque temporal podía subir de una a dos series. | La descarga nunca aumenta ese número de bloques. |
| El resumen del principal podía anunciar RPE 7 mientras el ejercicio indicaba RPE 5, o conservar porcentajes ascendentes al descargar. | El resumen deriva de la misma prescripción; la descarga usa el porcentaje conservador existente del sistema, 60%. |
| Repetir un patrón se describía como «sobreentrenado». | El mensaje describe repetición reciente sin diagnosticar sobreentrenamiento. |

Estas correcciones no convierten todavía la progresión en un sistema basado en rendimiento ejecutado. Tampoco cambian los contratos de orden del core ni la política global de diversidad.

**5. Resultados de la auditoría automática**

Reproducir con `node scripts/audit-strength-selector.mjs docs/reviews/2026-09-10-strength-selector-audit.json`. No llama a IA, proveedores ni bases de datos. Cruza seis fases, tres niveles, cuatro inventarios, dos niveles de fatiga y cuatro configuraciones de selección: **576 sesiones** de apoyo al squash de 60 minutos.

Los contratos comprobados de identidad única, cuota de aislamientos, disponibilidad según el modelo actual, nivel principiante, filtro de fatiga, unidad temporal y coherencia del principal no presentan infracciones después de las correcciones.

La corrida vigente cruza **720 sesiones**: se añadió el inventario **no
declarado**, que es el caso que la ampliación de mini vallas y cinta cambió y
que la versión anterior de esta auditoría no ejercitaba. El chequeo de
equipamiento pasó a usar `hasExerciseEquipment`, el mismo predicado de
producción, así que ahora también valida `requiredEquipment`.

| Observación pendiente | Antes (108 ejercicios, 576 sesiones) | Ahora (117, 720) |
|---|---:|---:|
| Algún ejercicio fuera de sus fases declaradas | 97 | 116 |
| Más de dos ejercicios del grupo core | 230 | **37** |
| Más de un bloque del grupo cardio/footwork | 51 | **12** |
| Sin ejercicio no aislado de categoría lower | 31 de 144 | **9 de 180** |
| Sin tirón no aislado de tren superior | 36 de 144 | 42 de 180 |

La columna «antes» conserva la fotografía previa a la ampliación y **no
reproduce** con el código actual: se deja sólo como referencia. `phaseMismatch`
se mantiene proporcionalmente plano (17% → 16%). El core bloat y la duplicación
de acondicionamiento se cerraron en el endurecimiento descrito en §9.

Son señales de revisión, no 445 sesiones incorrectas ni incidencias independientes: las observaciones pueden coincidir. Tampoco toda sesión necesita cubrir todos los patrones; la cobertura debe evaluarse por semana y con el inventario disponible. La auditoría muestra ejemplos reproducibles y evita presentar los tests de código como validación deportiva completa. No incluye restricciones clínicas individuales, todas las duraciones ni todas las combinaciones de calendario.

**6. Prioridades para la mejora completa**

| Orden | Mejora | Criterio de aceptación |
|---|---|---|
| 1 | **Unificar elegibilidad y equipo real.** Un servicio común para selección, reemplazo, estructura y finalizador. Representar requisitos y alternativas por separado, completar fatiga/riesgo y decidir una política única de fases. | Sólo peso corporal nunca produce TRX, fitball o máquinas. Una exclusión por contexto se mantiene hasta la sesión final. Las dos rutas concuerdan en quién es elegible. |
| 2 | **Revisar continuidad y reemplazos junto con el allocator.** Definir familia funcional, objetivo y nivel de equivalencia. Conservar principales durante un bloque y variar accesorios con criterio. | Una apertura no reemplaza un press principal; un salto no elimina el único estímulo de fuerza; un unilateral requerido conserva su función. Se puede repetir un ejercicio útil sin que la diversidad fuerce una sustitución peor. |
| 3 | **Programar cobertura semanal.** Slots explícitos de fuerza bilateral, unilateral/lateral, empuje, tirón, tronco y capacidad complementaria. Plantillas propias para base y transición. | La semana tiene cobertura razonada según frecuencia, deporte y material. El relleno no crea cuatro cores o dos intervalos porque puntúan bien. |
| 4 | **Prescribir dentro de un presupuesto de tiempo.** Incluir series, ejecución, lados, pausas, calentamiento y cambios de estación. | Una sesión anunciada como 45 minutos cabe aproximadamente en ese tiempo con descansos útiles; se recortan accesorios antes de comprimir el trabajo prioritario. |
| 5 | **Progresar con ejecución registrada.** Series y repeticiones logradas, carga, RPE/RIR, técnica y respuesta posterior. Separar carga externa de asistencia. | Una subida depende del rendimiento en la misma variante y equipo; más kilos de asistencia nunca se interpreta como mayor fuerza. Cambiar de máquina no hereda kilos sin calibración. |
| 6 | **Integrar calendario de cancha.** Distinguir partido, entrenamiento exigente, sesión técnica y torneo; considerar proximidad y carga acumulada. | El trabajo de piernas, potencia y acondicionamiento se adapta al calendario. La proximidad competitiva no se reduce sólo a un booleano ni prescribe fatiga por completar ejercicios. |
| 7 | **Mejorar el selector visible.** Filtros de equipo, patrón, nivel, objetivo y unilateralidad; ficha con dosis, ejecución, equipo imprescindible y motivo de selección. | El deportista puede entender para qué está el ejercicio y cambiarlo por una alternativa que conserve esa función. Los estados sin candidatos explican qué requisito falta. |

La prioridad 2 tiene una dependencia comprobada: al restringir los pools a equivalentes más fieles, fallaron dos pruebas del contrato de diversidad de 12 semanas en `strengthAllocatorDomain.test.ts`. No se dejó ese cambio parcial ni se rebajaron los tests. El allocator y su evaluación de calidad deben evolucionar conjuntamente: actualmente exigen menos de tres coincidencias contables entre cualquier par de semanas del fixture, un criterio de variedad que no representa por sí solo una buena progresión.

**7. Propuesta de programación a implementar**

Como punto de partida de producto para un adulto con experiencia y dos sesiones semanales de apoyo, propongo familias A/B estables durante el bloque, ajustadas a material, calendario y respuesta:

| Familia A | Familia B |
|---|---|
| Sentadilla o prensa como principal | Bisagra o variante de extensión de cadera como principal |
| Zancada / split squat | Fuerza unilateral o lateral |
| Tirón y empuje complementarios | Empuje y tirón complementarios |
| Antirotación o estabilidad lateral | Antiextensión o control del tronco |
| Complemento según necesidad: sóleo, isquiotibiales o aductores | Complemento según necesidad: hombro, pantorrilla o aductores |

La potencia puede preceder al principal cuando sea una prioridad y exista experiencia suficiente. Una activación breve se diferencia del core de trabajo. El acondicionamiento se añade sólo si corresponde a la planificación semanal y al tiempo disponible. Los ejercicios principales se conservan para evaluar adaptación; el cambio de variante tiene una razón documentada. Ésta es una propuesta de diseño deportivo para la aplicación, no una prescripción personal cerrada.

**8. Verificación técnica de esta entrega**

Se añadieron regresiones para zancadas, historial, nivel, descarga y dosis. Se actualizaron manualmente tres expectativas de contenido: la selección del escenario principiante y dos prescripciones temporales en el fallback semanal. No se regeneraron masivamente snapshots ni se alteraron IDs del catálogo.

Verificación final:

- **5.084 pruebas aprobadas en 591 archivos**, incluida la suite completa del repositorio, sin aumentar timeouts. La nueva cobertura contiene 23 casos.
- **Build completo, TypeScript y lint global aprobados.**
- **576 selecciones auditadas**, sin infracciones de los contratos comprobados y con las observaciones pendientes cuantificadas arriba.
- El barrido intermedio de 161 archivos detectó únicamente dos expectativas temporales antiguas en el mismo snapshot; se corrigieron tras inspeccionar el diff.
- No se modificó la interfaz, por lo que esta entrega no incluye una validación visual de una pantalla nueva. No se hizo despliegue.

Archivos de apoyo: [resultados de la auditoría](2026-09-10-strength-selector-audit.json), [script reproducible](../../scripts/audit-strength-selector.mjs) y [regresiones del selector](../../src/services/training/__tests__/strengthSelectorQuality.test.ts).


---

**9. Endurecimiento posterior a la revisión — 10 de septiembre de 2026**

Una segunda pasada sobre el mismo árbol de trabajo encontró catorce defectos, todos corregidos en esta entrega. Los cinco primeros son alcanzables por un usuario real.

| # | Defecto | Corrección |
|---|---|---|
| 1 | `cinta` como token de nombre exigía `treadmill` y dejaba sin resolver 79 ejercicios cuyo nombre dice «cinta elástica» —que en Chile es una banda—. Un ejercicio con banda propuesto por la IA se eliminaba como `unresolvable_identity`. | Sólo la secuencia completa `cinta_de_correr` nombra la máquina. Resolución con paridad exacta respecto de `1c454f4`. |
| 2 | `full_gym` no declaraba `mini_hurdles` ni `treadmill`: los dos ejercicios de mini valla eran inalcanzables para **todos** los presets, mientras el inventario ausente sí los alcanzaba. | El preset declara los 19 tipos y llega a los 117 ejercicios, como promete su propia documentación. |
| 3 | El freno por competencia y fatiga aguda dependía de tener `athleticPrescription`: cubría 8 de 23 ejercicios de potencia y dejaba pasar `depth_jump`, `drop_jump`, `barbell_jump_squat` y `jump_squat` a dos días de competencia. | `isImpactPowerExercise` (en la biblioteca, junto al catálogo) clasifica por `safety.loadPatterns`. La fase permitida la sigue declarando cada ejercicio; el freno agudo es transversal. |
| 4 | Un retiro por contexto de entrenamiento —taper, fatiga, sesión de menos de 45 min— bloqueaba con `insufficient_safe_pool` y el chat mostraba «no pude verificar una sesión compatible con **la restricción registrada**» a un atleta sin ninguna restricción. | `BlockedReason` gana `training_context_unavailable` con copy propio y un aviso propio. Los cinco consumidores resuelven el copy por razón. |
| 5 | `/finisher\|30/` elegía intervalo con un número suelto: «trotadora curva, 30 min» devolvía la cinta plana. | El intervalo se reconoce por su grafía («30/30», «30 seg in 30 seg out»), no por un dígito. |
| 6 | El fallback del selector era un no-op demostrable: cuando el pool es delgado `pool` ya es `experiencePool`, y `pickStrengthStructure` es determinista. | Relaja **fase**, único eje admisible. Fatiga, restricciones, experiencia y contexto atlético nunca se relajan. |
| 7 | El JSON de auditoría era de 108 ejercicios y §5 citaba sus números junto al comando para reproducirlos. | Regenerado. La tabla distingue ambas fotografías. |
| 8 | `/distancia\|metros/` ascendía pliometría horizontal con objetivos de carrera («correr 10 mil metros»). | El patrón exige nombrar el salto. |
| 9 | Con el nivel principiante acotado a `beginner`, el único candidato `intensityType: 'strength'` del pool es `landmine_press`: la sesión salía sin ninguna sentadilla ni bisagra pese a haber ocho compuestos de pierna elegibles. | El principal admite `hypertrophy` cuando no hay ningún `strength` —`deriveStrengthProgressionState` ya lo hacía y ambos discrepaban— y ambas rutas garantizan un compuesto de tren inferior. |
| 10 | Las ramas de `assault_bike_30_30` y `air_treadmill_20_20` en `getPrescription` eran inalcanzables. | Eliminadas. La variante de 2 bloques se retira explícitamente: un finisher es un bloque. |
| 11 | `resolveTargetPercent1RM` derivaba el estado de progresión por ejercicio, recorriendo todo el historial N veces por sesión. | El estado se calcula una vez por sesión y viaja hacia abajo. |
| 12 | La disyunción final de `shouldIncludeSpecificCardio` era inalcanzable tras el gate de fase. | Eliminada: un pedido explícito no sobrepasa la fase, y ahora la regla lo dice. |
| 13 | `buildExerciseNotes` devolvía la nota atlética antes que las de competencia y fatiga. | Las notas de contexto tienen precedencia. |
| 14 | El relleno de la ruta de plantillas no tenía tope de core ni cobertura de pierna: llenaba con cores los slots sin candidato. | Tope por `getTargetCoreCount` y garantía de compuesto inferior. `overTwoCore` cae de 276 a 37 sobre 720 sesiones. |

Verificación de esta pasada: **5.166 pruebas en 593 archivos**, `tsc -b`, lint y build en verde; **720 sesiones auditadas sin violaciones**. Las 36 regresiones nuevas viven en `athleticTrainingHardening.test.ts`. Un snapshot de selección se actualizó tras revisar sus siete filas una por una: aparece trabajo real de pierna en base, competencia cercana y principiante. Sin despliegue.
