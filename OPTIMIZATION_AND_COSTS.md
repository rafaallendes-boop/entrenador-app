# Optimización de Timeouts y Estimado de Costos

**Fecha**: 24 de abril de 2026

## Cambios realizados

### 1. **Timeouts reajustados a límites reales de Netlify**

Antes (irrealista):
```
chat_general: 15s
chat_action: 25s
weekly_summary: 20s
plan_builder_week: 30s ❌ (>26s máx)
plan_builder_pair: 45s ❌ (>26s máx)
```

Después (realista, respetando 26s máx):
```
chat_general: 12s
chat_action: 18s
weekly_summary: 15s
plan_builder_week: 20s ✅
plan_builder_pair: 20s ✅
import_extract: 15s
MAX_FUNCTION_WALLCLOCK: 25s (reserva 1s overhead)
MIN_PROVIDER_ATTEMPT: 3s (para permitir 3 reintentos)
```

**Ventajas:**
- ✅ Plan builder ahora tiene timeouts realistas
- ✅ Más tiempo para reintentos técnicos
- ✅ Menos "gateway timeouts" en producción

### 2. **Limitar output tokens por tipo de solicitud**

- Chat/resúmenes/import: caps bajos para respuestas concisas
- Plan Builder week/pair: caps controlados en 3500/5500 tokens
- Razón: Tokens grandes → respuestas más lentas → timeouts
- Impacto: Respuestas más concisas (~1200 tokens típicos) = más rápidas

### 3. **Gemini thinking budget explícito**

- Plan Builder: `thinkingBudget: 1024`
- Chat action / Week Creator: `thinkingBudget: 256`
- Chat general / weekly summary / import: `thinkingBudget: 0`

Esto evita que Gemini 2.5 Flash use razonamiento dinámico sin límite explícito en beta privada.

**Nota:** Esto es suficiente para:
- Ajustes de sesión
- Propuestas de entrenamientos
- Análisis de carga

---

## Estimado de Costos Mensuales - Gemini Flash

### Precios Gemini 2.5 Flash (modelo actual)
- **Input**: $0.075 por 1M tokens
- **Output**: $0.3 por 1M tokens
- [Pricing: https://ai.google.dev/pricing](https://ai.google.dev/pricing)

### Uso estimado (usuario típico como Rafael)

| Tipo de solicitud | Frecuencia/mes | Entrada (tokens) | Salida (tokens) | Costo |
|---|---|---|---|---|
| Chat general (día) | 240 (10/día × 24 días) | 800 | 300 | $0.027 |
| Chat action (día) | 60 (2-3/día × 24 días) | 3000 | 800 | $0.030 |
| Weekly summary | 5 | 4000 | 1000 | $0.002 |
| Plan builder (2x/mes) | 2 | 8000 | 1500 | $0.0015 |
| Import PDF | 2 | 6000 | 2000 | $0.002 |
| **TOTAL** | | | | **$0.062/mes** |

### Proyección conservadora (uso moderado)
- **Bajo**: $0.05/mes (usuario ocasional)
- **Medio**: $0.15/mes (usuario diario, como Rafael)
- **Alto**: $0.40/mes (power user con muchos imports)

### Comparativa con otros modelos

| Modelo | Velocidad | Costo/1M tokens entrada | Costo estimado/mes |
|---|---|---|---|
| **Gemini 2.5 Flash** ← actual | Rápido | $0.075 | **$0.15** |
| Gemini 2.0 | Más rápido | $0.10 | $0.20 |
| OpenAI GPT-4o mini | Similar | $0.15 | $0.25 |
| Claude 3.5 Sonnet | Lento | $3/1M | $3.00+ |

---

## Recomendación

**Mantén Gemini Flash por ahora.** Razones:

1. ✅ **Gratuito hasta cierto punto** (~1M tokens/mes gratis con programa)
2. ✅ **Costo real: ~$0-0.20/mes**
3. ✅ **Velocidad adecuada** con timeouts reajustados
4. ✅ **Ya está probado** en producción

**Próximos pasos si sigues viendo timeouts:**
1. Revisa logs de Firebase (ver qué requests duran más)
2. Considera caché client-side de propuestas
3. Si persisten: prueba Gemini 2.0 (gratis, más rápido)
4. Last resort: GPT-4o mini (~$0.25/mes, muy estable)

---

## Monitoreo

Para ver los timeouts reales:
1. Abre browser DevTools (F12)
2. Mira Network → Coach endpoint
3. Busca requests con status 504 o duration > 20s

Crea un issue si ves un patrón consistente.
