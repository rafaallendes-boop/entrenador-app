# Squash: modalidad explícita y eventos multijornada

Fecha: 2026-08-10  
Estado: propuesta para revisión, sin implementación  
Orden acordado: 1) control/técnico en todos los flujos; 2) evento multijornada

## 1. Resumen y recomendación

Son dos problemas independientes y deben desplegarse por separado.

1. **Modalidad de una sesión de squash.** La modalidad debe viajar como dato
   estructurado desde el origen de la propuesta hasta la hidratación local. El
   título, el objetivo y `focusKey` son texto descriptivo y nunca vuelven a ser
   autoridad para decidir si los drills son solos o con partner.
2. **Evento multijornada.** Un evento gana fecha de inicio, fecha de término y
   día clave opcional. La preparación termina al comenzar el evento; la fase
   `race` abarca toda la ventana, y el plan termina cuando termina el evento.

La primera entrega debe cubrir Plan Builder, Crear semana, crear/editar una
sesión por chat y el formulario manual. Implementar sólo el Plan Builder dejaría
cuatro contratos distintos capaces de producir el mismo bug.

No se recomienda incluir en la primera entrega la disponibilidad semanal de
partner ni ampliar los pools técnico, sombras o match. Sí debe ampliarse el pool
de control dentro del Proyecto A: endurecer la modalidad con el catálogo actual
dejaría sólo cuatro opciones elegibles en build/peak y haría inviable la rotación
sin repeticiones o fallos de calidad.

## 2. Evidencia del problema actual

En el plan revisado, una sesión titulada "Puntos Condicionados: Solo zona
cruzada" y cuyo objetivo hablaba de "control de longitud" terminó con drills de
100 repeticiones en solitario. La sesión descrita era con partner; la selección
local cambió su naturaleza porque `repairWeek.ts` encuentra la palabra
`control` en el texto visible.

La ruta actual tiene tres autoridades que pueden contradecirse:

- el proveedor decide título, objetivo, `subtype` y, según el flujo, `focusKey`;
- `repairWeek.ts` vuelve a decidir la modalidad leyendo palabras del título y
  el objetivo;
- `drillLibrary.ts` deduce la modalidad de varios drills desde tags y defaults
  incompletos.

Además, `partnerAvailability` existe y el selector lo consume, pero es opcional
y normalmente llega como `either`. No resuelve la distinción de dominio.

El cruce actual entre modalidad y `isPhaseAllowed` muestra otro límite de la
misma corrección:

| Modalidad actual | Base | Build | Peak | Taper |
|---|---:|---:|---:|---:|
| `control` | 8 | 4 | 4 | 8 |
| `technical` | 12 | 26 | 26 | 8 |
| `shadows` | 3 | 3 | 3 | 0 |
| `match` | 0 | 3 | 3 | 1 |

Después de reclasificar los tres drills cooperativos, control cae a cinco en
base/taper y conserva sólo cuatro en build/peak. El plan revisado ya repite el
mismo tríptico durante tres semanas. La mezcla accidental de modalidades estaba
ocultando una insuficiencia real del catálogo.

## 3. Objetivos

### 3.1 Modalidad de squash

- Distinguir de forma estable control solo, técnico con partner, sombras y
  partido.
- Obtener la misma composición ante la misma intención en Plan Builder, Crear
  semana, chat y formulario manual.
- Evitar que una palabra como "control" dentro de "control de longitud" cambie
  la modalidad.
- Hacer explícita y auditable la clasificación de cada drill.
- Asegurar capacidad de rotación del pool de control en build/peak sin cruzar
  modalidad ni disparar fallos de unicidad de firma.
- Conservar sesiones históricas y backups sin migración destructiva.

### 3.2 Evento multijornada

- Capturar inicio, término y día clave opcional.
- Preparar al atleta para el inicio del campeonato, no para un único día duro.
- Mantener la fase competitiva durante toda la ventana.
- Dentro de la ventana, limitar el contenido complementario a activación,
  recuperación y un toque técnico corto.
