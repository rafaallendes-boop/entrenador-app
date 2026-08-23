import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { PUBLIC_ROUTE_METADATA } from '../../constants/publicRouteMetadata'

const PUBLIC_PATHS = new Set(PUBLIC_ROUTE_METADATA.map((route) => route.path))

function upsertRobotsMeta(content: string) {
  let element = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('name', 'robots')
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

/**
 * Corrige en runtime el `<meta name="robots">` en cada navegación cliente.
 *
 * `dist/index.html` es el mismo archivo físico para "/" y para el fallback
 * SPA de toda ruta privada/desconocida (scripts/generate-public-route-html.mjs
 * reescribe ese archivo como parte de generar la ruta "/"), así que un
 * <meta> estático no puede distinguir un GET directo a "/settings" de uno a
 * "/". El HTML servido ya trae el valor correcto para el primer paint
 * (noindex por default, index solo en las 8 copias públicas generadas); esto
 * cubre las navegaciones posteriores dentro de la SPA, donde no hay otro
 * request de documento que reevalúe el HTML estático.
 *
 * Debe montarse dentro de <BrowserRouter> (usa useLocation) y una sola vez,
 * fuera de <Routes>, para correr en cada cambio de ruta sin importar qué
 * página esté montada.
 */
export default function RouteRobotsMeta() {
  const location = useLocation()

  useEffect(() => {
    const isPublicRoute = PUBLIC_PATHS.has(location.pathname)
    upsertRobotsMeta(isPublicRoute ? 'index, follow' : 'noindex, nofollow')
  }, [location.pathname])

  return null
}
