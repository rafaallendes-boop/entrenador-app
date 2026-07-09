# Política de Privacidad

> **Estado:** Borrador funcional. Requiere revisión legal antes de publicar.
> **Última actualización:** 2026-06-20
>
> Completar los marcadores `[[...]]`. Pensado para **Chile** (Ley 19.628 y la
> nueva **Ley 21.719** de protección de datos, que trata la salud como dato
> sensible y exige consentimiento explícito). Redactada **compatible con GDPR**
> a propósito, para no reescribir al expandir al extranjero (la app ya soporta
> exportar y eliminar datos, que es el requisito más costoso).

**Responsable del tratamiento (piloto):** [[NOMBRE — persona natural; pasará a
la sociedad (SpA) antes de habilitar el cobro]] — [[EMAIL DE CONTACTO]]

Esta política explica qué datos tratamos, para qué y qué derechos tienes.

## 1. Qué datos tratamos

- **Cuenta:** nombre y correo provistos por el inicio de sesión con Google.
- **Datos de entrenamiento y salud que declaras:** edad, peso, objetivos,
  deporte, disponibilidad, referencias de fuerza (1RM), tiempos de carrera,
  percepción de fatiga, lesiones/molestias, sesiones y registros. Algunos de
  estos pueden considerarse **datos sensibles** (salud); los tratamos solo para
  prestarte el servicio y con tu consentimiento.
- **Datos de wearables (Whoop), si lo conectas:** recovery, HRV, frecuencia
  cardiaca en reposo, strain y datos de sueno. La conexion es opcional y exige
  consentimiento especifico.
- **Datos técnicos mínimos** necesarios para operar (p. ej. errores de la
  aplicación). [[CONFIRMAR si se usa analítica; si sí, detallar herramienta y
  finalidad]].

## 2. Para qué los usamos

- Generar y ajustar tus planes de entrenamiento.
- Sincronizar tus datos entre tus dispositivos.
- Mejorar el servicio y dar soporte.
- No vendemos tus datos.

## 3. Dónde se guardan y con quién se comparten

- **Local en tu dispositivo** (almacenamiento del navegador) y, si iniciás
  sesión, **sincronizados en Supabase** (infraestructura de base de datos).
- **Proveedores que nos prestan servicio (encargados de tratamiento):**
  - Autenticación: Google (inicio de sesión).
  - Base de datos y sincronización: Supabase.
  - Generación de contenido con IA: [[PROVEEDOR DE IA — p. ej. Google Gemini]].
    Se le envían los datos mínimos del perfil/objetivo necesarios para generar el
    plan; **no se le envían tus credenciales**.
  - Hosting: Netlify.
  - [[PROCESADOR DE PAGOS, cuando aplique]].
- Estos proveedores pueden almacenar datos fuera de tu país. [[CONFIRMAR
  transferencia internacional y resguardos]].

## 4. Tus derechos

- **Acceso, rectificación, cancelación (eliminación) y oposición** sobre tus
  datos.
- Puedes **exportar** todos tus datos y **eliminar tu cuenta y datos** desde
  Ajustes en cualquier momento.
- Para ejercer estos derechos o hacer consultas: [[EMAIL DE CONTACTO]].

## 5. Conservación

Conservamos tus datos mientras tu cuenta esté activa. Si eliminás tu cuenta,
borramos tus datos locales y solicitamos su borrado en la nube. [[CONFIRMAR
plazos de borrado en backups]].

## 6. Seguridad

Aplicamos medidas razonables para proteger tus datos (acceso autenticado,
conexiones cifradas). Ningún sistema es 100% infalible; te avisaremos ante
incidentes relevantes según lo exija la ley.

## 7. Datos de wearables (Whoop)

Si conectas Whoop, usamos esos datos como contexto objetivo para mostrar
readiness, prellenar campos editables del check-in diario y dar contexto pasivo
al coach de IA. No los usamos para diagnosticar, tratar o prevenir enfermedades
o lesiones, ni para ajustar automaticamente tu plan.

Los tokens de Whoop se guardan cifrados del lado servidor. Los datos biometricos
crudos no se exponen directamente al cliente; la app solo usa un resumen diario
asociado a tu atleta activo. Puedes desconectar Whoop o borrar tus datos desde
Ajustes. Ver tambien: `docs/legal/descargo-whoop.md`.

## 8. Menores

El servicio no está dirigido a menores de edad. No recopilamos conscientemente
datos de menores sin consentimiento de quien ejerza la patria potestad.

## 9. Cambios

Podemos actualizar esta política; los cambios relevantes se comunicarán y la
fecha de "última actualización" reflejará la versión vigente.
