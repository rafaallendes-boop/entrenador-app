import { loadEnv } from 'vite'

const env = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const value = env.VITE_API_BASE_URL?.trim()

if (!value) {
  console.error('Falta VITE_API_BASE_URL. Define el origen HTTPS del backend antes de compilar iOS.')
  process.exit(1)
}

let url
try {
  url = new URL(value)
} catch {
  console.error('VITE_API_BASE_URL debe ser una URL absoluta, por ejemplo https://mi-app.netlify.app')
  process.exit(1)
}

if (url.protocol !== 'https:') {
  console.error('VITE_API_BASE_URL debe usar HTTPS para una compilación iOS.')
  process.exit(1)
}

console.log(`Backend iOS verificado: ${url.origin}`)
