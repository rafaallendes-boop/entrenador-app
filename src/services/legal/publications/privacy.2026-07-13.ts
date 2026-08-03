import type { LegalDocumentContent } from '../legalDocumentContent'

/**
 * PUBLICACIÓN INMUTABLE. Este archivo no se edita nunca. Para cambiar el texto
 * se crea una publicación nueva con id nuevo y se actualiza el manifiesto.
 */
export const PRIVACY_2026_07_13: LegalDocumentContent = {
  title: 'Política de Privacidad',
  eyebrow: 'Legal',
  blocks: [
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Esta política explica qué datos tratamos, para qué los usamos y cómo puedes gestionar o eliminar tu información. Para la operación en Chile, el tratamiento se rige por la ',
        },
        { text: 'Ley 19.628', strong: true },
        { text: ' vigente. Esta política también prepara la operación para las modificaciones introducidas por la ' },
        { text: 'Ley 21.719', strong: true },
        { text: ', cuya entrada en vigencia está fijada para el ' },
        { text: '1 de diciembre de 2026', strong: true },
        { text: '.' },
      ],
    },
    { kind: 'heading', text: 'Responsable y contacto' },
    {
      kind: 'paragraph',
      spans: [
        { text: 'El responsable del tratamiento es ' },
        { text: 'Rafael Allendes', strong: true },
        { text: '. Para consultas de privacidad, soporte o solicitudes sobre tus datos, puedes escribir a ' },
        { text: 'hola@rallyiq.cl', href: 'mailto:hola@rallyiq.cl' },
        { text: '.' },
      ],
    },
    { kind: 'heading', text: 'Datos que tratamos' },
    {
      kind: 'list',
      items: [
        [
          { text: 'Cuenta:', strong: true },
          { text: ' nombre y correo asociados a tu inicio de sesión.' },
        ],
        [
          { text: 'Entrenamiento:', strong: true },
          { text: ' sesiones, planes, objetivos, disponibilidad, notas, RPE y registros diarios.' },
        ],
        [
          { text: 'Salud y rendimiento declarados:', strong: true },
          {
            text: ' sensaciones, sueño, energía, molestias, peso corporal y datos deportivos que ingresas manualmente. Algunos pueden considerarse datos sensibles; los tratamos para prestarte el servicio y con tu consentimiento.',
          },
        ],
        [
          { text: 'Wearables opcionales:', strong: true },
          {
            text: ' si conectas Whoop, usamos recovery, HRV, frecuencia cardiaca en reposo, strain y datos de sueño. La conexión es ',
          },
          { text: 'opcional', strong: true },
          { text: ' y exige tu autorización.' },
        ],
        [
          { text: 'Datos técnicos:', strong: true },
          {
            text: ' información mínima necesaria para operar, autenticar, sincronizar y diagnosticar errores del servicio.',
          },
        ],
      ],
    },
    { kind: 'heading', text: 'Uso de datos de Whoop' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'La conexión con Whoop es opcional y requiere tu autorización. Usamos esos datos como contexto objetivo opcional y consentido para mostrar readiness, prellenar campos editables del check-in diario y entregar contexto pasivo al coach de IA. Los datos de Whoop ',
        },
        { text: 'no se usan para diagnosticar, tratar o prevenir enfermedades o lesiones', strong: true },
        {
          text: '. RallyIQ no reemplaza a un profesional médico, entrenador calificado u otro especialista de salud.',
        },
      ],
    },
    { kind: 'heading', text: 'Para qué usamos tus datos' },
    {
      kind: 'list',
      items: [
        [{ text: 'Generar, registrar y ajustar planes de entrenamiento.' }],
        [{ text: 'Sincronizar tus datos entre dispositivos.' }],
        [{ text: 'Mostrar resúmenes de carga, adherencia, readiness y progreso.' }],
        [{ text: 'Dar contexto al coach de IA y a las recomendaciones dentro de la app.' }],
        [{ text: 'Prestar soporte, mejorar el producto y mantener la seguridad del servicio.' }],
      ],
    },
    {
      kind: 'paragraph',
      spans: [{ text: 'No vendemos tus datos personales.', strong: true }],
    },
    { kind: 'heading', text: 'Almacenamiento y proveedores' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'La app funciona local-first: parte de tus datos se guarda en tu navegador. Si inicias sesión, también se sincronizan en infraestructura cloud para que puedas recuperarlos y usarlos entre dispositivos. Usamos proveedores como Supabase para base de datos y autenticación, Netlify para hosting y proveedores de IA para generar contenido dentro de la app. Estos proveedores reciben la información necesaria para prestar el servicio. Los tokens de Whoop se almacenan cifrados del lado servidor; la app usa un resumen diario asociado a tu cuenta y atleta activo.',
        },
      ],
    },
    { kind: 'heading', text: 'Tus controles' },
    {
      kind: 'list',
      items: [
        [{ text: 'Puedes exportar tus datos desde Ajustes.' }],
        [{ text: 'Puedes eliminar datos locales y remotos desde Ajustes.' }],
        [{ text: 'Puedes desconectar Whoop desde Ajustes; al hacerlo se borran los datos de Whoop asociados.' }],
        [{ text: 'Puedes escribir a hola@rallyiq.cl para solicitar acceso, rectificación o eliminación.' }],
      ],
    },
    { kind: 'heading', text: 'Conservación y seguridad' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Conservamos tus datos mientras tu cuenta esté activa o mientras sean necesarios para prestar el servicio. Aplicamos medidas razonables de seguridad, incluyendo autenticación, conexiones cifradas y cifrado de credenciales de integraciones sensibles.',
        },
      ],
    },
    { kind: 'heading', text: 'Menores' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'RallyIQ no está disponible para personas menores de 18 años ni permite registrar datos de atletas menores de 18 años durante esta etapa.',
        },
      ],
    },
    { kind: 'heading', text: 'Cambios a esta política' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Podemos actualizar esta política para reflejar cambios del producto, legales o de seguridad. La fecha de última actualización indicará la versión vigente. Durante el prelanzamiento puede actualizarse antes de habilitar cuentas pagadas; los cambios relevantes deberán comunicarse y aceptarse cuando corresponda.',
        },
      ],
    },
  ],
}