- Conservar el comportamiento actual para eventos de un solo día.

## 4. No objetivos

- No modelar en esta versión cada partido, horario, rival o cuadro del torneo.
- No asumir que el día clave es el único día de competencia.
- No convertir `partnerAvailability` en una promesa rígida para todo un plan
  mensual.
- No ampliar en esta entrega los pools técnico, sombras o match. La ampliación
  mínima del pool de control sí forma parte del Proyecto A porque es una
  precondición operativa de la regla nueva.
- No reinterpretar automáticamente sesiones históricas a partir de su texto.
- No mezclar la implementación de modalidad y la de calendario en un mismo PR.

## 5. Vocabulario de dominio

### 5.1 Modalidad principal de una sesión

| Modalidad | Definición | Modalidad de ejecución de los drills principales |
|---|---|---|
| `control` | Volumen y repetición con pelota en solitario: paralelas, revés, drops, media cancha, voleas, etc. | `solo` |
| `technical` | Trabajo cooperativo o condicionado con partner: paralelas rotando, pasillos, cambios de lado, patrones y decisiones. | `partner` |
| `shadows` | Desplazamientos o acondicionamiento específico sin pelota. | `solo` |
| `match` | Partido, juego o simulación con rival y marcador. | `match` |

`control` describe una **modalidad de sesión**. No significa que el texto no
pueda usar expresiones como "control de longitud" dentro de una sesión técnica.

### 5.2 Modalidad principal y bloques accesorios

`SquashDetails.sessionKind` pasa a significar la modalidad principal, no la
unión matemática de todos los bloques. Las combinaciones nuevas permitidas son:

- `control` con un bloque accesorio de `shadows`, antes o después;
- `technical` con un bloque accesorio de `shadows`;
- `technical` con un cierre corto de `match`, cuando las reglas de fase lo
  permitan;
- `match` con una activación breve de `shadows`.

No se genera una sesión nueva que mezcle bloques de pelota `control` y
`technical`. Eso mezclaría solo y partner en la parte principal. El valor
persistido `mixed` se conserva sólo para leer datos históricos y para casos
completos ya existentes; no se ofrece como intención en los contratos compactos
nuevos.

El orden de `shadows` no es una regla de identidad. Puede ir al comienzo o al
final según el protocolo; ambas variantes son válidas.

## 6. Fuente única de verdad para modalidad

Se reutiliza `SquashSessionBlockKind` (`control | technical | shadows | match`)
como tipo de intención. No se crea otro enum equivalente.

En los bordes de generación y acciones se usa el campo compacto:

```ts
squashKind?: SquashSessionBlockKind
```

El campo es obligatorio en runtime cuando `sessionType === 'squash'`. Puede ser
opcional en el tipo general porque el objeto también representa otros deportes
y algunos proveedores no soportan reglas condicionales de JSON Schema.

La persistencia canónica sigue siendo:

```ts
session.squashDetails.sessionKind
```

`squashKind` es una intención de frontera. El materializador la consume y no
agrega una segunda fuente persistida de verdad en `Session`.

### 6.1 Precedencia de lectura

Para datos nuevos:

1. elección explícita del usuario en el formulario o en la petición actual;
2. `squashKind` estructurado de la propuesta;
3. `squashDetails.sessionKind` válido en una propuesta detallada;
4. compatibilidad heredada: `subtype=control|match|competitive`;
5. default determinista `technical`.

Ningún paso lee `title`, `objective` ni `focusKey` para resolver la modalidad.
`subtype=training` tampoco intenta adivinar: cae en `technical`.

### 6.2 Relación con `subtype`

`subtype` mezcla hoy modalidad, contexto competitivo e intensidad. Se conserva
por compatibilidad, pero deja de ser la autoridad principal.

Proyección al guardar:

| `squashKind` | `subtype` compatible por defecto |
|---|---|
| `control` | `control` |
| `technical` | `training` |
| `shadows` | `training` o `light`, según RPE/duración |
| `match` | `match` o `competitive`, según `sessionMode` |

