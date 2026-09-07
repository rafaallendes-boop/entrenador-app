/**
 * Identificador del build, inyectado por Vite (`define`) desde `APP_RELEASE` o
 * `COMMIT_REF`. Ver `vite.config.ts` y §9.1 del spec del reporter de errores.
 *
 * Vale `'dev'` fuera de un build de despliegue. Un release `dev` no entra al
 * catálogo del servidor, así que sus eventos viajan sin frames.
 */
declare const __APP_RELEASE__: string
