# Descargo y consentimiento para datos Whoop

> Estado: borrador funcional. Requiere revision legal antes de publicar.
> Ultima actualizacion: 2026-07-07

La integracion con Whoop es opcional. Si decides conectarla, autorizas a RallyIQ a recibir y tratar datos biometricos y de actividad generados por Whoop para mejorar el contexto de entrenamiento.

## Datos que podemos recibir

- Recovery diario y puntaje de recuperacion.
- HRV y frecuencia cardiaca en reposo.
- Strain/carga registrada por Whoop.
- Datos de sueno, incluyendo horas de sueno y sleep performance.
- Entrenamientos detectados por Whoop: fecha, deporte, duracion, frecuencia cardiaca media y maxima, distancia cuando corresponde, y la distribucion del tiempo entre las seis zonas de frecuencia cardiaca de Whoop.
- El porcentaje de la sesion en que Whoop registro frecuencia cardiaca, para que puedas saber que tan completa es esa distribucion.

No recibimos tus credenciales de Whoop. El acceso se realiza mediante OAuth y los tokens se guardan cifrados del lado servidor.

## Para que se usan

Usamos estos datos como contexto objetivo para:

- Mostrar senales de recuperacion, sueno y strain en la app.
- Prellenar campos editables del check-in diario, como sueno, calidad de sueno y energia.
- Dar contexto pasivo al coach de IA, incluyendo la carga objetiva de tus entrenamientos recientes y su distribucion por zona de frecuencia cardiaca.

Estos datos no se usan para diagnosticar, tratar o prevenir enfermedades o lesiones. RallyIQ no reemplaza la evaluacion de un profesional medico, entrenador calificado u otro especialista de salud.

## Donde se guardan

Los tokens de acceso se guardan cifrados en el servidor. Los datos biometricos crudos se procesan del lado servidor y no se exponen directamente al cliente. La app guarda en nuestra base de datos y replica en el almacenamiento local de tu dispositivo el resumen diario de readiness y los entrenamientos detectados con sus metricas, incluida la distribucion por zona de frecuencia cardiaca, siempre asociados a tu cuenta y atleta activo.

## Desconexion y borrado

Puedes desconectar Whoop desde Ajustes. Al desconectar, RallyIQ debe revocar el acceso cuando el backend de Whoop este disponible para ello y dejar de sincronizar nuevos datos.

Tambien puedes eliminar tus datos desde las opciones de borrado de la app. El borrado completo debe eliminar los resumenes locales y remotos asociados a Whoop, ademas de los demas datos de entrenamiento de tu cuenta.

## Frases aprobadas para landing o pricing

- RallyIQ puede considerar senales objetivas de recuperacion y sueno si conectas Whoop.
- La integracion con Whoop es opcional y requiere tu consentimiento.
- Whoop aporta contexto fisiologico; no entrega diagnosticos ni ajusta automaticamente tu plan.