No se elimina `light` en esta entrega. A futuro, la carga ligera debería vivir
en duración/RPE y no como modalidad.

## 7. Catálogo e invariantes de drills

Cada `SquashDrillDefinition` debe declarar explícitamente:

```ts
sessionKind: SquashSessionBlockKind
executionMode: SquashDrillExecutionMode
```

`resolveSquashDrillKind` y `resolveDrillExecutionMode` leen esos campos. Los
tags siguen sirviendo para búsqueda, fase, fatiga y scoring, pero no deciden la
identidad. `partnerRequired` se mantiene durante la transición y debe ser
coherente con `executionMode`; después puede deprecarse.

`either` no es una modalidad válida de ejecución para una definición del
catálogo. Los tipos de dominio quedan separados:

```ts
type SquashDrillExecutionMode = 'solo' | 'partner' | 'match'
type SquashPartnerAvailability = 'solo' | 'partner' | 'either'
```

`either` sobrevive sólo como disponibilidad del atleta. El test de tabla falla
si una definición nueva intenta declararlo. Datos históricos que ya persistan
`executionMode='either'` se aceptan en lectura y se normalizan desde la
definición canónica; nunca se vuelven a escribir con ese valor.

Correcciones mínimas ya identificadas:

- `Drop y contra-drop por ambos lados`, `Peloteo profundo suave de recuperación`
  y `Drops desde media cancha` pasan de control a técnico/partner;
- los drills técnicos cooperativos actualmente marcados `either` pasan a
  `partner`;
- el acondicionamiento específico sin pelota pasa a `shadows/solo` y no a
  técnico;
- los cinco drills de 100 repeticiones verificados permanecen
  `control/solo`.
- los tres drills de sombras quedan explícitamente habilitados para taper,
  sujetos a los topes de fatiga, duración y RPE de esa fase.

El audit debe revisar los drills uno por uno y producir un test de tabla. No se
acepta reemplazar una inferencia textual por otra inferencia basada en
`category`.

### 7.1 Capacidad mínima del pool de control

La ampliación de control ocurre después de clasificar el catálogo y antes de
endurecer el selector. Su criterio no es sólo un conteo bruto:

- al menos nueve drills `control/solo` elegibles en build y peak, suficientes
  para tres trípticos consecutivos sin repetir firma;
- al menos seis opciones de control seguras para taper;
- cobertura de las familias indicadas por el usuario: drives paralelos de
  derecha y revés, drops, media cancha, voleas y variaciones de volumen/objetivo;
- una simulación de 4, 8 y 12 semanas no produce firmas idénticas consecutivas
  ni `quality.squash.signature_uniqueness_unresolved` por falta de pool.

Los nombres, instrucciones y protocolos de los drills nuevos se aprueban en una
tabla de contenido acotada dentro de esta tarea. La expansión de los otros pools
permanece posterior.

### 7.2 Fallback del selector

Cuando el pool de una modalidad es pequeño, el selector puede relajar rotación
y reutilizar un drill reciente. No puede relajar la modalidad principal. En
particular:

- `control` nunca cae a un bloque técnico con partner;
- `technical` nunca cae a repeticiones de control solo;
- si no hay un mínimo ejecutable, devuelve una advertencia estructurada y una
  plantilla segura de la misma modalidad o falla la validación;
- no se usa el texto visible para corregir el resultado.

La reutilización es la última defensa, no el diseño normal del pool. La
ampliación anterior debe impedir que los planes ordinarios dependan de ella.

## 8. Hidratación compartida

Debe existir un servicio puro compartido, por ejemplo
`squashSessionHydrator.ts`, que reciba intención, fase, duración, fatiga,
historial y disponibilidad conocida, y produzca `subtype` y `squashDetails`
coherentes.

El mismo servicio se usa desde:

