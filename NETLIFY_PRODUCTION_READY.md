# Entrenador App — Producción en Netlify

Actualizado: 2026-03-30

---

## 1. Qué se corrigió

### Problema original
La API key de Gemini vivía en `VITE_GEMINI_API_KEY` → Vite la incrustaba literalmente en el JS del bundle. Cualquiera que inspeccionara el bundle podía extraer la key.

### Solución implementada
- **Nueva Netlify Function** `netlify/functions/coach.ts`: proxy backend seguro que llama a Gemini/OpenAI/Claude usando `process.env.GEMINI_API_KEY`. La key nunca sale del servidor.
- **Nuevo `ProxyProvider.ts`**: el frontend llama a `/.netlify/functions/coach` (HTTP POST), sin conocer la key.
- **`CoachEngine.ts` actualizado**: en producción (`import.meta.env.PROD=true`) siempre usa `ProxyProvider`, sin importar la variable `VITE_AI_PROVIDER`.
- **`.env` limpio**: removida `VITE_GEMINI_API_KEY`. La key del servidor usa `GEMINI_API_KEY` (sin prefijo `VITE_`, invisible al bundle).
- **Verificado**: el bundle de producción `dist/assets/index-DHDHV6NM.js` no contiene ninguna API key real.

---

## 2. Flujo completo de IA (producción)

```
Usuario escribe mensaje
        │
useChatStore.sendMessage()
        │
CoachEngine.send()
  ├── buildCoachSystemPrompt(context)   ← construido en el frontend
  └── ProxyProvider.call()
        │
        ▼
POST /.netlify/functions/coach
  { systemPrompt, userMessage, maxTokens, temperature }
        │
        ▼
netlify/functions/coach.ts  (servidor Node.js 18+)
  ├── lee process.env.AI_PROVIDER  → "gemini"
  ├── lee process.env.GEMINI_API_KEY  → key real
  └── POST https://generativelanguage.googleapis.com/...
        │
        ▼
Gemini 1.5 Flash responde
        │
        ▼
Function retorna { text, provider: "gemini", model: "gemini-1.5-flash" }
        │
        ▼
ProxyProvider retorna AIRawResponse
        │
responseNormalizer → extrae <actions>, limpia mensaje
        │
useChatStore → guarda en Dexie, actualiza UI
        │
ChatBubble muestra respuesta + badge "Gemini Flash"
```

---

## 3. Variables de entorno

### En Netlify (dashboard → Site settings → Environment variables)

| Variable | Valor | Dónde se usa |
|----------|-------|--------------|
| `AI_PROVIDER` | `gemini` | Function: selecciona el proveedor |
| `GEMINI_API_KEY` | `AIzaSy...` (tu key real) | Function: autenticación con Gemini |

Para migrar a OpenAI: cambia `AI_PROVIDER=openai` y añade `OPENAI_API_KEY=sk-proj-...`
Para migrar a Claude: cambia `AI_PROVIDER=claude` y añade `CLAUDE_API_KEY=sk-ant-...`

### En `.env` local (gitignored, solo para desarrollo)

```bash
# Para dev offline (no necesita key):
VITE_AI_PROVIDER=mock

# Para dev con IA real (requiere netlify dev):
# VITE_AI_PROVIDER=proxy
# GEMINI_API_KEY=AIzaSy...    ← sin prefijo VITE_, solo para netlify dev
```

### Variables que NO deben existir en producción

| Variable | Por qué |
|----------|---------|
| `VITE_GEMINI_API_KEY` | Quedaría embebida en el bundle JS del cliente |
| `VITE_CLAUDE_API_KEY` | Ídem |
| `VITE_OPENAI_API_KEY` | Ídem |

Estas variables tienen prefijo `VITE_` → Vite las incrusta en el bundle. **Nunca configurarlas en Netlify.** Solo existen en `.env` local para dev sin proxy.

---

## 4. Cómo correr localmente

### Opción A — Offline (mock, sin API key, default)

```bash
npm run dev
# App en localhost:5173
# Coach usa MockProvider con respuestas keyword-based
```

### Opción B — Con IA real (requiere netlify-cli)

```bash
# 1. Instalar netlify CLI (una sola vez)
npm install -g netlify-cli

# 2. En .env, cambiar:
#   VITE_AI_PROVIDER=proxy
#   GEMINI_API_KEY=tu_clave_aqui   (sin prefijo VITE_)

# 3. Arrancar
netlify dev
# App en localhost:8888
# Function en localhost:8888/.netlify/functions/coach
# Coach usa Gemini via la function local
```

---

## 5. Cómo hacer build

```bash
npm run build
# Genera dist/ con:
#   - VITE_AI_PROVIDER ignorada (CoachEngine fuerza 'proxy' en PROD)
#   - Sin ninguna API key en el bundle
#   - El proveedor real se resuelve en la function y vuelve en la respuesta
```

