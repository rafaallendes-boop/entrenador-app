# Entrenador App

Dashboard personal para centralizar planificación y seguimiento de squash, running, fuerza y movilidad.

## Estado actual

- Frontend React + TypeScript + Vite
- Persistencia local con Dexie / IndexedDB
- PWA instalable
- Funciona offline después de la primera carga
- Coach IA todavía en modo mock por defecto

## Qué resuelve ahora

- Ver tu semana en un solo lugar
- Marcar sesiones realizadas, ajustadas o saltadas
- Registrar sueño, energía, dolor y comentario post-sesión
- Ver adherencia semanal y volumen real vs planificado
- Instalar la app en el celular como acceso directo

## Instalar en el celular

### Android

1. Abre la app en Chrome.
2. Toca `Instalar app` si aparece la tarjeta dentro de la app.
3. Si no aparece, abre el menú del navegador y elige `Instalar app` o `Agregar a pantalla principal`.

### iPhone

1. Abre la app en Safari.
2. Toca compartir.
3. Elige `Agregar a pantalla de inicio`.

## Usarla fuera de tu casa

Para eso no basta con tener PWA. La app tiene que estar desplegada en una URL pública con HTTPS.

Opciones recomendadas:

- `Vercel`: la más simple para este proyecto
- `Netlify`: también válida
- `Cloudflare Pages`: buena si luego quieres edge functions para el coach

Flujo recomendado:

1. Sube este repo a GitHub.
2. Conecta el repo a Vercel o Netlify.
3. Configura build command: `npm run build`
4. Configura output directory: `dist`
5. Abre la URL pública desde tu celular.
6. Instálala como app.

## Importante sobre los datos

Hoy los datos viven localmente en el navegador del dispositivo.

Eso significa:

- si usas la app en tu notebook y en tu celular, no comparten datos
- si borras datos del navegador del celular, pierdes la info local
- para sincronización real entre dispositivos necesitas backend

Si tu prioridad es usarla solo desde tu celular, este modelo sigue siendo válido por ahora.

## Próximo paso recomendado

Antes de conectar un LLM real:

1. Usa esta app como sistema principal durante 1-2 semanas.
2. Verifica que el flujo diario te sirva de verdad.
3. Luego conecta el coach IA para ajustes estructurados del plan, no solo chat.

## Coach IA

La app usa respuestas mock salvo que definas:

- `VITE_AI_PROVIDER=claude`
- `VITE_AI_API_KEY=...`

No es recomendable dejar la API key en frontend para uso real. El siguiente paso correcto es mover el LLM a un backend o edge function.
