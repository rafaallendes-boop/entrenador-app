# iOS con Capacitor

## Arquitectura

RallyIQ mantiene una única aplicación React + TypeScript + Vite. Capacitor 8 empaqueta el contenido de `dist/` dentro del binario iOS; no existe `server.url` y la app no depende de localhost ni de un sitio remoto para arrancar.

La integración es deliberadamente incremental:

- React Router, Zustand, Dexie/IndexedDB, Coach AI, Plan Builder y el sync conservan sus contratos.
- `src/services/platform.ts` es la fuente única para distinguir web, iOS y otras plataformas Capacitor.
- La PWA sigue registrando `public/sw.js` en web; dentro de Capacitor no se registra ningún service worker.
- Supabase usa PKCE, un redirect web configurable y `rallyiq://auth/callback` en iOS.
- Web Notification/service worker se conserva en web; `@capacitor/local-notifications` programa recordatorios locales en iOS.
- `@capacitor/app` entrega deep links y lifecycle. Al reanudar, el sync reutiliza el lock y cooldown existentes y solo se dispara con usuario y conectividad.
- Dexie sigue siendo la base local. No hay SQLite en esta fase.

## Requisitos

- macOS.
- Node.js 22 o superior para Capacitor 8 (el proyecto web también admite Node 20.19+, pero los comandos Capacitor 8 requieren Node 22+).
- npm 10 o superior.
- Xcode completo, con Command Line Tools seleccionadas mediante `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- iOS 15 o superior (deployment target generado por Capacitor 8).
- Swift Package Manager. Los plugins incluidos publican `Package.swift`; no se requiere CocoaPods para esta integración.
- Cuenta Apple Developer y acceso a App Store Connect para dispositivo real/TestFlight.

## Instalación y comandos

```bash
npm install
npm run build
npm run ios:sync
npm run ios:open
```

Scripts disponibles:

| Comando | Uso |
| --- | --- |
| `npm run cap:copy` | Copia `dist/` a las plataformas ya creadas. |
| `npm run cap:sync` | Copia assets y sincroniza plugins en todas las plataformas. |
| `npm run ios:add` | Crea `ios/` una sola vez; falla de forma segura si ya existe. |
| `npm run ios:sync` | Compila web y ejecuta `cap sync ios`. |
| `npm run build:ios` | Alias reproducible de `ios:sync`. |
| `npm run ios:open` | Abre el proyecto en Xcode. |

No ejecutar `cap add ios` de nuevo sobre el directorio existente. Para cambios web rutinarios, usar `npm run ios:sync`.

## Variables de entorno y secretos

Variables de cliente necesarias para auth/sync:

```bash
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_AUTH_REDIRECT_URL=https://app.rallyiq.cl/auth/callback
VITE_API_BASE_URL=https://TU-SITIO-NETLIFY-O-DOMINIO-PRODUCCION
VITE_AI_PROVIDER=proxy
```

La anon/publishable key de Supabase puede estar en el cliente y queda limitada por RLS. Nunca usar `SUPABASE_SERVICE_ROLE_KEY`, secretos de Whoop ni API keys de proveedores AI como variables `VITE_*` en un build distribuible. Producción debe usar el proxy de IA; los secretos viven en Netlify/Supabase/server.

`VITE_AUTH_REDIRECT_URL` solo gobierna web. En Capacitor, la aplicación selecciona `rallyiq://auth/callback` explícitamente.

`VITE_API_BASE_URL` es obligatoria para el build nativo y debe ser el origen HTTPS
que publica las Netlify Functions (sin `/.netlify/functions` al final). La web
conserva rutas same-origin; iOS usa este origen porque su contenido local vive en
`capacitor://localhost`. El backend admite el preflight CORS de Capacitor sin
cookies: la sesión se autoriza con el bearer token de Supabase.

## Supabase Auth y deep links

En Supabase Dashboard → Authentication → URL Configuration:

1. Mantener `Site URL` en el origen HTTPS de producción.
2. Agregar a Additional Redirect URLs:
   - `https://app.rallyiq.cl/auth/callback` (ajustar al dominio real).
   - los redirects web de preview/desarrollo que se usen.
   - `rallyiq://auth/callback`.
3. Mantener Google OAuth apuntando al callback de Supabase que muestra el Dashboard; no al custom scheme directamente.

El scheme `rallyiq` está registrado en `ios/App/App/Info.plist`. El listener de `appUrlOpen` y `getLaunchUrl()` cubre app abierta y cold start. El callback acepta el `code` PKCE recomendado por Supabase y mantiene compatibilidad defensiva con `access_token`/`refresh_token`. Una misma URL se procesa una sola vez.

