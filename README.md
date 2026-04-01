# Entrenador App

Dashboard personal para centralizar planificacion y seguimiento de squash, running, fuerza y movilidad.

## Estado actual

- Frontend React + TypeScript + Vite
- Persistencia local con Dexie / IndexedDB
- PWA instalable
- Funciona offline despues de la primera carga
- Coach AI con flujo de propuestas ejecutables
- Backup JSON con exportacion e importacion

## Que resuelve hoy

- Ver la semana en un solo lugar
- Marcar sesiones realizadas, ajustadas o saltadas
- Registrar sueno, energia, dolor, peso y comentario post-sesion
- Ver adherencia semanal y volumen real vs planificado
- Conversar con el coach y aplicar propuestas
- Exportar e importar el backup local
- Instalar la app en el celular como acceso directo

## Uso local

```bash
npm install
npm run dev
```

Build de produccion:

```bash
npm run build
```

## Instalar en el celular

### Android

1. Abre la app en Chrome.
2. Toca `Instalar app` si aparece la tarjeta dentro de la app.
3. Si no aparece, abre el menu del navegador y elige `Instalar app` o `Agregar a pantalla principal`.

### iPhone

1. Abre la app en Safari.
2. Toca compartir.
3. Elige `Agregar a pantalla de inicio`.

## Despliegue

Para usarla fuera de tu casa necesitas una URL publica con HTTPS.

Opciones recomendadas:

- `Netlify`
- `Vercel`
- `Cloudflare Pages`

Configuracion base:

1. Sube el repo a GitHub.
2. Conecta el repo al proveedor.
3. Usa `npm run build` como build command.
4. Usa `dist` como output directory.

## Datos y backups

Hoy los datos viven localmente en el navegador del dispositivo.

Eso significa:

- notebook y celular no comparten datos automaticamente
- si borras los datos del navegador, pierdes la info local
- para sincronizacion real entre dispositivos todavia falta backend

Mitigacion actual:

- exportar backup JSON desde Ajustes
- importar ese backup JSON en otro navegador o despues de una limpieza local

## Coach AI

La app soporta varios providers:

- `mock`
- `proxy`
- `gemini`
- `claude`
- `openai`

En produccion debe usarse `proxy` para no exponer keys en el frontend.

