import LegalPageLayout from '../components/legal/LegalPageLayout'
import { ROUTES } from '../constants/routes'

export default function HealthDisclaimerPage() {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title="Descargo de responsabilidad de salud"
      metaRoute={ROUTES.HEALTH_DISCLAIMER}
      updatedAt="2026-06-20"
    >
      <p>
        RallyIQ (&quot;la aplicación&quot;) es una herramienta de{' '}
        <strong>planificación y seguimiento de entrenamiento deportivo</strong>. No es un dispositivo médico, no
        presta servicios de salud y no sustituye el consejo de un médico, kinesiólogo, nutricionista ni de ningún
        profesional de la salud calificado.
      </p>

      <h2>Antes de empezar</h2>
      <ul>
        <li>
          <strong>Consulta a un profesional de la salud</strong> antes de iniciar este o cualquier programa de
          ejercicio, especialmente si tienes una condición preexistente, lesiones, estás embarazada, tomas
          medicación o hace tiempo que no entrenas.
        </li>
        <li>
          Si durante una sesión sientes dolor en el pecho, mareo, falta de aire, dolor articular agudo u otro
          síntoma inusual, <strong>detén la actividad y busca atención médica</strong>.
        </li>
      </ul>

      <h2>Naturaleza de los planes</h2>
      <ul>
        <li>
          Los planes, cargas, ejercicios y notas que genera RallyIQ son <strong>sugerencias generales</strong>{' '}
          basadas en los datos que ingresas. No están calibrados por un profesional que te haya evaluado en
          persona.
        </li>
        <li>
          Parte del contenido se genera con asistencia de modelos de inteligencia artificial y{' '}
          <strong>puede contener errores o recomendaciones inadecuadas para tu caso</strong>. Usa tu criterio y el
          de tu entrenador o profesional de cabecera.
        </li>
        <li>
          Cuando un entrenador revise los planes antes de entregártelos, esa revisión{' '}
          <strong>no constituye una prescripción médica</strong>.
        </li>
      </ul>

      <h2>Tu responsabilidad</h2>
      <ul>
        <li>
          Eres responsable de entrenar dentro de tus capacidades, ajustar o saltar cualquier sesión que no sea
          apropiada para ti ese día y usar técnica y equipamiento seguros.
        </li>
        <li>
          Al usar la aplicación aceptas que entrenas <strong>bajo tu propio riesgo</strong> y que RallyIQ y sus
          responsables no son responsables por lesiones, daños o pérdidas derivadas del uso de los planes o la
          información provista, en la máxima medida permitida por la ley aplicable.
        </li>
      </ul>

      <h2>Emergencias</h2>
      <p>
        RallyIQ no está diseñada para emergencias médicas. Ante una emergencia, contacta a los servicios de
        urgencia de tu país.
      </p>
    </LegalPageLayout>
  )
}