Antes de salir a OAuth se guarda una continuación interna y cualquier `claim_token`/`invitation_token` presente. Hoy el repositorio no implementa rutas ni un contrato funcional de claim/invitaciones: solo existe como trabajo futuro en el RFC. Por eso esta base preserva el contexto pero no inventa el claim ni altera la creación de atleta self. Antes de habilitar claims se debe procesar ese contexto antes del backfill/sync inicial y agregar pruebas de extremo a extremo.

## Persistencia de sesión

Web conserva el storage actual. iOS usa una interfaz `AuthStorage` respaldada por `@capacitor/preferences`, incluida la persistencia del verificador PKCE y la sesión Supabase. Esto evita depender directamente de `window.localStorage`, pero Preferences no cifra valores con Keychain.

No se agregó un plugin comunitario de Secure Storage en esta fase: no hay equivalente first-party en la lista de Capacitor usada y añadir uno sin una decisión de mantenimiento/migración aumentaría el riesgo. Antes de TestFlight externo se debe elegir y auditar un adaptador Keychain mantenido, agregar migración desde Preferences, rotación/logout y tests en dispositivo. Hasta entonces, tratar la persistencia de sesión iOS como deuda de seguridad bloqueante para una beta externa amplia.

Los datos deportivos permanecen en Dexie/IndexedDB y no se migran a Preferences ni SQLite.

## Notificaciones iOS

- El permiso solo se solicita al pulsar la acción de notificaciones en Ajustes.
- La app no muestra el prompt al arrancar.
- Los IDs nativos se derivan de tags estables; reprogramar reemplaza el recordatorio y cancelar elimina el mismo ID.
- Las fechas se construyen en zona horaria local.
- Al reanudar se reconcilian recordatorios pendientes y se eliminan los obsoletos de RallyIQ.
- Denegación se representa en la UI y no bloquea la app.
- No se implementan APNs ni push remoto.

Local Notifications no necesita una clave de uso en `Info.plist`. El usuario puede revocar el permiso en Ajustes de iOS.

## Lifecycle, navegación y UI

El contenedor configura status bar oscura, splash manual, resize nativo de teclado, viewport con `viewport-fit=cover`, safe-area inferior y orientación vertical. Los enlaces HTTP/HTTPS externos se abren con Capacitor Browser; navegación interna continúa en React Router. Whoop abre en Capacitor Browser, pero su retorno nativo requiere un redirect de servidor compatible y debe validarse antes de habilitarlo en TestFlight.

Al volver a foreground se emite un único intento hacia el sync existente. El intento se omite sin sesión o sin conectividad y respeta `syncInFlight`, cooldown, cola offline y bloqueos de schema. No se fuerza reload ni se modifican RLS.

## Simulador

1. Ejecutar `npm run ios:sync`.
2. Ejecutar `npm run ios:open`.
3. En Xcode, elegir un simulador iPhone con iOS 15+.
4. Seleccionar el target `App` y pulsar Run.
5. Probar un deep link con:

```bash
xcrun simctl openurl booted "rallyiq://auth/callback?error=smoke_test"
```

El login Google real puede imponer restricciones en simulador; validar también en dispositivo.

## Dispositivo real

1. Configurar Team en Signing & Capabilities.
2. Confirmar bundle identifier `cl.rallyiq.app` o cambiarlo de forma coordinada en Capacitor, Xcode, Apple y Supabase antes del primer upload.
3. Conectar el iPhone, confiar en el equipo y seleccionar el dispositivo.
4. Ejecutar, aceptar el perfil de desarrollo si iOS lo solicita y validar auth, background/foreground, archivos y notificaciones.

## App icon, splash, versión y build

- Nombre visible: RallyIQ.
- Bundle ID inicial: `cl.rallyiq.app`.
- Marketing version inicial: `1.0`.
- Build inicial: `1`.
- El App Icon de 1024×1024 fue rasterizado desde el asset web existente; no depende del SVG en Xcode. Debe pasar revisión visual/alpha de App Store antes de subir.
- El splash generado por Capacitor sigue siendo placeholder y debe reemplazarse por rendiciones aprobadas de RallyIQ en `Splash.imageset`/LaunchScreen. No se inventó branding alternativo.

Incrementar `MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` en Xcode para cada entrega. No reutilizar un build number ya subido.

## Preparación para TestFlight

