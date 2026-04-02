# Entrenador App - Produccion en Netlify

Actualizado: 2026-04-02

## 1. Objetivo

Desplegar la app en Netlify sin exponer API keys en el frontend.

La arquitectura correcta en produccion es:

- frontend Vite servido por Netlify
- llamadas AI desde el cliente hacia `/.netlify/functions/coach`
- keys reales solo en variables de entorno del servidor

## 2. Flujo de produccion

```text
Usuario
  -> ChatCoach / CoachEngine
  -> ProxyProvider
  -> /.netlify/functions/coach
  -> proveedor real (Gemini / OpenAI / Claude)
  -> respuesta normalizada al frontend
```

Punto importante:

- el bundle cliente no debe contener `GEMINI_API_KEY`, `OPENAI_API_KEY` ni `CLAUDE_API_KEY`

## 3. Variables de entorno en Netlify

Configurar en `Site settings -> Environment variables`:

- `AI_PROVIDER=gemini`
- `GEMINI_API_KEY=...`

Alternativas:

- `AI_PROVIDER=openai` y `OPENAI_API_KEY=...`
- `AI_PROVIDER=claude` y `CLAUDE_API_KEY=...`

No usar en produccion:

- `VITE_GEMINI_API_KEY`
- `VITE_OPENAI_API_KEY`
- `VITE_CLAUDE_API_KEY`

Todo lo que empiece con `VITE_` puede terminar embebido en el bundle del cliente.

## 4. Desarrollo local

Modo mock:

```bash
npm run dev
```

Modo proxy con Netlify:

```bash
netlify dev
```

Variables locales de ejemplo:

```bash
VITE_AI_PROVIDER=proxy
GEMINI_API_KEY=tu_clave_local
```

## 5. Build

```bash
npm run build
```

Resultado esperado:

- se genera `dist/`
- el frontend queda apuntando a `ProxyProvider` en produccion
- las keys reales no viajan al cliente

## 6. Deploy

Opciones:

### A. Repo conectado a Netlify

Cada push a `main` dispara build y deploy automatico.

### B. Deploy manual por CLI

```bash
npm run build
netlify deploy --prod --dir dist
```

No conviene usar drag and drop de `dist/` si dependes de `netlify/functions/coach`.

## 7. Archivos relevantes

- `netlify/functions/coach.ts`
- `src/services/ai/CoachEngine.ts`
- `src/services/ai/providers/ProxyProvider.ts`
- `netlify.toml`
- `.env.production`

## 8. Checklist

- [x] API key fuera del bundle del cliente
- [x] `ProxyProvider` activo en produccion
- [x] function `coach.ts` desplegable en Netlify
- [x] build de produccion pasando
- [x] variables reales configuradas en Netlify
- [x] prueba real del coach en entorno desplegado

## 9. Notas

- Si cambias de proveedor, el cambio principal es de variables de entorno.
- Si quieres cambiar modelos por proveedor, conviene centralizarlo en la function.
- Si el deploy falla, revisar primero variables de entorno, `netlify.toml` y logs de la function.

