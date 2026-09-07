/**
 * Interruptor server-only de la ingesta de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §11.
 *
 * Existe porque `VITE_CLIENT_ERROR_REPORTING_ENABLED` se resuelve en build:
 * apagarla exige rebuild y deploy, y **no apaga las pestañas ya abiertas**.
 * Esta variable sí corta la ingesta de esos clientes sin tocar el bundle.
 *
 * Fail-closed: ausente, vacía o ilegible ⇒ apagada.
 */
export function isClientErrorIngestionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env['CLIENT_ERROR_INGESTION_ENABLED']
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true'
}
