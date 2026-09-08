# Revisión y correcciones de la implementación de máquinas

Se contrastó el resumen de implementación con el workspace y se corrigieron ocho hallazgos. No se implementó la segunda tanda de 15 ejercicios ni se hicieron commits o despliegues.

| Prioridad | Hallazgo | Corrección |
|---|---|---|
| Alta | El finalizador conservaba ejercicios de IA aunque requirieran equipo ausente. El filtro sólo protegía selección y reemplazos. | Verifica disponibilidad al conservar contenido y al finalizar; sustituye por candidatos compatibles o descarta/bloquea si no existe una sesión viable. |
| Alta | `buildStrengthSafetyContext`, usado en aceptación y creación semanal, no transmitía el equipamiento actual. | Propaga el inventario desde AthleteProfile. Se probó aceptación tras cambiar el inventario y revalidación de una sesión ya sellada. |
| Alta | Un inventario enteramente desconocido, como «elíptica», habilitaba todos los equipos. | Sólo ausencia de declaración conserva el comportamiento antiguo. Una declaración no interpretable no habilita equipo supuesto; conserva sus términos en unrecognized. |
| Alta | «Bench press machine» evadía el guard por falta del token inglés machine. | Agregados machine/machines, dumbbells, band/bands y negación without. Regresiones verifican que no se resuelva a banca libre. |
| Media | Las máquinas compuestas nuevas seguían exponiendo porcentajes de 1RM sin referencia, aunque no derivaran kilos. | Se suprime el porcentaje para máquinas sin loadReference, además de aislamientos. También corrige dominada asistida, jalón y remo apoyado existentes. No migra sesiones históricas; actúa cuando se vuelve a completar una prescripción. |
| Media | «Personalizado» no abría los controles cuando el inventario coincidía con un preset; volver a coincidir podía ocultarlos. | Estado explícito de edición personalizado, independiente de la coincidencia del inventario. Probado en el wizard real. |
| Media | El preset «En casa» anunciaba mancuernas/bandas/peso corporal, pero añadía fitball y balón medicinal. | Inventario reducido al material anunciado. |
| Media | La búsqueda no indexaba equipment, pese a lo propuesto en el diseño. | Indexa códigos y etiquetas en español. «Jalón máquina», «jalón poleas» y «jalón cable» recuperan lat_pulldown. |

## Validación

- Primera pasada dirigida: 64 pruebas, 5 archivos, en verde.
- Barrido ampliado: 569 pruebas, 67 archivos, en verde. Incluye catálogo, seguridad, referencias, selectores, aceptación, wizard, roles de repetición y `strengthAllocatorDomain`. No se aumentó timeout.
- Última pasada después de completar búsqueda: 90 pruebas, 7 archivos, en verde. Los conteos de estas pasadas se solapan: no deben sumarse.
- Lint global pasó antes del último ajuste de búsqueda; se ejecutó además lint dirigido sobre todos los archivos de esta corrección.
- Se actualizaron dos snapshots por cambios intencionales: eliminación de targetPercent1RM en ocho identidades sin referencia de máquina y una aparición de remo apoyado en el fallback del creador semanal. Se inspeccionó el diff antes de actualizarlos.
- `tsc -b` pasó durante la primera fase. El intento posterior de build global quedó bloqueado por modificaciones concurrentes en `squashSessionHydrator.ts`: `minimumDrillCount` y `mainDrills` sin uso. No se modificó ese archivo en esta revisión.
- Un barrido inicial también encontró `sessionDose.test.ts` importando un materializador todavía inexistente. Posteriormente aparecieron esos módulos como parte del trabajo de squash/running. Se excluyó ese test del barrido de esta entrega de fuerza; no se afirma que la suite global del workspace esté verde.

## Límites y pendientes

- `machine` continúa siendo disponibilidad por familia, no inventario de máquinas individuales: decisión aceptada para el piloto.
- El test del allocator pasó en el barrido de revisión, pero esto no constituye un benchmark ni demuestra resuelto el margen de rendimiento descrito en el resumen. Antes de sumar E7 conviene perfilar con entradas fijas y equipo restringido.
- Declaraciones desconocidas conservan diagnóstico en `unrecognized`; no se añadió una interfaz de resolución de texto libre. El wizard actual usa opciones canónicas.
- No se reemplazaron ni revirtieron cambios ajenos de squash/running presentes en el workspace.

## Validación del commit aislado

Antes de publicar se exportó el índice de Git a una carpeta temporal, incluyendo únicamente los 37 archivos de pesas y los dos cambios de equipamiento del archivo compartido del chat. Esa copia independiente pasó build completo (incluido TypeScript), lint y 571 pruebas en 67 archivos. Esto confirma que los bloqueos globales señalados arriba pertenecían al trabajo concurrente de squash/running, que quedó fuera del commit.
