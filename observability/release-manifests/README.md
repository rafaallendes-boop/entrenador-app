# Manifiestos de release

Un archivo `<release>.json` por build **efectivamente distribuido** que siga
soportado. Cada uno declara los basenames JS que ese release publicó:

```json
{ "formatVersion": 1, "release": "a1b2c3d4", "assets": ["index-a1b2c3.js"] }
```

Son metadatos de assets públicos: los nombres ya son visibles en la red de
cualquier visitante. **No** llevan rutas locales, fuentes, sourcemaps,
credenciales ni datos de usuarios.

Para qué sirven: la pertenencia a este inventario es la barrera que valida los
frames de `client_error_events`. Una gramática de basename aceptaría
`MariaPerez.js`; el manifiesto no.

## Cómo se mantiene

`scripts/generate-release-manifest.mjs` corre dentro de `npm run build`, arma el
manifiesto del build actual y lo une con los de acá en
`netlify/functions/_shared/generatedReleaseCatalog.json`, que la función importa
estáticamente.

**Antes de distribuir un sucesor**, copiar acá el manifiesto del build que salió
a producción (`dist/observability/releases/<release>.json`). Es un paso del
rollout, no una escritura automática a git: sin él, las pestañas que sigan en el
release anterior pierden sus frames — y son justo las que producen `chunk_load`
después de un deploy.

Un release que se retira de soporte se declara fuera de soporte y su archivo se
puede quitar; sus eventos siguen existiendo, sólo pasan a ser categóricos.
El catálogo no se poda automáticamente en v1.
