import LegalPageLayout from '../components/legal/LegalPageLayout'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'
import { ROUTES } from '../constants/routes'

interface PrivacyDocumentProps {
  controllerName: string
}

export default function PrivacyPage() {
  return <PrivacyDocument controllerName={LEGAL_CONTROLLER_NAME} />
}

export function PrivacyDocument({ controllerName }: PrivacyDocumentProps) {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title="Política de Privacidad"
      metaRoute={ROUTES.PRIVACY}
      updatedAt="2026-07-13"
    >
      <p>
        Esta política explica qué datos tratamos, para qué los usamos y cómo puedes gestionar o eliminar tu
        información. Para la operación en Chile, el tratamiento se rige por la <strong>Ley 19.628</strong> vigente.
        Esta política también prepara la operación para las modificaciones introducidas por la{' '}
        <strong>Ley 21.719</strong>, cuya entrada en vigencia está fijada para el{' '}
        <strong>1 de diciembre de 2026</strong>.
      </p>

      <h2>Responsable y contacto</h2>
      <p>
        El responsable del tratamiento es <strong>{controllerName}</strong>. Para consultas de privacidad, soporte
        o solicitudes sobre tus datos, puedes escribir a <a href="mailto:hola@rallyiq.cl">hola@rallyiq.cl</a>.
      </p>

      <h2>Datos que tratamos</h2>
      <ul>
        <li>
          <strong>Cuenta:</strong> nombre y correo asociados a tu inicio de sesión.
        </li>
        <li>
          <strong>Entrenamiento:</strong> sesiones, planes, objetivos, disponibilidad, notas, RPE y registros
          diarios.
        </li>
        <li>
          <strong>Salud y rendimiento declarados:</strong> sensaciones, sueño, energía, molestias, peso corporal y
          datos deportivos que ingresas manualmente. Algunos pueden considerarse datos sensibles; los tratamos para
          prestarte el servicio y con tu consentimiento.
        </li>
        <li>
          <strong>Wearables opcionales:</strong> si conectas Whoop, usamos recovery, HRV, frecuencia cardiaca en
          reposo, strain y datos de sueño. La conexión es <strong>opcional</strong> y exige tu autorización.
        </li>
        <li>
          <strong>Datos técnicos:</strong> información mínima necesaria para operar, autenticar, sincronizar y
          diagnosticar errores del servicio.
        </li>
      </ul>

      <h2>Uso de datos de Whoop</h2>
      <p>
        La conexión con Whoop es opcional y requiere tu autorización. Usamos esos datos como contexto objetivo
        opcional y consentido para mostrar readiness, prellenar campos editables del check-in diario y entregar
        contexto pasivo al coach de IA. Los datos de Whoop{' '}
        <strong>no se usan para diagnosticar, tratar o prevenir enfermedades o lesiones</strong>. RallyIQ no
        reemplaza a un profesional médico, entrenador calificado u otro especialista de salud.
      </p>

      <h2>Para qué usamos tus datos</h2>
      <ul>
        <li>Generar, registrar y ajustar planes de entrenamiento.</li>
        <li>Sincronizar tus datos entre dispositivos.</li>
        <li>Mostrar resúmenes de carga, adherencia, readiness y progreso.</li>
        <li>Dar contexto al coach de IA y a las recomendaciones dentro de la app.</li>
        <li>Prestar soporte, mejorar el producto y mantener la seguridad del servicio.</li>
      </ul>
      <p>
        <strong>No vendemos tus datos personales.</strong>
      </p>

      <h2>Almacenamiento y proveedores</h2>
      <p>
        La app funciona local-first: parte de tus datos se guarda en tu navegador. Si inicias sesión, también se
        sincronizan en infraestructura cloud para que puedas recuperarlos y usarlos entre dispositivos. Usamos
        proveedores como Supabase para base de datos y autenticación, Netlify para hosting y proveedores de IA para
        generar contenido dentro de la app. Estos proveedores reciben la información necesaria para prestar el
        servicio. Los tokens de Whoop se almacenan cifrados del lado servidor; la app usa un resumen diario asociado
        a tu cuenta y atleta activo.
      </p>

      <h2>Tus controles</h2>
      <ul>
        <li>Puedes exportar tus datos desde Ajustes.</li>
        <li>Puedes eliminar datos locales y remotos desde Ajustes.</li>
        <li>Puedes desconectar Whoop desde Ajustes; al hacerlo se borran los datos de Whoop asociados.</li>
        <li>Puedes escribir a hola@rallyiq.cl para solicitar acceso, rectificación o eliminación.</li>
      </ul>

      <h2>Conservación y seguridad</h2>
      <p>
        Conservamos tus datos mientras tu cuenta esté activa o mientras sean necesarios para prestar el servicio.
        Aplicamos medidas razonables de seguridad, incluyendo autenticación, conexiones cifradas y cifrado de
        credenciales de integraciones sensibles.
      </p>

      <h2>Menores</h2>
      <p>{MINORS_POLICY_COPY}</p>

      <h2>Cambios a esta política</h2>
      <p>
        Podemos actualizar esta política para reflejar cambios del producto, legales o de seguridad. La fecha de
        última actualización indicará la versión vigente. Durante el prelanzamiento puede actualizarse antes de
        habilitar cuentas pagadas; los cambios relevantes deberán comunicarse y aceptarse cuando corresponda.
      </p>
    </LegalPageLayout>
  )
}
