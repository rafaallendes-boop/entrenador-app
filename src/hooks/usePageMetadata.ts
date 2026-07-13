import { useEffect } from 'react'
import { DEFAULT_ROUTE_METADATA, OG_IMAGE_PATH, SITE_NAME } from '../constants/publicRouteMetadata'

interface PageMetadata {
  title: string
  description: string
}

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function upsertCanonical(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }
  element.setAttribute('href', url)
}

function applyMetadata({ title, description }: PageMetadata, url: string) {
  const image = `${window.location.origin}${OG_IMAGE_PATH}`

  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:type', 'website')
  upsertMeta('property', 'og:site_name', SITE_NAME)
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:image', image)
  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', image)
  upsertCanonical(url)
}

/**
 * Owns `<head>` for the public routes.
 *
 * Cleanup resets to the app default instead of restoring what was in `<head>` at mount.
 * Restoring the mount-time value looks right but is wrong on a direct hit of a prerendered
 * route: there the captured "previous" title *is* that route's own title, so navigating on
 * to a page that does not use this hook (`/`, dashboard, week…) would strand the old page's
 * title and canonical in `<head>`.
 */
export function usePageMetadata({ title, description }: PageMetadata) {
  useEffect(() => {
    applyMetadata({ title, description }, `${window.location.origin}${window.location.pathname}`)

    return () => {
      applyMetadata(DEFAULT_ROUTE_METADATA, `${window.location.origin}/`)
    }
  }, [description, title])
}
