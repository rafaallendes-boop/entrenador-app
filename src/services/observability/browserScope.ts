/**
 * Resolución de `scope_kind` para las fuentes de navegador.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §4.
 *
 * Función pura: quien captura toma la instantánea de `getActiveAthleteId()` y
 * `getSelfAthleteId()` **antes de cualquier `await`** y la pasa acá. Tomarla
 * después haría que una tarea asíncrona se atribuyera al atleta visible al
 * terminar, no al de la operación que falló.
 *
 * Los ids se usan sólo para resolver el scope y **nunca se adjuntan al evento**.
 *
 * `self` ante ids sin resolver significa «contexto de cuenta por defecto». No
 * demuestra que la operación haya afectado un atleta self, no modifica RLS y no
 * habilita lectura ni adopción de filas legacy: es una convención de telemetría.
 * Elegirlo evita perder los errores de arranque, que ocurren antes de que el
 * atleta activo esté hidratado.
 *
 * No reemplaza a `isSelfScopeActive` (`src/services/athlete/activeAthlete.ts`),
 * que además considera el rol y falla cerrado para coach/unknown.
 */

import type { ClientErrorScopeKind } from './clientErrorContract'

function resolved(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.length > 0
}

export function resolveBrowserScopeKind(
  activeAthleteId: string | null | undefined,
  selfAthleteId: string | null | undefined,
): ClientErrorScopeKind {
  if (!resolved(activeAthleteId) || !resolved(selfAthleteId)) return 'self'
  return activeAthleteId === selfAthleteId ? 'self' : 'managed'
}
