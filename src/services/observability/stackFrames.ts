/**
 * Normalización de frames para el reporter de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §5.
 *
 * Es la pieza que sostiene la promesa de «sin texto libre»: nada de lo que sale
 * de acá proviene del mensaje del error. Se reconstruye una gramática cerrada
 * —`asset.js:línea:columna`— y se descarta todo lo demás: encabezados, nombres
 * de función, líneas desconocidas, URLs completas, query y hash.
 *
 * Cortar la línea cero **no** alcanza: un mensaje multilínea puede imitar un
 * frame perfectamente formado. Por eso la pertenencia al manifiesto del release
 * es la barrera real, no una gramática de basename.
 *
 * Funciones puras: no leen `window`, red, entorno ni estado global. El
 * manifiesto y los orígenes confiables entran siempre como parámetros.
 */

export const MAX_STACK_FRAMES = 10
export const MAX_STACK_FRAMES_CHARS = 2000

/** Una línea canónica ya normalizada. Es también el contrato del servidor. */
const CANONICAL_FRAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js:([1-9]\d*):([1-9]\d*)$/

/** Ubicación al final de un frame: `…:línea:columna`. */
const TRAILING_POSITION = /^(.*):(\d+):(\d+)$/

/**
 * `URL.origin` no sirve acá: para `blob:https://app.rallyiq.cl/…` devuelve el
 * origen del sitio, así que un frame de blob pasaría por propio. Y para
 * `capacitor://localhost` devuelve `null`, así que el build nativo quedaría
 * fuera. Construir `protocol//host` resuelve los dos casos.
 */
function resolveOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`
}

/** Extrae la ubicación cruda de una línea de stack, o null si no es un frame. */
function extractLocation(rawLine: string): string | null {
  const line = rawLine.trim()
  if (line === '') return null

  // Frames de `eval` y de código anónimo no ubican nada del build.
  if (line.includes('eval at ') || line.includes('<anonymous>')) return null

  // Chromium con nombre de función: `at fn (LOCATION)`.
  const parenthesized = /\(([^()]*)\)\s*$/.exec(line)
  if (parenthesized) return parenthesized[1] ?? null

  // Safari y Firefox: `fn@LOCATION` o `@LOCATION`.
  const atSign = line.indexOf('@')
  if (atSign !== -1) return line.slice(atSign + 1)

  // Chromium sin nombre de función: `at LOCATION`.
  if (line.startsWith('at ')) return line.slice(3).trim()

  return null
}

/**
 * Convierte una ubicación cruda en línea canónica, o null si no supera alguna
 * de las validaciones. Nunca devuelve nada derivado del mensaje.
 */
function canonicalizeLocation(
  location: string,
  knownAssets: ReadonlySet<string>,
  allowedOrigins: ReadonlySet<string>,
): string | null {
  // La posición se separa **antes** de tocar query/hash: el hash puede quedar
  // entre el asset y la posición (`…js?v=4#x:14:22`).
  const positioned = TRAILING_POSITION.exec(location.trim())
  if (!positioned) return null

  const [, rawUrl, rawLine, rawColumn] = positioned
  if (rawUrl == null || rawLine == null || rawColumn == null) return null

  const lineNumber = Number(rawLine)
  const columnNumber = Number(rawColumn)
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null
  if (!Number.isInteger(columnNumber) || columnNumber < 1) return null

  const withoutHash = rawUrl.split('#', 1)[0] ?? ''
  const withoutQuery = withoutHash.split('?', 1)[0] ?? ''

  let url: URL
  try {
    url = new URL(withoutQuery)
  } catch {
    // Un path local no es una URL absoluta y no debe persistirse.
    return null
  }

  if (!allowedOrigins.has(resolveOrigin(url))) return null

  const asset = url.pathname.split('/').pop() ?? ''
  if (!knownAssets.has(asset)) return null

  const canonical = `${asset}:${lineNumber}:${columnNumber}`
  return CANONICAL_FRAME.test(canonical) ? canonical : null
}

/** Aplica los dos topes: cantidad de frames y largo total. */
function capFrames(frames: readonly string[]): string | null {
  const kept: string[] = []
  let length = 0

  for (const frame of frames.slice(0, MAX_STACK_FRAMES)) {
    const addition = kept.length === 0 ? frame.length : frame.length + 1
    if (length + addition > MAX_STACK_FRAMES_CHARS) break
    kept.push(frame)
    length += addition
  }

  return kept.length > 0 ? kept.join('\n') : null
}

/**
 * Camino del cliente: de `Error.stack` crudo a líneas canónicas.
 *
 * `knownAssets` corresponde al release **del evento**, no al del servidor.
 * `null` significa manifiesto no disponible y devuelve `null`; un set vacío no
 * admite ningún asset. `allowedOrigins` se inyecta desde la configuración
 * confiable de web/nativo, nunca desde el payload.
 */
export function normalizeStackFrames(
  stack: unknown,
  knownAssets: ReadonlySet<string> | null,
  allowedOrigins: ReadonlySet<string>,
): string | null {
  if (typeof stack !== 'string') return null
  if (knownAssets === null) return null

  const frames: string[] = []
  for (const rawLine of stack.split('\n')) {
    const location = extractLocation(rawLine)
    if (location === null) continue

    const canonical = canonicalizeLocation(location, knownAssets, allowedOrigins)
    if (canonical === null) continue

    frames.push(canonical)
    if (frames.length >= MAX_STACK_FRAMES) break
  }

  return capFrames(frames)
}

/**
 * Camino del servidor: revalida líneas ya canónicas con la misma política de
 * assets. No confía en la validación del cliente ni en el manifiesto que el
 * cliente haya usado.
 */
export function revalidateCanonicalFrames(
  value: unknown,
  knownAssets: ReadonlySet<string> | null,
): string | null {
  if (typeof value !== 'string') return null
  if (knownAssets === null) return null

  const frames = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!CANONICAL_FRAME.test(line)) return false
      const asset = line.slice(0, line.indexOf(':'))
      return knownAssets.has(asset)
    })

  return capFrames(frames)
}
