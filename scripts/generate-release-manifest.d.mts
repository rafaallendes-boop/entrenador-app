/**
 * Tipos para el resolvedor de release compartido entre `vite.config.ts` y los
 * scripts de build. Es una sola autoridad a propósito: dos implementaciones
 * divergían en formas que no fallaban en build sino en producción.
 */
export declare function resolveReleaseId(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string
export declare function buildManifestFromAssetFiles(
  files: readonly string[],
  release: string,
): { formatVersion: number; release: string; assets: string[] }
export declare function mergeReleasesForCatalog(
  manifests: ReadonlyArray<{ formatVersion: number; release: string; assets: readonly string[] }>,
): Record<string, readonly string[]>
