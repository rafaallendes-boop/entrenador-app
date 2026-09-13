import { describe, expect, it } from 'vitest'

import { resolveChatRoute } from '../chatRouting'

describe('chatRouting', () => {
  it('routes single-week planning requests to the specialized engine', () => {
    expect(resolveChatRoute('Créame la semana para esta semana').kind).toBe('week_creator')
    expect(resolveChatRoute('Créame la semana para la próxima semana').kind).toBe('week_creator')
  })

  it('routes day-scoped or session-scoped requests to chat_action', () => {
    expect(resolveChatRoute('Armame el lunes con running suave').kind).toBe('chat_action')
    expect(resolveChatRoute('Agrega squash el jueves PM').kind).toBe('chat_action')
    expect(resolveChatRoute('Para la próxima semana, agrega una sesión de pesas para el lunes, y el martes deja un running en zona 2').kind).toBe('chat_action')
  })

  it('routes canonical deterministic bypass phrases to chat_action', () => {
    expect(resolveChatRoute('pon descanso el lunes').kind).toBe('chat_action')
    expect(resolveChatRoute('borra el entreno del jueves').kind).toBe('chat_action')
    expect(resolveChatRoute('elimina el entrenamiento del viernes').kind).toBe('chat_action')
    expect(resolveChatRoute('sácame la sesión de mañana').kind).toBe('chat_action')
  })

  it('routes plural and imperative session changes to chat_action', () => {
    expect(resolveChatRoute('cámbiame una de las sesiones de fuerza').kind).toBe('chat_action')
    expect(resolveChatRoute('cambie 1 de las sesiones').kind).toBe('chat_action')
    expect(resolveChatRoute('modifícame la sesión PM').kind).toBe('chat_action')
  })

  it('routes colloquial single-session creation requests to chat_action', () => {
    // These were falling through to chat_general before the routing widening,
    // which prevented the chat from emitting an actionable proposal.
    expect(resolveChatRoute('quiero squash mañana').kind).toBe('chat_action')
    expect(resolveChatRoute('haceme un running el viernes').kind).toBe('chat_action')
    expect(resolveChatRoute('ponme una sesión de fuerza el lunes').kind).toBe('chat_action')
    expect(resolveChatRoute('necesito cycling el sábado AM').kind).toBe('chat_action')
    expect(resolveChatRoute('agéndame movilidad hoy PM').kind).toBe('chat_action')
    expect(resolveChatRoute('Dame la sesión de pesas para mañana lunes').kind).toBe('chat_action')
  })

  it('keeps a next-week day-specific strength request out of the week creator', () => {
    expect(resolveChatRoute(
      'Créame una sesión de fuerza con superseries para el lunes de la próxima semana',
    ).kind).toBe('chat_action')
  })

  it('routes typo-tolerant strength session requests to chat_action', () => {
    expect(resolveChatRoute('crea una sesión de pesas par ahoy').kind).toBe('chat_action')
    expect(resolveChatRoute('crea una sesion de gym a hoy').kind).toBe('chat_action')
    expect(resolveChatRoute('hazme pesas manana').kind).toBe('chat_action')
  })

  it('still routes generic conversation to chat_general', () => {
    expect(resolveChatRoute('cómo va mi semana').kind).toBe('chat_general')
    expect(resolveChatRoute('qué opinas de mi progreso').kind).toBe('chat_general')
    expect(resolveChatRoute('¿Qué debería priorizar hoy antes de mis sesiones?').kind).toBe('chat_general')
    expect(resolveChatRoute('¿Qué me recomiendas para hoy?').kind).toBe('chat_general')
    expect(resolveChatRoute('¿Cuánto debería bajar la carga esta semana?').kind).toBe('chat_general')
    // `hacer` queda deliberadamente fuera del guard de mutación: es el verbo
    // más genérico del idioma y esta es exactamente la consulta de asesoría
    // que el desvío existe para permitir.
    expect(resolveChatRoute('¿Qué debería hacer hoy?').kind).toBe('chat_general')
  })

  // La pregunta de asesoría no puede tragarse una petición de acción sólo por
  // venir en forma interrogativa: "sacar", "mover" y "cambio" son mutaciones
  // explícitas y su camino sigue siendo el motor de acciones.
  it('keeps action requests phrased as questions in chat_action', () => {
    expect(resolveChatRoute('¿Cuál sesión debería sacar del lunes?').kind).toBe('chat_action')
    expect(resolveChatRoute('¿Qué sesión me conviene mover al jueves?').kind).toBe('chat_action')
    expect(resolveChatRoute('¿Cómo cambio mi sesión del martes para que quede mejor?').kind).toBe('chat_action')
    expect(resolveChatRoute('¿Qué sesión conviene que agregues el viernes?').kind).toBe('chat_action')
    // Los patrones de acción están en imperativo; en una pregunta el verbo va
    // en infinitivo y ninguno de los dos lo cubría, así que estas peticiones
    // reales terminaban en prosa sin poder emitir propuesta.
    expect(resolveChatRoute('¿Qué sesión me conviene agendar el jueves?').kind).toBe('chat_action')
    expect(resolveChatRoute('¿Cuál sesión conviene reducir el martes?').kind).toBe('chat_action')
    expect(resolveChatRoute('¿Qué entreno conviene adelantar al miércoles?').kind).toBe('chat_action')
  })

  it('routes infinitive move requests to the action flow', () => {
    expect(resolveChatRoute(
      'Quiero mover la fuerza del martes al lunes y el running del miércoles al martes',
    ).kind).toBe('chat_action')
  })

  it('routes short confirmations without a pendingIntent estructurada to chat_general (chatRoutingCorpus.ts#confirm-1)', () => {
    const route = resolveChatRoute('si, realiza el cambio', {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      recentMessages: [
        { role: 'user', content: 'Realiza un cambio en mi sesión de mañana, quiero realizar una corrida en zona 2' },
        { role: 'coach', content: 'Confirmas que quieres reemplazar la sesión de squash por una corrida en Zona 2?' },
      ],
    })

    expect(route.kind).toBe('chat_general')
  })

  it('routes "créala" sin intención pendiente estructurada es conversación (chatRoutingCorpus.ts#confirm-1)', () => {
    const route = resolveChatRoute('créala', {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      recentMessages: [
        { role: 'user', content: 'Quiero una sesión de fuerza con superseries para el lunes.' },
        { role: 'coach', content: 'Te propongo una sesión de fuerza con superseries para el lunes.' },
      ],
    })

    expect(route.kind).toBe('chat_general')
  })

  it('routes single-session creation to chat_action when the week is only a temporal qualifier', () => {
    // Regresión observada en producción: "para la próxima semana" es un
    // calificador temporal, no un pedido de generar la semana completa. Antes
    // de este fix estas tres frases llegaban a week_creator y devolvían una
    // semana entera de entrenamientos.
    expect(resolveChatRoute('Creame una sesión de pesas para la próxima semana').kind).toBe('chat_action')
    expect(resolveChatRoute('Hazme un entrenamiento de fuerza para la próxima semana').kind).toBe('chat_action')
    expect(resolveChatRoute('Agrégame una sesión de running para esta semana').kind).toBe('chat_action')
  })

  it('routes session creation without any day or week reference to chat_action', () => {
    // Sin día explícito estas caían a chat_general y sólo producían prosa,
    // aunque el pedido de crear una sesión es inequívoco.
    expect(resolveChatRoute('Creame una sesión de pesas').kind).toBe('chat_action')
    expect(resolveChatRoute('Armame un entrenamiento de squash').kind).toBe('chat_action')
  })

  it('routes soft-verb single-session requests when the object is indefinite', () => {
    // "quiero"/"necesito"/"dame" son ambiguos: piden tanto crear como saber.
    // Un objeto INDEFINIDO ("una sesión de pesas") sólo tiene lectura de
    // creación; uno definido o posesivo ("mi sesión", "feedback") no.
    expect(resolveChatRoute('quiero una sesión de fuerza para la próxima semana').kind).toBe('chat_action')
    expect(resolveChatRoute('necesito una sesión de pesas').kind).toBe('chat_action')
    expect(resolveChatRoute('dame un entrenamiento de squash').kind).toBe('chat_action')
  })

  it('no confunde pedir información con pedir una sesión', () => {
    expect(resolveChatRoute('quiero saber cómo va mi entrenamiento').kind).toBe('chat_general')
    expect(resolveChatRoute('dame feedback de mi sesión de ayer').kind).toBe('chat_general')
    expect(resolveChatRoute('necesito entender mi carga de la semana').kind).toBe('chat_general')
  })

  it('keeps genuine whole-week requests in the week creator', () => {
    // La otra dirección del riesgo: el fix no puede robarle peticiones
    // legítimas de semana al motor especializado.
    expect(resolveChatRoute('Creame una semana de entrenamiento').kind).toBe('week_creator')
    expect(resolveChatRoute('Créame una semana de entrenamiento para la próxima semana').kind).toBe('week_creator')
    expect(resolveChatRoute('Armame la próxima semana').kind).toBe('week_creator')
    expect(resolveChatRoute('Armame el microciclo de la próxima semana').kind).toBe('week_creator')
    expect(resolveChatRoute('Genérame una propuesta de semana').kind).toBe('week_creator')
  })

  it('leaves plural / multi-session week requests with the week creator', () => {
    // Mi rama de sesión única miraba verbo y objeto pero no el NÚMERO, así que
    // "las sesiones de la próxima semana" caía al motor de una sola acción y
    // el usuario recibía una sesión en vez de una semana.
    expect(resolveChatRoute('programa mis sesiones de fuerza para la próxima semana').kind).toBe('week_creator')
    expect(resolveChatRoute('créame las sesiones de fuerza y squash de la próxima semana').kind).toBe('week_creator')
    expect(resolveChatRoute('armame los entrenamientos de fuerza de la semana que viene').kind).toBe('week_creator')
  })

  it('does not turn questions about past sessions into action requests', () => {
    // "dame"/"entrégame" quedan fuera del predicado de creación a propósito:
    // sirven igual para pedir información, y sin día explícito no se puede
    // distinguir crear de preguntar.
    expect(resolveChatRoute('dame feedback de mi sesión de ayer').kind).toBe('chat_general')
    expect(resolveChatRoute('cómo estuvo mi entrenamiento').kind).toBe('chat_general')
  })

  it('redirects explicit multi-week planning requests to Plan Builder', () => {
    expect(resolveChatRoute('Hazme el plan hasta el evento').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Quiero todas las semanas hasta el torneo').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Créame 2 semanas').kind).toBe('plan_builder_redirect')
    expect(resolveChatRoute('Armame dos semanas de entrenamiento').kind).toBe('plan_builder_redirect')
  })
})
