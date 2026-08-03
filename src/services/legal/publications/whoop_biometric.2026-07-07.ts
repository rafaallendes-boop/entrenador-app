import type { LegalDocumentContent } from '../legalDocumentContent'

/**
 * PUBLICACIÓN INMUTABLE. Este archivo no se edita nunca. Para cambiar el texto
 * se crea una publicación nueva con id nuevo y se actualiza el manifiesto.
 */
export const WHOOP_2026_07_07: LegalDocumentContent = {
  title: 'Descargo y consentimiento para datos Whoop',
  eyebrow: 'Legal',
  blocks: [
    {
      kind: 'paragraph',
      spans: [
        { text: 'La integración con Whoop es ' },
        { text: 'opcional', strong: true },
        {
          text: '. Si decides conectarla, autorizas a RallyIQ a recibir y tratar datos biométricos y de actividad generados por Whoop como contexto objetivo opcional y consentido para tu entrenamiento.',
        },
      ],
    },
    { kind: 'heading', text: 'Datos que podemos recibir' },
    {
      kind: 'list',
      items: [
        [{ text: 'Recovery diario y puntaje de recuperación.' }],
        [{ text: 'HRV y frecuencia cardiaca en reposo.' }],
        [{ text: 'Strain o carga registrada por Whoop.' }],
        [{ text: 'Datos de sueño, incluyendo horas de sueño y sleep performance.' }],
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        { text: 'No recibimos tus credenciales de Whoop.', strong: true },
        { text: ' El acceso se realiza mediante OAuth y los tokens se guardan cifrados del lado servidor.' },
      ],
    },
    { kind: 'heading', text: 'Para qué se usan' },
    {
      kind: 'paragraph',
      spans: [{ text: 'Usamos estos datos como contexto objetivo opcional y consentido para:' }],
    },
    {
      kind: 'list',
      items: [
        [{ text: 'Mostrar señales de recuperación, sueño y strain en la app.' }],
        [{ text: 'Prellenar campos editables del check-in diario, como sueño, calidad de sueño y energía.' }],
        [{ text: 'Dar contexto pasivo al coach de IA.' }],
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        { text: 'Estos datos ' },
        { text: 'no se usan para diagnosticar, tratar o prevenir enfermedades o lesiones', strong: true },
        {
          text: '. RallyIQ no reemplaza la evaluación de un profesional médico, entrenador calificado u otro especialista de salud.',
        },
      ],
    },
    { kind: 'heading', text: 'Dónde se guardan' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Los tokens de acceso se guardan cifrados en el servidor. Los datos biométricos crudos se procesan del lado servidor y no se exponen directamente al cliente. La app solo replica localmente un resumen diario de readiness asociado a tu atleta activo.',
        },
      ],
    },
    { kind: 'heading', text: 'Desconexión y borrado' },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'Puedes desconectar Whoop desde Ajustes. Al desconectar, RallyIQ revoca el acceso cuando el backend de Whoop está disponible para ello y deja de sincronizar nuevos datos.',
        },
      ],
    },
    {
      kind: 'paragraph',
      spans: [
        {
          text: 'También puedes eliminar tus datos desde las opciones de borrado de la app. El borrado completo elimina los resúmenes locales y remotos asociados a Whoop, además de los demás datos de entrenamiento de tu cuenta.',
        },
      ],
    },
  ],
}
