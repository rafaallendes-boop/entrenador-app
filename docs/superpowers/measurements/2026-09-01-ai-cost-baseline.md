# Línea base de costo IA — 2026-09-01

## Método y ventana

Consulta de sólo lectura ejecutada en producción el `2026-09-01T20:15:58Z`, con
ventana `created_at >= now() - interval '7 days'` sobre
`public.coach_requests`. Las columnas corresponden a
`supabase/018_coach_requests.sql`.

Esta medición cubre requests del Coach síncrono. Plan Builder async tiene su
telemetría separada (016), por lo que sus costos no se infieren de esta tabla.

## Resultado crudo por clase

| Clase | Filas | Filas con costo | Cobertura filas | Tokens totales | Tokens con costo | Cobertura tokens | In p50 / p90 / max | Out p50 / p90 / max | Costo p50 / p90 / max (USD) | Retry / fallback |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `chat_action` | 6 | 6 | 100.0% | 31,561 | 31,561 | 100.0% | 6,242 / 6,923 / 6,923 | 471 / 827 / 827 | 0.003050 / 0.004086 / 0.004086 | 0.0% / 0.0% |
| `week_creator` | 3 | 0 | 0.0% | 1,648 | — | — | 1,057 / 1,057 / 1,057 | 591 / 591 / 591 | — / — / — | 0.0% / 0.0% |
| `chat_general` | 2 | 1 | 50.0% | 2,124 | 2,124 | 100.0% | 2,123 / 2,123 / 2,123 | 1 / 1 / 1 | 0.000639 / 0.000639 / 0.000639 | 0.0% / 0.0% |
| `coach_assistant_message` | 2 | 1 | 50.0% | 238 | 238 | 100.0% | 204 / 204 / 204 | 34 / 34 / 34 | 0.000146 / 0.000146 / 0.000146 | 0.0% / 0.0% |

Agregado de las clases observadas: 13 filas, 9 con costo (69.2%); 35,571
tokens, 33,923 en filas con costo (**95.4% de cobertura por tokens**).

## Veredicto

1. La cobertura agregada por tokens supera 80%, pero no es suficiente para
   congelar costos: `week_creator` tiene 0% de cobertura y todas las clases
   relevantes están bajo el mínimo de 30 filas. Cada clase queda marcada como
   **muestra insuficiente**.
2. Para `chat_action`, `in_p50 = 6,242` está razonablemente cerca del supuesto
   de ~8,000 tokens del spec; `in_p90 = 6,923` no lo duplica. Es una señal, no
   una validación estadística, por sus sólo seis filas.
3. Retry y fallback son 0% en las filas observadas. La evidencia es demasiado
   pequeña para validar la holgura 16/8: no se congelan cuotas ni caps a partir
   de este resultado.

**Decisión:** mantener todos los números de cuota y spend cap como
provisionales. Volver a ejecutar esta consulta después de una semana con al
menos 30 filas por clase relevante y costos registrados para `week_creator`.
