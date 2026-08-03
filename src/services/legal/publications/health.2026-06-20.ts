import type { LegalDocumentContent } from '../legalDocumentContent'

/**
 * PUBLICACIÓN INMUTABLE. Este archivo no se edita nunca. Para cambiar el texto
 * se crea una publicación nueva con id nuevo y se actualiza el manifiesto.
 */
export const HEALTH_2026_06_20: LegalDocumentContent = {
  title: 'Descargo de responsabilidad de salud',
  eyebrow: 'Legal',
  blocks: [
    {
      kind: 'paragraph',
      spans: [
        { text: 'RallyIQ ("la aplicación") es una herramienta de ' },
        { text: 'planificación y seguimiento de entrenamiento deportivo', strong: true },
        {
          text: '. No es un dispositivo médico, no presta servicios de salud y no sustituye el consejo de un médico, kinesiólogo, nutricionista ni de ningún profesional de la salud calificado.',
        },
      ],
    },
    { kind: 'heading', text: 'Antes de empezar' },
    {
      kind: 'list',
      items: [
        [
          { text: 'Consulta a un profesional de la salud', strong: true },
          {
            text: ' antes de iniciar este o cualquier programa de ejercicio, especialmente si tienes una condición preexistente, lesiones, estás embarazada, tomas medicación o hace tiempo que no entrenas.',
          },
        ],
        [
          {
            text: 'Si durante una sesión sientes dolor en el pecho, mareo, falta de aire, dolor articular agudo u otro síntoma inusual, ',
          },
          { text: 'detén la actividad y busca atención médica', strong: true },
          { text: '.' },
        ],
      ],
    },
    { kind: 'heading', text: 'Naturaleza de los planes' },
    {
      kind: 'list',
      items: [
        [
          { text: 'Los planes, cargas, ejercicios y notas que genera RallyIQ son ' },
          { text: 'sugerencias generales', strong: true },
          {
            text: ' basadas en los datos que ingresas. No están calibrados por un profesional que te haya evaluado en persona.',
          },
        ],
        [
          { text: 'Parte del contenido se genera con asistencia de modelos de inteligencia artificial y ' },
          { text: 'puede contener errores o recomendaciones inadecuadas para tu caso', strong: true },
          { text: '. Usa tu criterio y el de tu entrenador o profesional de cabecera.' },
        ],
        [
          { text: 'Cuando un entrenador revise los planes antes de entregártelos, esa revisión ' },
          { text: 'no constituye una prescripción médica', strong: true },
          { text: '.' },
        ],
      ],
    },
    { kind: 'heading', text: 'Tu responsabilidad' },
    {
      kind: 'list',
      items: [
        [
          {
            text: 'Eres responsable de entrenar dentro de tus capacidades, ajustar o saltar cualquier sesión que no sea apropiada para ti ese día y usar técnica y equipamiento seguros.',
          },
        ],
        [
          { text: 'Al usar la aplicación aceptas que entrenas ' },
          { text: 'bajo tu propio riesgo', strong: true },
          {
            text: ' y que RallyIQ y sus responsables no son responsables por lesiones, daños o pérdidas derivadas del uso de los planes o la información provista, en la máxima medida permitida por la ley aplicable.',
          },
        ],
      ],
    },
    { kind: 'heading', text: 'Emergencias' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'RallyIQ no está diseñada para emergencias médicas. Ante una emergencia, contacta a los servicios de urgencia de tu país.',
        },
      ],
    },
  ],
}
