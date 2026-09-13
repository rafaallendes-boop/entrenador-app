# Cierre de pendientes de la biblioteca de pesas

## Decisiones y resultado

Se completó E7 después de perfilar el camino real de reparación semanal. El catálogo pasa de 93 a 108 ejercicios: 77 originales y 31 incorporaciones entre las dos entregas. Se mantiene el inventario por familias para el piloto; no se incorpora una pantalla para inventariar cada máquina.

Las 15 altas son press inclinado, hack squat, glute drive, patada de glúteo, curl de bíceps, extensión de tríceps, fondos asistidos y elevación lateral en máquina; curl, face pull, aperturas y jalón de brazos rectos en polea; sentadilla, banca y press inclinado en Smith. Cada una tiene identidad permanente, alias español/inglés, regiones y patrones de carga, dificultad, fatiga y fases explícitas. Se prescribe RPE, sin convertir 1RM de barra en kilos o porcentajes de máquina, polea o Smith. En fondos asistidos la descripción aclara que aumentar la asistencia reduce la dificultad.

Las familias de máquinas se contrastaron con catálogos del fabricante [Life Fitness](https://www.lifefitness.com/en-us/catalog/strength-training/plate-loaded) y [Hammer Strength](https://www.lifefitness.com/en-us/brands/hammer-strength). Esta referencia confirma la existencia de las variantes; no constituye validación clínica de sus metadatos de seguridad.

## Hallazgos resueltos durante esta entrega

1. **Normalización repetida en la resolución por nombre.** El perfil de CPU mostró que era el costo dominante en la reparación, corrigiendo la hipótesis anterior que atribuía todo el costo a filtrar/puntuar. Se construyen índices de nombres y alias una vez. Se conserva el orden de precedencia y la lista completa de candidatos ambiguos.
2. **Hasta cinco aislamientos en el selector sin bloques.** El límite de dos protegía sólo el relleno por bloques. Se aplica también a slots y al selector sin bloques, completando los huecos con candidatos compatibles. Un aislamiento continúa sin ser elegible como levantamiento principal.
3. **Inventario desconocido sin vía visible de corrección.** El wizard muestra los términos no reconocidos, presenta las opciones canónicas y exige al menos una disponible antes de continuar. Un preset o la selección personalizada permite corregirlo. La ausencia de declaración conserva la compatibilidad anterior.

## Rendimiento reproducible

Ejecutar `node scripts/benchmark-strength.mjs ruta-del-reporte.json`. No invoca proveedores de IA ni bases de datos. Usa un calentamiento y tres mediciones, con mediana, huella de contenido y perfil de CPU. Normaliza únicamente los UUID de superseries para conservar sus agrupaciones en la comparación.

La comparación se hizo en una exportación aislada de `b82a603`, primero sin cambios, luego con el índice sobre los mismos 93 ejercicios y finalmente con E7 y el límite de aislamientos. Los reportes JSON históricos se retiraron el 2026-09-12 al depurar el trabajo ya implementado; la tabla siguiente conserva el resumen de esas mediciones.

| Trabajo | Antes (93) | Sólo índice (93) | Entrega completa (108) |
|---|---:|---:|---:|
| 192 selecciones | 11 ms | 11 ms | 13 ms |
| Reparar seis semanas × cuatro inventarios | 1.564 ms | 353 ms | 259 ms |

El índice reduce un 77% la mediana de reparación con resultados iguales: coinciden las dos huellas antes/después de indexar. La comparación con 108 cambia contenido deliberadamente por las nuevas opciones y el límite de aislamientos; no se atribuye su diferencia de tiempo exclusivamente al índice. Son mediciones locales, no un SLA ni garantía de tiempos en todos los equipos. El inventario restrictivo del fixture puede bloquear sesiones sin un pool viable: se conserva el filtro de disponibilidad. Para evitar confundir menos trabajo con mayor rendimiento, el reporte cuenta sesiones devueltas (incluidas las complementarias que añade la reparación) y ejercicios: antes/índice mantienen 65 y 131 respectivamente; E7 devuelve 72 y 179.

## Compatibilidad y verificación

Los snapshots se ampliaron únicamente con 15 filas nuevas, comprobando primero que las 93 filas existentes fueran idénticas. No se regeneró masivamente el contrato. La expectativa antigua de que Smith no pudiera resolver ahora verifica su identidad propia; no se debilitó el guard de equipamiento.

La regresión nueva recorre 192 combinaciones de inventario, fase, perfil, fatiga y uso de bloques. Verifica disponibilidad y máximo de dos aislamientos. Comprueba asimismo los alias y el esfuerzo sin carga heredada de las 15 altas. El wizard tiene una prueba de corrección de inventario desconocido.

Validación final en la copia aislada:

- **4.917 pruebas en 579 archivos, todas aprobadas.** Incluye `strengthNormalization.test.ts`, cuyo fixture productivo de seis semanas exige ausencia de `quality.strength.repeated_template`, y `strengthAllocatorDomain.test.ts`, sin elevar timeouts.
- **Build completo, TypeScript y lint aprobados.**
- La primera corrida completa tuvo fallos de infraestructura porque la exportación no incluía `.git` ni variables de Supabase, además de dos expectativas antiguas del catálogo. Se inicializó Git sólo en la copia temporal, se usaron valores ficticios de Supabase para los clientes simulados y se corrigieron las expectativas de Smith/conteo. La segunda corrida completa pasó; no se usaron credenciales reales ni API de IA.
- Los tres benchmarks usan exactamente el mismo script y la misma base aislada, variando únicamente índice/catálogo/selector. Las firmas de las dos primeras variantes coinciden.

## Límites conservados

- La familia `machine` sigue declarando máquinas en general, no un inventario individual. El usuario debe elegir un preset que represente su entorno.
- El registro estructurado de kilos de asistencia por separado de kilos externos requiere otro cambio de modelo e historial; esta entrega explica la dirección de la asistencia y prescribe esfuerzo sin inventar kilos.
- No se migran sesiones históricas ni inventarios guardados.
- La validación aislada contiene sólo estos cambios de pesas. El trabajo concurrente de squash/running permanece fuera de esta entrega.