Verificar que el build es seguro:
```bash
grep -c "AIza" dist/assets/*.js   # debe ser 0
```

---

## 6. Cómo redeployar en Netlify

**Opción A — Manual (drag & drop)**
1. `npm run build`
2. Sube la carpeta `dist/` en Netlify → tu sitio → Deploys → "drag and drop"

**Opción B — Via CLI**
```bash
npm run build
netlify deploy --prod --dir dist
```

**Opción C — CI (push a git)**
Si conectas el repo a Netlify, cada push a `main` dispara un build automático.
Netlify leerá `netlify.toml` y ejecutará `npm run build`.
Las env vars del dashboard estarán disponibles para la function automáticamente.

---

## 7. Arquitectura de archivos nueva

```
netlify/
  functions/
    coach.ts          ← función backend segura (nueva)

src/
  services/
    ai/
      CoachEngine.ts          ← usa ProxyProvider en PROD (actualizado)
      providers/
        ProxyProvider.ts      ← llama a /.netlify/functions/coach (nuevo)
        GeminiProvider.ts     ← solo para dev local directo (no en PROD)
        ClaudeProvider.ts     ← solo para dev local directo
        OpenAIProvider.ts     ← solo para dev local directo
        MockProvider.ts       ← para offline y tests

netlify.toml             ← añadido: functions="netlify/functions", esbuild
tsconfig.node.json       ← añadido: include "netlify/functions"
.env                     ← limpiado: sin VITE_GEMINI_API_KEY
.env.production          ← VITE_AI_PROVIDER=proxy (documentación)
```

---

## 8. Checklist final de producción

- [x] API key **no está** en el bundle JS del cliente
- [x] `GEMINI_API_KEY` solo accesible via `process.env` en la function
- [x] Build pasa `tsc -b` sin errores
- [x] `dist/` generado correctamente (nuevo hash: `index-DHDHV6NM.js`)
- [x] `netlify.toml` configura functions directory y esbuild bundler
- [x] `CoachEngine` usa `ProxyProvider` en cualquier build de producción
- [x] `.env` no tiene `VITE_GEMINI_API_KEY`
- [x] `.gitignore` protege `.env` (tiene claves locales)
- [x] `.env.production` no tiene claves reales
- [x] Function soporta los 3 proveedores: Gemini, OpenAI, Claude
- [x] Errores de la function propagados correctamente al frontend (`AIProviderError`)
- [ ] Verificar en Netlify que `AI_PROVIDER` y `GEMINI_API_KEY` están configuradas ← **ya lo hiciste (screenshot)**
- [ ] Primer deploy exitoso y test real de mensaje al coach

---

## 9. Migrar a OpenAI o Claude (cuando quieras)

### Cambiar a OpenAI

1. En Netlify dashboard, actualiza las variables de entorno:
   - `AI_PROVIDER` → `openai`
   - Añade `OPENAI_API_KEY` → `sk-proj-...`
2. Redeploy (o trigger manual en Netlify)
3. La function `coach.ts` ya tiene `callOpenAI()` implementado — no hay cambios de código.

### Cambiar a Claude

1. En Netlify dashboard:
   - `AI_PROVIDER` → `claude`
   - Añade `CLAUDE_API_KEY` → `sk-ant-api03-...`
2. Redeploy
3. La function `coach.ts` ya tiene `callClaude()` implementado.

### Cambiar el modelo

Para usar un modelo diferente del default, la function usa estos defaults:
```
gemini → gemini-1.5-flash
openai → gpt-4o-mini
claude → claude-sonnet-4-6
```

Para cambiar: añade una variable `GEMINI_MODEL`, `OPENAI_MODEL` o `CLAUDE_MODEL` en Netlify, y lee `process.env['GEMINI_MODEL']` en `coach.ts`. (Hoy está hardcodeado en `DEFAULT_MODELS`.)

---

## 10. Decisiones de diseño

**¿Por qué el prompt se construye en el frontend y no en la function?**
El frontend tiene acceso directo a los datos del usuario (Dexie/Zustand). Pasar el contexto completo al servidor requeriría serializar sesiones, day logs, etc. Es más simple construir el prompt completo en el cliente y enviar solo `{ systemPrompt, userMessage }` al servidor. La function es un proxy thin, no un backend de negocio.

**¿Por qué el badge puede cambiar después de la primera respuesta?**
Antes de recibir una respuesta, la UI solo sabe que está usando `proxy` o un proveedor local. Después de la llamada, el servidor retorna `provider: "gemini" | "openai" | "claude"` y ese valor pasa a ser la fuente de verdad para el historial y el badge del chat.

**¿Por qué no `@netlify/functions` package?**
Evita una dependencia externa. Los tipos inline son suficientes. El esbuild bundler de Netlify compila TypeScript nativo sin necesidad del paquete.