| Superficie | Entrada | Comportamiento esperado |
|---|---|---|
| Plan Builder | `CoachSessionProposal.squashKind` | `repairWeek` hidrata sin inferencia de prosa. |
| Crear semana | `WeekCreatorSkeletonSession.squashKind` | El skeleton v2 preserva la intención antes del normalizador genérico. |
| Chat: crear/editar sesión | `CoachAction.squashKind` | El postprocesado hidrata localmente una sesión compacta. |
| Formulario manual/plantilla | selector explícito | El serializador persiste la modalidad elegida y valida drills conocidos. |

`focusKey` continúa orientando foco y scoring (`length`, `pressure`, etc.), pero
no modalidad. Una sesión puede tener `focusKey=squash_length_control` y
`squashKind=technical` sin contradicción.

## 9. Comportamiento por superficie

### 9.1 Plan Builder

- El schema compacto agrega `squashKind`.
- El prompt exige el campo en cada sesión de squash y explica las cuatro
  definiciones.
- `repairWeek` elimina `inferSquashDesiredKind` y cualquier fallback por palabras.
- Si el proveedor omite el campo, el normalizador aplica la cascada de §6.1,
  registra fallback y continúa para mantener resiliencia.
- Si los detalles recibidos contradicen `squashKind`, la hidratación local
  reconstruye los detalles y registra reparación correctiva.

Caso de regresión obligatorio: una sesión `technical` cuyo objetivo contiene
"control de longitud" conserva drills `partner`.

El default `technical` existe sólo para tolerar una respuesta antigua,
incompleta o truncada. Una tasa sostenida o alta de ese fallback es un bug del
prompt/contrato y debe generar alerta; no se considera una ruta normal de
generación.

### 9.2 Crear semana

- `WeekCreatorSkeletonSession` agrega `squashKind` y el contrato pasa de v1 a
  v2.
- Parser y schema exigen el campo condicionalmente para squash y lo rechazan en
  otros deportes.
- El hidratador local pasa el campo al servicio compartido.
- Se elimina `inferSquashSubtypeFromFocus` como autoridad de modalidad. El
  `focusKey` puede seguir anexando intención deportiva legible al objetivo.
- `WEEK_CREATOR_CONTRACT=detailed` sigue siendo rollback operativo; las
  respuestas detalladas también deben normalizarse con las mismas invariantes.

### 9.3 Crear o editar una sesión por chat

- Los contratos `add_session` y `update_session` aceptan `squashKind`.
- Para una nueva sesión de squash el campo es obligatorio en runtime.
- El normalizador lo preserva y el postprocesado llama al hidratador compartido.
- Si el usuario nombra drills concretos, se preserva esa elección cuando los
  drills existen y son compatibles. Una incompatibilidad se presenta como
  advertencia; no se reemplaza silenciosamente una instrucción explícita.

### 9.4 Formulario manual y plantillas

La UI muestra una decisión llamada **Modalidad**:

- Control (solo)
- Técnico (con partner)
- Sombras (sin pelota)
- Partido

Para `match` se mantiene una segunda elección de contexto: entrenamiento o
competencia. RPE y duración expresan si la sesión es suave.

Al crear o editar una sesión, el picker filtra el catálogo por modalidad. Si la
selección contiene un drill conocido incompatible, la UI advierte siempre pero
permite guardar; nunca borra ni reclasifica contenido de forma silenciosa. Los
ejercicios personalizados sin `libraryRef` se aceptan bajo la modalidad
declarada, porque no existe metadata confiable para clasificarlos.

## 10. Disponibilidad de partner

No se agrega una pregunta obligatoria al wizard en esta entrega.

- `technical` siempre significa que la sesión requiere partner, aunque
  `partnerAvailability` sea `undefined` o `either`.
- `control` y `shadows` siempre son ejecutables solo.
- Si existe una restricción explícita `partnerAvailability=solo`, la generación
  de plan no puede producir `technical` ni `match`; debe escoger una intención
  compatible y registrar la sustitución.
- En chat o formulario, una petición explícita del usuario en el momento actual
  prevalece sobre una preferencia histórica del plan y la UI informa el
  requisito de partner.

La planificación por días concretos de partner queda para un spec posterior.

## 11. Modelo de evento multijornada

