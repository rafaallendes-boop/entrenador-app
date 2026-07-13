import LegalPageLayout from '../components/legal/LegalPageLayout'
import { ROUTES } from '../constants/routes'

export default function WhoopDisclaimerPage() {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title="Descargo y consentimiento para datos Whoop"
      metaRoute={ROUTES.WHOOP_DISCLAIMER}
      updatedAt="2026-07-07"
    >
      <p>
        La integración con Whoop es <strong>opcional</strong>. Si decides conectarla, autorizas a RallyIQ a recibir
        y tratar datos biométricos y de actividad generados por Whoop como contexto objetivo opcional y consentido
        para tu entrenamiento.
      </p>

      <h2>Datos que podemos recibir</h2>
      <ul>
        <li>Recovery diario y puntaje de recuperación.</li>
        <li>HRV y frecuencia cardiaca en reposo.</li>
        <li>Strain o carga registrada por Whoop.</li>
        <li>Datos de sueño, incluyendo horas de sueño y sleep performance.</li>
      </ul>
      <p>
        <strong>No recibimos tus credenciales de Whoop.</strong> El acceso se realiza mediante OAuth y los tokens
        se guardan cifrados del lado servidor.
      </p>

      <h2>Para qué se usan</h2>
      <p>Usamos estos datos como contexto objetivo opcional y consentido para:</p>
      <ul>
        <li>Mostrar señales de recuperación, sueño y strain en la app.</li>
        <li>Prellenar campos editables del check-in diario, como sueño, calidad de sueño y energía.</li>
        <li>Dar contexto pasivo al coach de IA.</li>
      </ul>
      <p>
        Estos datos <strong>no se usan para diagnosticar, tratar o prevenir enfermedades o lesiones</strong>.
        RallyIQ no reemplaza la evaluación de un profesional médico, entrenador calificado u otro especialista de
        salud.
      </p>

      <h2>Dónde se guardan</h2>
      <p>
        Los tokens de acceso se guardan cifrados en el servidor. Los datos biométricos crudos se procesan del lado
        servidor y no se exponen directamente al cliente. La app solo replica localmente un resumen diario de
        readiness asociado a tu atleta activo.
      </p>

      <h2>Desconexión y borrado</h2>
      <p>
        Puedes desconectar Whoop desde Ajustes. Al desconectar, RallyIQ revoca el acceso cuando el backend de Whoop
        está disponible para ello y deja de sincronizar nuevos datos.
      </p>
      <p>
        También puedes eliminar tus datos desde las opciones de borrado de la app. El borrado completo elimina los
        resúmenes locales y remotos asociados a Whoop, además de los demás datos de entrenamiento de tu cuenta.
      </p>
    </LegalPageLayout>
  )
}
