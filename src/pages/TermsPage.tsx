import { Link } from 'react-router-dom'
import LegalPageLayout from '../components/legal/LegalPageLayout'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'
import { ROUTES } from '../constants/routes'

interface TermsDocumentProps {
  controllerName: string
}

export default function TermsPage() {
  return <TermsDocument controllerName={LEGAL_CONTROLLER_NAME} />
}

export function TermsDocument({ controllerName }: TermsDocumentProps) {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title="Términos y Condiciones"
      metaRoute={ROUTES.TERMS}
      updatedAt="2026-07-13"
    >
      <p>
        <strong>Titular del servicio:</strong> {controllerName}. Si cambia la persona o entidad titular del
        servicio, esta sección y la Política de Privacidad se actualizarán antes de que el cambio produzca efectos
        para los usuarios.
      </p>
      <p>
        <strong>Contacto:</strong> hola@rallyiq.cl
      </p>
      <p>
        <strong>Jurisdicción:</strong> Chile.
      </p>
      <p>
        Al crear una cuenta o usar RallyIQ (&quot;el servicio&quot;) aceptas estos Términos. Si no estás de acuerdo,
        no uses el servicio.
      </p>

      <h2>1. Qué es el servicio</h2>
      <p>
        RallyIQ es una aplicación de planificación y seguimiento de entrenamiento deportivo con asistencia de
        inteligencia artificial. El servicio <strong>no es consejo médico</strong>; consulta el{' '}
        <Link to={ROUTES.HEALTH_DISCLAIMER}>Descargo de responsabilidad de salud</Link>, que forma parte de estos
        Términos.
      </p>

      <h2>2. Cuenta y acceso</h2>
      <ul>
        <li>Necesitas una cuenta para usar las funciones autenticadas del servicio.</li>
        <li>Eres responsable de la actividad de tu cuenta y de mantener segura tu sesión.</li>
        <li>Debes tener al menos 18 años para crear una cuenta o contratar el servicio.</li>
      </ul>
      <p>{MINORS_POLICY_COPY}</p>

      <h2>3. Suscripción, pagos y renovación</h2>
      <p>
        <strong>RallyIQ aún no habilita contratación ni cobros.</strong> Antes del lanzamiento pagado, esta sección
        se actualizará con precio, moneda, impuestos o documento tributario, renovación, cancelación y reembolsos.
        La versión vigente deberá aceptarse explícitamente antes de realizar el primer cobro.
      </p>

      <h2>4. Uso aceptable</h2>
      <p>
        No puedes usar el servicio para fines ilegales; revender o redistribuir masivamente el software o sus
        contenidos fuera del servicio; intentar vulnerar su seguridad, extraer datos masivamente o interferir con
        su funcionamiento. Si usas RallyIQ como coach, sí puedes compartir con los atletas que gestionas los planes
        y sesiones creados para ellos dentro del uso normal del servicio.
      </p>

      <h2>5. Tus datos y contenido</h2>
      <ul>
        <li>
          Conservas la titularidad de los datos que ingresas. Nos otorgas una licencia limitada para procesarlos y
          prestarte el servicio; consulta la <Link to={ROUTES.PRIVACY}>Política de Privacidad</Link>.
        </li>
        <li>
          Puedes <strong>exportar y eliminar</strong> tus datos desde Ajustes.
        </li>
      </ul>

      <h2>6. Inteligencia artificial</h2>
      <p>
        Parte del contenido se genera con modelos de IA y puede contener errores. Las sugerencias son orientativas;
        la decisión final de entrenar es tuya y, cuando corresponda, de tu entrenador o profesional de la salud.
      </p>

      <h2>7. Disponibilidad y cambios</h2>
      <ul>
        <li>
          El servicio se ofrece &quot;tal cual&quot; y &quot;según disponibilidad&quot;. Podemos modificar, suspender o
          discontinuar funciones, avisando cuando sea razonable.
        </li>
        <li>
          Podemos actualizar estos Términos; los cambios relevantes se comunicarán y la fecha de última
          actualización reflejará la versión vigente.
        </li>
      </ul>

      <h2>8. Limitación de responsabilidad</h2>
      <p>
        En la máxima medida permitida por la ley aplicable, RallyIQ y sus responsables no serán responsables por
        daños indirectos, lesiones, pérdida de datos o lucro cesante derivados del uso del servicio. Nada en estos
        Términos limita derechos que no puedan limitarse según la ley de protección al consumidor aplicable.
      </p>

      <h2>9. Ley aplicable</h2>
      <p>
        Estos Términos se rigen por las leyes de <strong>Chile</strong> y cualquier disputa se someterá a sus
        tribunales competentes, sin perjuicio de los derechos irrenunciables del consumidor conforme a la Ley
        19.496.
      </p>

      <h2>10. Contacto</h2>
      <p>Consultas: hola@rallyiq.cl</p>
    </LegalPageLayout>
  )
}