`GoalEvent.date` se conserva y pasa a documentarse como fecha de inicio. Se
agregan campos opcionales:

```ts
interface GoalEvent {
  date: string       // inicio; compatible con datos actuales
  endDate?: string   // inclusive; ausencia = evento de un día
  keyDate?: string   // inclusive y dentro de la ventana
}
```

Un helper único `resolveGoalEventWindow(event)` devuelve:

```ts
{
  startDate: event.date,
  endDate: event.endDate ?? event.date,
  keyDate: event.keyDate,
}
```

Toda comparación de calendario del Plan Builder usa este helper. Ningún
consumidor nuevo interpreta `.date` por su cuenta.

Validaciones:

- inicio es ISO válido;
- término es ISO válido y `endDate >= date`;
- `keyDate`, si existe, cae entre inicio y término;
- la UI no guarda una ventana inválida.

Eventos existentes, imports y backups sin campos nuevos se comportan como un
evento de un día. No se reescribe el historial.

## 12. Semántica macro y del plan

### 12.1 Fases

- Antes del inicio: el countdown y las fases base/build/peak/taper se calculan
  contra `startDate`.
- Desde `startDate` hasta `endDate`, ambos inclusive: fase `race`.
- Después de `endDate`: fase `transition`.

`weeksRemaining` mantiene la semántica "semanas hasta el inicio": es positivo
antes, cero durante el evento y negativo después del término.

`MacroPlan` conserva `goalEventDate` como alias compatible del inicio y agrega
`goalEventEndDate` y `goalEventKeyDate?`. Los nuevos consumidores usan la
ventana completa. Los marcadores de timeline también muestran el rango.

### 12.2 Ventana del plan

- `buildPlanShell` termina el plan en `endDate`, no en el inicio.
- Toda semana que intersecte la ventana del evento es `race`, incluso si el
  campeonato cruza dos semanas calendario.
- La última semana puede quedar truncada en `endDate`, igual que hoy queda
  truncada en la fecha única.
- El estado del ciclo pasa a post-evento sólo después de `endDate`.
- La firma de un draft incluye inicio, término y día clave para no reutilizar un
  shell construido con fechas antiguas.
- La ventana calendario compartida por el preview y el shell conserva una única
  implementación: `resolveCompetitionPlanCalendarWindow` se exporta o se mueve
  a un módulo común. No se crea una segunda versión para eventos multijornada.

## 13. Reglas de generación dentro del evento

Para squash, la ventana completa es una envolvente de carga competitiva. No se
inventan días de partido que el usuario no declaró.

1. Se crea un único ancla de competencia en `keyDate` cuando existe; si no,
   `startDate` sirve como ancla representativa del evento.
2. El ancla no significa que ése sea el único partido. Su objetivo es reservar
   carga y hacer visible el campeonato en el calendario.
3. En toda la ventana quedan prohibidos fuerza pesada, intervalos de running,
   ciclismo de carga y match-play extra de entrenamiento.
4. Además del ancla se permiten como máximo dos apoyos por semana calendario:
   activación, recuperación o toque técnico corto.
5. El día clave no recibe otra sesión salvo una activación explícita muy breve
   y sólo si el producto decide representarla como doble sesión.

Topes iniciales recomendados:

| Contenido | Duración | RPE | Modalidad |
|---|---:|---:|---|
| Activación | 10-20 min | 2-4 | `shadows` o control muy breve |
| Toque técnico | 20-30 min | 3-4 | `technical`; requiere partner |
| Recuperación | 15-30 min | 1-3 | movilidad/recovery |

Si no se conoce disponibilidad de partner, el toque técnico puede aparecer con
la etiqueta "requiere partner"; el plan también puede elegir control/sombras.

Una versión futura puede agregar `competitionDates[]` o agenda de partidos. No
se debe sobrecargar `keyDate` para representar esa lista.

## 14. UI del evento

En la creación/edición del evento:

- **Inicio del evento**: requerido;
- **Término del evento**: opcional, inicialmente igual al inicio;
- **Día clave**: opcional, con ayuda "día en que esperas los partidos más
  exigentes".

