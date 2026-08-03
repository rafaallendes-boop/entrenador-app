import type { LegalDocumentContent } from '../legalDocumentContent'

/**
 * PUBLICACIÓN INMUTABLE. Este archivo no se edita nunca. Para cambiar el texto
 * se crea una publicación nueva con id nuevo y se actualiza el manifiesto.
 */
export const TERMS_2026_07_13: LegalDocumentContent = {
  title: 'Términos y Condiciones',
  eyebrow: 'Legal',
  blocks: [
    {
      kind: 'paragraph',
      spans: [
        { text: 'Titular del servicio:', strong: true },
        { text: ' Rafael Allendes' },
        {
          text: '. Si cambia la persona o entidad titular del servicio, esta sección y la Política de Privacidad se actualizarán antes de que el cambio produzca efectos para los usuarios.',
        },
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        { text: 'Contacto:', strong: true },
        { text: ' hola@rallyiq.cl' },
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        { text: 'Jurisdicción:', strong: true },
        { text: ' Chile.' },
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Al crear una cuenta o usar RallyIQ ("el servicio") aceptas estos Términos. Si no estás de acuerdo, no uses el servicio.',
        },
      ],
    },
    { kind: 'heading', text: '1. Qué es el servicio' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'RallyIQ es una aplicación de planificación y seguimiento de entrenamiento deportivo con asistencia de inteligencia artificial. El servicio ',
        },
        { text: 'no es consejo médico', strong: true },
        { text: '; consulta el ' },
        { text: 'Descargo de responsabilidad de salud', href: '/health-disclaimer' },
        { text: ', que forma parte de estos Términos.' },
      ],
    },
    { kind: 'heading', text: '2. Cuenta y acceso' },
    {
      kind: 'list',
      items: [
        [{ text: 'Necesitas una cuenta para usar las funciones autenticadas del servicio.' }],
        [{ text: 'Eres responsable de la actividad de tu cuenta y de mantener segura tu sesión.' }],
        [{ text: 'Debes tener al menos 18 años para crear una cuenta o contratar el servicio.' }],
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'RallyIQ no está disponible para personas menores de 18 años ni permite registrar datos de atletas menores de 18 años durante esta etapa.',
        },
      ],
    },
    { kind: 'heading', text: '3. Suscripción, pagos y renovación' },
    {
      kind: 'paragraph',
      spans: [
        { text: 'RallyIQ aún no habilita contratación ni cobros.', strong: true },
        {
          text: ' Antes del lanzamiento pagado, esta sección se actualizará con precio, moneda, impuestos o documento tributario, renovación, cancelación y reembolsos. La versión vigente deberá aceptarse explícitamente antes de realizar el primer cobro.',
        },
      ],
    },
    { kind: 'heading', text: '4. Uso aceptable' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'No puedes usar el servicio para fines ilegales; revender o redistribuir masivamente el software o sus contenidos fuera del servicio; intentar vulnerar su seguridad, extraer datos masivamente o interferir con su funcionamiento. Si usas RallyIQ como coach, sí puedes compartir con los atletas que gestionas los planes y sesiones creados para ellos dentro del uso normal del servicio.',
        },
      ],
    },
    { kind: 'heading', text: '5. Tus datos y contenido' },
    {
      kind: 'list',
      items: [
        [
          {
            text: 'Conservas la titularidad de los datos que ingresas. Nos otorgas una licencia limitada para procesarlos y prestarte el servicio; consulta la ',
          },
          { text: 'Política de Privacidad', href: '/privacy' },
          { text: '.' },
        ],
        [
          { text: 'Puedes ' },
          { text: 'exportar y eliminar', strong: true },
          { text: ' tus datos desde Ajustes.' },
        ],
      ],
    },
    { kind: 'heading', text: '6. Inteligencia artificial' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Parte del contenido se genera con modelos de IA y puede contener errores. Las sugerencias son orientativas; la decisión final de entrenar es tuya y, cuando corresponda, de tu entrenador o profesional de la salud.',
        },
      ],
    },
    { kind: 'heading', text: '7. Disponibilidad y cambios' },
    {
      kind: 'list',
      items: [
        [
          {
            text: 'El servicio se ofrece "tal cual" y "según disponibilidad". Podemos modificar, suspender o discontinuar funciones, avisando cuando sea razonable.',
          },
        ],
        [
          {
            text: 'Podemos actualizar estos Términos; los cambios relevantes se comunicarán y la fecha de última actualización reflejará la versión vigente.',
          },
        ],
      ],
    },
    { kind: 'heading', text: '8. Limitación de responsabilidad' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'En la máxima medida permitida por la ley aplicable, RallyIQ y sus responsables no serán responsables por daños indirectos, lesiones, pérdida de datos o lucro cesante derivados del uso del servicio. Nada en estos Términos limita derechos que no puedan limitarse según la ley de protección al consumidor aplicable.',
        },
      ],
    },
    { kind: 'heading', text: '9. Ley aplicable' },
    {
      kind: 'paragraph',
      spans: [
        { text: 'Estos Términos se rigen por las leyes de ' },
        { text: 'Chile', strong: true },
        {
          text: ' y cualquier disputa se someterá a sus tribunales competentes, sin perjuicio de los derechos irrenunciables del consumidor conforme a la Ley 19.496.',
        },
      ],
    },
    { kind: 'heading', text: '10. Contacto' },
    { kind: 'paragraph', spans: [{ text: 'Consultas: hola@rallyiq.cl' }] },
  ],
}
