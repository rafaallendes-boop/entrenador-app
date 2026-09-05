# Plan Builder — verificación local de precisión

Fecha: 2026-09-04. Alcance: las 11 tareas de
[2026-09-02-plan-builder-precision.md](../plans/2026-09-02-plan-builder-precision.md).
Se completó la implementación parcial existente, conservando los demás cambios
del working tree. Sin commit, deploy ni llamadas pagadas al proveedor.

## Cambios completados

- Prompts individuales y por pares: definición de listo, directiva por semana,
  limitante de rendimiento y meta de partidos resuelta por política.
- Contexto de recalibración: semanas completas vividas, datos autoreportados y
  muestras reales de RPE; se excluyen los prellenados de Whoop de las señales.
  El motor local y el remoto reciben el corte temporal adecuado.
- Repair: separación de duras cruzadas en 5b antes de anclar fuerza; busca un
  día alternativo aunque el hueco más cercano contenga otra dura. El gate de
  calidad bloquea los residuos y también se verifica antes de recalibrar el calendario.
- Meta de partidos: el repair consume el conteo y no termina al encontrar el
  primer partido. Build/peak sin fatiga limitante usan RPE 8, hasta cuatro
  sesiones dentro del cupo. Base y `loaded` conservan una exposición moderada;
  los vetos y fases de descarga siguen vigentes. Una directiva real de
  reducir/mantener inhibe la meta para no elevar de nuevo el RPE en el repair.
- Recalibración: sólo semanas futuras, preservación de manuales/completadas,
  rollback de semanas aplicadas y avisos visibles. Polling y sync conservan el
  marcador local; se recupera tanto una corrida remota terminada como una que
  sigue generándose, y también una confirmación de enqueue perdida. Al volver
  a abrir la página se excluyen semanas que ya dejaron de ser futuras.
- Perfil/wizard: `performanceLimiter` separado de lesiones y
  `targetHardPrimaryMatches` opcional persistido y propagado a Week Creator.
  El RPE planificado no cuenta como muestra de ejecución real.

## Verificación

- Primera revisión del área sobre el árbol recibido: 123 archivos / 825 tests,
  todos correctos. La lectura del código identificó huecos sin cobertura.
- Regresiones nuevas: motor local, marcador de polling, recuperación remota,
  protección de semana en curso, confirmación perdida, gate al materializar,
  búsqueda de fecha alternativa, conteo real de partidos, batch y RPE real.
- `npm test`: **544 archivos / 4392 tests**, todos correctos. La referencia
  del plan era 510 / 4088; el total actual incluye también los cambios ajenos
  a esta tarea que ya estaban en el working tree.
- `npm run lint`, `npx tsc -b`, `npm run build` y `git diff --check`: correctos.
- `src/services/ai/promptBuilder.ts` no tiene cambios.
- `npm run e2e:plan`: la app cargó, pero el runner se detuvo en autenticación.
  El estado guardado venció el 2026-05-25; no llegó al wizard ni al builder.
  Requiere renovar la sesión con `npm run e2e:plan:headed` antes de repetir.

## Pendientes de validación operacional

No se ejecutaron la recalibración real contra el proveedor, la generación para
observar la meta del wizard ni `npm run e2e:plan:readiness`: el plan exige
confirmar saldo antes de esas verificaciones. Tampoco se desplegó.

La recuperación durable es del mismo navegador. El marcador no se transporta
a Supabase y no demuestra reconciliación entre dispositivos. La verificación
local usa proveedores simulados; no mide calidad/latencia de generación real.
