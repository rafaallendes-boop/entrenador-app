import { isNativePlatform } from './platform'

const NETLIFY_FUNCTION_PREFIX = '/.netlify/functions/'

export interface ResolveApiUrlOptions {
  native?: boolean
  apiBaseUrl?: string
}

export class ApiUrlConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiUrlConfigurationError'
  }
}

function normalizeApiBaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new ApiUrlConfigurationError('VITE_API_BASE_URL debe ser una URL HTTP(S) absoluta.')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiUrlConfigurationError('VITE_API_BASE_URL debe usar HTTP(S).')
  }

  return url.origin
}

/**
 * Resolves calls hosted by the web backend.
 *
 * Web keeps same-origin relative URLs so local Netlify/Vite proxying continues
 * to work. Capacitor serves the bundle from capacitor://localhost, therefore it
 * must call the deployed HTTPS backend explicitly.
 */
export function resolveApiUrl(path: string, options: ResolveApiUrlOptions = {}): string {
  if (!path.startsWith(NETLIFY_FUNCTION_PREFIX)) {
    throw new Error(`Ruta de API no permitida: ${path}`)
  }

  const native = options.native ?? isNativePlatform()
  if (!native) return path

  const baseUrl = normalizeApiBaseUrl(
    options.apiBaseUrl ?? (import.meta.env.VITE_API_BASE_URL as string | undefined),
  )
  if (!baseUrl) {
    throw new ApiUrlConfigurationError(
      'La app nativa no tiene backend configurado. Define VITE_API_BASE_URL antes de compilar iOS.',
    )
  }

  return new URL(path, `${baseUrl}/`).toString()
}
