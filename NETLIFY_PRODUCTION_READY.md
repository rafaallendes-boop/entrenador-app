# Entrenador App - Deploy seguro en Netlify

Actualizado: 2026-04-05

## Objetivo

Desplegar Entrenador en Netlify sin exponer claves de IA en el frontend.

La idea central es simple:

- el cliente React nunca debe llamar directamente al proveedor AI con una API key real
- el frontend debe hablar con una function serverless propia
- las claves reales deben vivir solo en variables de entorno del servidor

## Arquitectura recomendada

En producción el flujo correcto es:

```text
Usuario
  -> App React / PWA
  -> CoachEngine
  -> ProxyProvider
  -> /.netlify/functions/coach
  -> proveedor AI real (Gemini / OpenAI / Claude)
  -> respuesta normalizada al frontend
```

Esto evita que una key sensible termine:

- embebida en el bundle
- visible en DevTools
- expuesta al inspeccionar requests del navegador

## Qué se despliega en Netlify

### Frontend

- build de Vite generado en `dist/`

### Backend ligero

- function Netlify en [coach.ts](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/netlify/functions/coach.ts)

### Configuración

- [netlify.toml](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/netlify.toml)

## Archivos clave

- [netlify.toml](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/netlify.toml)
- [coach.ts](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/netlify/functions/coach.ts)
- [README.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/README.md)

## Variables de entorno en Netlify

Configurar en:

`Site settings -> Environment variables`

### Variables base

- `AI_PROVIDER=gemini`

### Si usas Gemini

- `GEMINI_API_KEY=...`
- opcional: `GEMINI_MODEL=gemini-2.5-flash`

### Si usas OpenAI

- `AI_PROVIDER=openai`
- `OPENAI_API_KEY=...`
- opcional: `OPENAI_MODEL=gpt-4o-mini`

### Si usas Claude

- `AI_PROVIDER=claude`
- `CLAUDE_API_KEY=...`
- opcional: `CLAUDE_MODEL=claude-sonnet-4-6`

## Variables que NO debes usar para claves reales

No pongas claves sensibles en variables que empiecen con `VITE_`.

Ejemplos que no deben llevar secretos reales:

- `VITE_GEMINI_API_KEY`
- `VITE_OPENAI_API_KEY`
- `VITE_CLAUDE_API_KEY`

Razón:

todo lo que empiece con `VITE_` puede terminar expuesto en el bundle cliente.

## Configuración de `netlify.toml`

La configuración actual esperada es:

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Qué hace esto:

- ejecuta el build de Vite
- publica `dist`
- compila las functions desde `netlify/functions`
- mantiene routing SPA hacia `index.html`

## Desarrollo local

### Opción 1. Solo frontend

Útil para UI, estado local y trabajo sin IA real.

```bash
npm run dev
```

### Opción 2. Flujo completo con Netlify Functions

Útil para probar el proxy AI de forma parecida a producción.

```bash
netlify dev
```

Variables locales de ejemplo:

```bash
VITE_AI_PROVIDER=proxy
AI_PROVIDER=gemini
GEMINI_API_KEY=tu_clave_local
```

## Build de producción

```bash
npm run build
```

Resultado esperado:

- se genera `dist/`
- la app compila sin errores
- la function `coach` queda lista para deploy

## Deploy en Netlify

### Opción A. Repo conectado

Es la opción recomendada.

Flujo:

1. conectar el repositorio a Netlify
2. configurar variables de entorno
3. hacer push a la rama de despliegue
4. dejar que Netlify haga build + deploy

### Opción B. Deploy manual por CLI

```bash
npm run build
netlify deploy --prod --dir dist
```

Nota importante:

si dependes de `netlify/functions/coach`, no conviene tratar el deploy como un simple upload estático manual sin functions.

## Cómo verificar que el deploy quedó bien

Checklist mínimo:

- [x] la app carga correctamente
- [x] el routing SPA funciona
- [x] el coach responde usando el proxy
- [x] no hay claves visibles en el bundle del cliente
- [x] el provider configurado responde desde la function

Verificaciones útiles:

### 1. Revisar que el coach use el proxy

En producción, el cliente debería hablar con:

- `/.netlify/functions/coach`

no directamente con:

- `api.openai.com`
- `generativelanguage.googleapis.com`
- `api.anthropic.com`

### 2. Revisar que la key no esté expuesta

Después del deploy:

- abrir la app en el navegador
- inspeccionar requests y bundle
- comprobar que no aparezcan valores de keys reales

### 3. Probar un prompt real

Hacer una prueba sencilla en el chat:

- crear semana
- ajustar una sesión
- pedir una recomendación del coach

Si la respuesta llega desde la function y el formato del coach se mantiene, la ruta está bien.

## Troubleshooting

### El coach falla con error 500

Revisar:

- variable `AI_PROVIDER`
- key del provider correspondiente
- nombre del modelo si se configuró manualmente
- logs de la function en Netlify

### El coach no responde o responde en modo demo

Revisar:

- que el frontend esté usando `proxy`
- que la function esté desplegada
- que las variables del sitio estén disponibles en el entorno correcto

### La app carga, pero el chat no funciona en producción

Revisar:

- `netlify.toml`
- existencia de `netlify/functions/coach.ts`
- logs del deploy
- logs de la function

### El routing de React se rompe al refrescar

Revisar el redirect SPA:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## Buenas prácticas recomendadas

- centralizar la selección de provider en la function, no en el cliente
- cambiar modelos vía variables de entorno cuando sea posible
- usar `proxy` en producción como política por defecto
- no mezclar secretos del servidor con variables `VITE_*`
- validar en cada deploy que el bundle cliente no expose secretos

## Qué no cubre este documento

Este documento se enfoca en:

- deploy seguro del frontend
- uso del proxy AI en Netlify

No cubre en detalle:

- configuración de Supabase
- modelado interno del coach
- roadmap del producto

Para eso ver:

- [README.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/README.md)
- [PROJECT_REVIEW_AND_ROADMAP.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/PROJECT_REVIEW_AND_ROADMAP.md)
