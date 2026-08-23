import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const DIST_DIR = new URL('dist/', ROOT)
const METADATA_FILE = new URL('src/constants/publicRouteMetadata.json', ROOT)

// Netlify sets URL to the site's primary address on every deploy context.
const DEFAULT_SITE_ORIGIN = 'https://app.rallyiq.cl'

const METADATA_START = '<!-- route-metadata:start -->'
const METADATA_END = '<!-- route-metadata:end -->'
const TITLE_PATTERN = /<title>[^<]*<\/title>/

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function metadataBlock(route, siteOrigin, siteName, ogImagePath) {
  const title = escapeHtml(route.title)
  const description = escapeHtml(route.description)
  const url = escapeHtml(`${siteOrigin}${route.path}`)
  const image = escapeHtml(`${siteOrigin}${ogImagePath}`)

  return [
    METADATA_START,
    `  <meta name="description" content="${description}" />`,
    // Todo `route` que llega acá viene de publicRouteMetadata.json — esa lista
    // ES el whitelist de indexación. index.html trae "noindex, nofollow" como
    // default seguro para el fallback SPA; esta es la única de las 8 copias
    // generadas que lo pisa a "index, follow".
    '  <meta name="robots" content="index, follow" />',
    `  <meta property="og:title" content="${title}" />`,
    `  <meta property="og:description" content="${description}" />`,
    '  <meta property="og:type" content="website" />',
    `  <meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `  <meta property="og:url" content="${url}" />`,
    `  <meta property="og:image" content="${image}" />`,
    '  <meta name="twitter:card" content="summary_large_image" />',
    `  <meta name="twitter:title" content="${title}" />`,
    `  <meta name="twitter:description" content="${description}" />`,
    `  <meta name="twitter:image" content="${image}" />`,
    `  <link rel="canonical" href="${url}" />`,
    `  ${METADATA_END}`,
  ].join('\n  ')
}

/**
 * Every substitution below is asserted. `String.replace` returns the input untouched
 * when it does not match, so without these checks any reformatting of index.html would
 * silently ship the default metadata on all routes with a green build — the exact bug
 * this script exists to prevent.
 */
export function routeHtml(template, route, siteOrigin, siteName, ogImagePath) {
  const start = template.indexOf(METADATA_START)
  const end = template.indexOf(METADATA_END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `index.html is missing the ${METADATA_START} / ${METADATA_END} markers around its <meta name="description">. ` +
        'The public-route metadata cannot be injected. Restore the markers in index.html.',
    )
  }

  const withMetadata =
    template.slice(0, start) +
    metadataBlock(route, siteOrigin, siteName, ogImagePath).trimStart() +
    template.slice(end + METADATA_END.length)

  if (!TITLE_PATTERN.test(withMetadata)) {
    throw new Error(
      'index.html is missing a plain <title>…</title> tag, so the per-route title cannot be injected. ' +
        'Restore it (no attributes) in index.html.',
    )
  }

  return withMetadata.replace(TITLE_PATTERN, `<title>${escapeHtml(route.title)}</title>`)
}

export async function loadMetadata() {
  return JSON.parse(await readFile(METADATA_FILE, 'utf8'))
}

async function generate() {
  const siteOrigin = (process.env.URL || DEFAULT_SITE_ORIGIN).replace(/\/$/, '')
  const { siteName, ogImagePath, routes } = await loadMetadata()
  const template = await readFile(new URL('index.html', DIST_DIR), 'utf8')

  // Snapshot the unmodified build output (noindex,nofollow default) as the SPA
  // fallback BEFORE any route rewrite touches dist/index.html. Netlify's catch-all
  // redirect serves this file for every private/unknown path, so it must never
  // pick up the "/" route's index,follow rewrite below — Google cannot honor a
  // <meta name="robots" content="noindex"> on a page robots.txt already blocked,
  // so this file also has to stay reachable by crawlers (see robots.txt).
  await writeFile(new URL('spa-fallback.html', DIST_DIR), template)

  await Promise.all(
    routes.map(async (route) => {
      const html = routeHtml(template, route, siteOrigin, siteName, ogImagePath)
      // "/" rewrites dist/index.html itself — the public homepage, distinct from
      // the spa-fallback.html snapshot just written above.
      const target =
        route.path === '/'
          ? new URL('index.html', DIST_DIR)
          : new URL(`.${route.path}/index.html`, DIST_DIR)

      await mkdir(new URL('./', target), { recursive: true })
      await writeFile(target, html)
    }),
  )

  console.log(`Generated metadata for ${routes.length} public routes (origin: ${siteOrigin})`)
}

// Importable from tests; only writes to dist when run as a build step.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generate()
}
