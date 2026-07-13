import metadata from './publicRouteMetadata.json'

export interface PublicRouteMetadata {
  path: string
  title: string
  description: string
}

export const SITE_NAME: string = metadata.siteName
export const OG_IMAGE_PATH: string = metadata.ogImagePath
export const PUBLIC_ROUTE_METADATA: readonly PublicRouteMetadata[] = metadata.routes

/**
 * Metadata for `/`, which doubles as the reset target for {@link usePageMetadata}:
 * routes that never register their own metadata (dashboard, week, chat…) must not
 * inherit whatever the previously mounted public page left in `<head>`.
 */
export const DEFAULT_ROUTE_METADATA: PublicRouteMetadata = getPublicRouteMetadata('/')

export function getPublicRouteMetadata(path: string): PublicRouteMetadata {
  const found = PUBLIC_ROUTE_METADATA.find((route) => route.path === path)
  if (!found) {
    throw new Error(
      `No public metadata registered for "${path}". Add it to src/constants/publicRouteMetadata.json — ` +
        'the prerendered HTML in scripts/generate-public-route-html.mjs reads the same file.',
    )
  }
  return found
}