1. Resolver la deuda Keychain antes de beta externa.
2. Reemplazar/verificar splash y aprobar App Icon en todos los modos requeridos por App Store Connect.
3. Configurar Team, signing automático, App ID y registro `cl.rallyiq.app`.
4. Confirmar redirects Supabase y login Google en dispositivo.
5. Confirmar privacy details, URL de privacidad y cuestionario de cifrado/export compliance.
6. Mantener `VITE_AI_PROVIDER=proxy` y verificar que el bundle no contiene secretos.
7. Ejecutar quality gates y el smoke test completo.
8. En Xcode seleccionar Any iOS Device (arm64) → Product → Archive → Distribute App → App Store Connect.
9. Subir, esperar procesamiento y distribuir primero a testers internos.

## Smoke test

Los siguientes casos requieren validación manual en simulador/dispositivo; marcar evidencia por build:

- [ ] Arranque sin login, sin prompt automático de notificaciones.
- [ ] Login Google y retorno por `rallyiq://auth/callback`.
- [ ] Error/cancelación OAuth vuelve a una app utilizable.
- [ ] Logout y nuevo login.
- [ ] Persistencia de sesión después de terminar y volver a abrir la app.
- [ ] Crear y editar una sesión.
- [ ] Completar una sesión y registrar feedback/check-in.
- [ ] Uso offline con lectura/escritura local.
- [ ] Reconexión vacía la cola y no duplica sync.
- [ ] Background → foreground no dispara sync concurrente.
- [ ] Cambio entre atleta self y atleta gestionado, sin mezcla de datos.
- [ ] Coach AI funciona mediante proxy y sin keys en el bundle.
- [ ] Plan Builder crea/reanuda/acepta un plan.
- [ ] Input y lectura/importación de PDF en iOS.
- [ ] Importación y exportación de backup JSON; verificar el destino real del archivo en iOS.
- [ ] Permiso denegado de notificaciones no rompe Ajustes.
- [ ] Recordatorio local se reemplaza, entrega en hora local, abre la ruta y puede cancelarse.
- [ ] Apertura de deep link con app cerrada y abierta.
- [ ] Whoop abre el browser, retorna por `rallyiq://settings` y actualiza el estado conectado.
- [ ] Claim pendiente, cuando exista el flujo de producto (actualmente no implementado).
- [ ] Web/PWA: instalación, service worker, login, notificaciones y offline sin regresiones.

## Limitaciones actuales

- La sesión iOS se persiste en Preferences, no Keychain.
- Claim/invitaciones no tienen implementación ni rutas actuales; solo se preserva contexto futuro.
- El callback OAuth web existente depende de la detección automática de Supabase; la ruta `/auth/callback` cae al router normal después de restaurar sesión.
- Whoop requiere que `WHOOP_REDIRECT_URI` siga apuntando al callback HTTPS del backend; ese callback devuelve después a `rallyiq://settings` solo para flujos iniciados desde iOS.
- Downloads mediante `<a download>` y file inputs funcionan a nivel WebView, pero PDF/backup deben validarse manualmente con Files en dispositivo. No se añadió Filesystem/Share en esta fase.
- Splash nativo es placeholder.
- No se pudo compilar/ejecutar con `xcodebuild` en un host que solo tenga Command Line Tools; requiere Xcode completo.
- Las fuentes de Google y algunas imágenes de landing son remotas; las pantallas autenticadas y assets funcionales están en el bundle, pero una primera landing completamente offline puede degradar tipografía/imagen.
- `npm audit --omit=dev` reporta vulnerabilidades existentes en `@anthropic-ai/sdk`, `react-router`/`react-router-dom` y `ws` (1 moderada, 3 altas). Ninguna corresponde a los paquetes Capacitor añadidos. Las correcciones implican actualizar dependencias fuera del alcance de esta base y deben priorizarse antes de distribución externa.

## Rollback

La integración es aditiva. Para rollback de una release iOS, distribuir el build anterior en TestFlight/App Store y retirar el nuevo. Para rollback de código, revertir los commits de Capacitor y eliminar los scripts/módulos nativos; la PWA, Dexie y schema remoto no requieren migración inversa porque no se modificaron. No borrar `ios/` para resolver errores locales: regenerarlo perdería signing, assets y cambios de Xcode.

## Fuera de alcance

- HealthKit.
- Apple Watch.
- Push remoto/APNs.
- Migración de Dexie/IndexedDB a SQLite.
- Reescritura en SwiftUI.
- Cambios de reglas deportivas, RLS, Coach AI o Plan Builder.