Resumen y dashboards muestran:

- un día: `9 sep 2026`;
- varios días: `5–11 sep 2026`;
- día clave, si existe: `Día clave: 9 sep`.

Onboarding puede seguir creando eventos de un día si no expone los campos
avanzados de inmediato, pero cualquier editor posterior debe preservar
`endDate` y `keyDate`.

Crear semana también consume la ventana completa. En particular,
`WeekCreatorPromptBuilder.ts` debe describir timing/rango y
`WeekCreatorLocalHydrator.ts` debe usar el resolver común para no tratar como
post-evento una fecha que todavía cae dentro del campeonato. `OnboardingPage.tsx`
debe al menos preservar los campos aunque inicialmente no los exponga.

## 15. Compatibilidad, rollout y telemetría

### 15.1 Modalidad

- lectura dual de propuestas antiguas sin `squashKind`;
- escritura nueva siempre estructurada;
- skeleton de Crear semana versionado como v2;
- métricas por origen: modalidad declarada, fallback usado, contradicción
  corregida y pool insuficiente;
- alerta operativa cuando el fallback a `technical` por ausencia de
  `squashKind` deja de ser excepcional;
- rollback del contrato de Crear semana a `detailed`; no volver a la heurística
  textual como rollback.

### 15.2 Evento

- ausencia de `endDate` equivale a `date`;
- `goalEventDate` se mantiene en snapshots viejos;
- import/export acepta los campos opcionales y valida el rango;
- no requiere migración masiva si `GoalEvent` se persiste como JSON, pero sí una
  auditoría de deserializadores y validadores.

## 16. Criterios de aceptación

### 16.1 Modalidad

- Una sesión `technical` con objetivo "control de longitud" contiene drills
  principales `partner` y no drills `control/solo`.
- Una sesión `control` contiene sólo pelota `control/solo`, con `shadows` como
  único accesorio permitido.
- Plan Builder, Crear semana, chat y formulario producen el mismo
  `squashDetails.sessionKind` para la misma intención.
- Ningún resolver de modalidad busca palabras en título, objetivo o `focusKey`.
- Todos los drills del catálogo tienen `sessionKind` y `executionMode`
  explícitos y pasan invariantes de coherencia.
- Ninguna definición del catálogo usa `executionMode='either'`; `either` existe
  sólo en `partnerAvailability`.
- El pool control tiene al menos nueve opciones elegibles en build/peak y la
  simulación de 4, 8 y 12 semanas no dispara
  `quality.squash.signature_uniqueness_unresolved` por agotamiento.
- Los tres drills de sombras son elegibles en taper.
- Un pool corto reutiliza contenido de la misma modalidad; no mezcla partner y
  solo.
- Sesiones y backups antiguos siguen abriendo y editándose.

### 16.2 Evento

- Sin `endDate`, los planes y ciclos conservan el comportamiento actual.
- Un evento 5–11 sep prepara taper hacia el día 5, marca `race` del 5 al 11 y
  termina el plan/ciclo el 11.
- `keyDate=9 sep` queda dentro de la ventana y es el ancla competitiva.
- Toda semana que intersecte el rango recibe reglas de evento, incluso si el
  rango cruza un lunes.
- Dentro del evento no aparecen cargas incompatibles ni match-play extra.
- Rango, validadores, prompts, fallback determinista y dashboard usan las
  mismas fechas normalizadas.

## 17. Decisiones cerradas

1. Si no hay `keyDate`, `startDate` es la única ancla visual de competencia.
2. Un drill conocido incompatible genera advertencia siempre, tanto al crear
   como al editar, pero no bloquea el guardado ni se reemplaza silenciosamente.
3. La ampliación mínima del pool de control ocurre dentro del Proyecto A. Los
   pools técnico, sombras y match se amplían posteriormente.
4. `executionMode='either'` queda prohibido en las definiciones; `either`
   sobrevive sólo en `partnerAvailability`.
5. Los tres drills actuales de sombras se habilitan para taper.
