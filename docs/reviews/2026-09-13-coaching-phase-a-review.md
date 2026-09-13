# Revisión de cierre — coaching intelligence, Fase A

Fecha: 2026-09-13. Base inspeccionada: `d09eb24`, checkout inicial
`codex/coach-entrega-2`. El plan estaba implementado con cambios staged y
unstaged; `main` y `origin/main` estaban en `9da765b`. La base incluye Entrega 2.

Se contrastaron el plan, el spec, el ledger SDD, los cambios productivos y sus
regresiones. No se ejecutaron llamadas pagadas a proveedores ni smoke remoto.
Los documentos de onboarding/Whoop, la revisión de fuerza y los tres borrados
de benchmarks preexistentes quedan fuera de este commit.

## Hallazgos corregidos

| Prioridad | Problema reproducible | Corrección y evidencia |
|---|---|---|
| Alta | `resolveRequestTargetAthleteId(null)` adoptaba el holder vivo después de capturar la identidad. La nota semanal tampoco pasaba el destino y podía enviar después de un cambio durante sus lecturas. | `null` explícito permanece fijado; sólo `undefined` consulta el holder. Nota con guard previo al envío y destino capturado. `requestTarget.test.ts`, `useTrainingStoreCoachNoteScope.test.ts`. |
| Alta | Cambiar de atleta durante `addProposal` permitía enlazar/publicar la respuesta del atleta anterior; el camino de error también podía publicar en el nuevo scope. | Revalidación de scope después de las escrituras y antes de publicar errores, limpieza de artefactos tardíos y liberación del loading sólo por su dueño. `useChatStoreRequestScope.test.ts`. |
| Media | Las ramas locales de intención pendiente corrían antes del lock y del guard de scope. Una llamada ocupada o caduca podía cancelar/consumir una intención. | Guards antes de cualquier mutación local. `useChatStorePendingIntent.test.ts`. |
| Media | Una aclaración incompleta absorbía preguntas nuevas; cualquier `no` dentro de una frase cancelaba la intención. | Compatibilidad explícita con confirmaciones, referentes breves y verbos de la operación; negación anclada a respuestas breves. Preguntas sobre sueño/comida siguen su ruta normal. Tests de pendingIntent y del store. |
| Media | Una aclaración local persistía sólo la respuesta del coach, dejando un turno huérfano. | Persistencia de usuario y coach con lock, limpieza ante cambios de scope/hilo y manejo del fallo de escritura. Test del store para el par persistido. |
| Media | Crear semana omitía el gate de entitlement del cliente. | Gate cubre `chat_action` y `week_creator`; servidor conserva autoridad. Test de página `chatCoachWhoopBlockScope.test.tsx`. |
| Media | Cambiar de plantilla comparaba la nueva dosis contra la plantilla recién seleccionada, ocultando el cambio real. | Diff contra la estructura original persistida. Regresión de 11 repeticiones a trabajo continuo. |
| Media | La vista previa de una sesión existente rematerializaba con el perfil vigente y `hold`, aunque al guardar se conservara `progress`. | Edición muestra la estructura guardada/aprobada. Altas previsualizan con la intención de la receta. Test visual de las 11 repeticiones guardadas. |
| Media | Seleccionar «Sesión personalizada» permitía eludir el bloqueo de duración/receta de una sesión completada. | Guard independiente de que la receta todavía tenga `templateRef`. Regresión de sesión completada. |
| Media | Recalcular podía dejar ritmos heredados de tarjeta incompatibles con los nuevos bloques. | También se validan los ritmos sin editar cuando hay recálculo aprobado; se pide corregirlos antes de guardar. Regresión del formulario. |
| Media | Un error de red durante el retry de formato perdía el número total de intentos. | Contador propagado también cuando falla esa llamada. `CoachEngine.test.ts`. |
| Media | La etapa `repair` medía toda la evaluación y aparecía incluso si no había acciones que reparar. | Medición en la llamada real a `repairGeneratedWeek`; resultado inválido sin etapa ficticia. `generateWeekCore.test.ts` y prueba de fronteras existente. |
| Baja | Eventos con discriminador alternativo `action` se admitían en el desempaquetado pero se rechazaban en su clasificación/validación. | Discriminador uniforme; test con dos eventos sin acciones deportivas ni parse failure. |
| Media | La supuesta flake del audit era drift determinista del prompt de esta fase: 562 → 730 tokens aproximados. | Referencia actualizada con justificación, tolerancia conservada al 10%. No se desactiva el guard ni se atribuye la falla a código ajeno. |
| Baja | El roadmap omitía la precondición real del smoke de edición de running. | Cuenta coach operativa tras Entrega 2 (§6), por la limitación de UI de §25. |

Las correcciones anteriores sustituyen los aplazamientos de T5/T9 y los
seguimientos de cierre correspondientes del ledger histórico. Ese ledger se
conserva en `.superpowers/sdd/2026-09-12-coaching-intelligence-phase-a/`.

## Validación final

- `npm test`: **612/612 archivos, 5406/5406 tests**, 107,15 s. Sin excepciones.
- `npm run lint`: exit 0.
- `npm run build`: exit 0, incluye `tsc -b`. Avisos informativos existentes
  de Browserslist y release local `dev`; no impiden el build.
- `git diff --check`: limpio.
- Rama de entrega: `codex/coaching-intelligence-phase-a`, desde `d09eb24`.

## Límites y continuación

La Fase A queda validada localmente; producción requiere deploy y smoke.
El matching por deporte/título, campos de aclaración más amplios y el límite
de seis sesiones siguen perteneciendo a B4. La paridad final del gate depende
de que la página y el store dispongan de las mismas sesiones; el servidor
sigue verificando los permisos. No se declara resuelto el editor de sesiones
para cuentas de atleta (§25).

Antes de B1, decidir D1–D6 del §9 del spec (experiencia, desconocidos,
retorno, recuperación, edad y significado de fatiga). Luego implementar la
captura de fuentes B2 que consume B1, integrar el resolver compartido y
continuar B3/B4 con regresiones por recorrido.
