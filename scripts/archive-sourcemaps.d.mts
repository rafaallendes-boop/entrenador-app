/** Tipos para el gate de sourcemaps, compartido con `vite.config.ts`. */
export declare function isSourcemapArchiveEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean
export declare function selectSourcemapFiles(files: readonly string[]): string[]
export declare function archivePathFor(release: string, file: string): string
export declare function collectSourcemapsRecursively(
  root: string,
  readDir: (dir: string) => readonly string[],
  isDir: (path: string) => boolean,
): string[]
