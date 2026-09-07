import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './pwa/registerServiceWorker.ts'
import { initializeNativeApp } from './services/nativeApp.ts'
import { installClientErrorReporter } from './services/observability/installClientErrorReporter.ts'

// Antes de `createRoot`, a propósito: un `useEffect` corre después del primer
// commit y perdería los errores de evaluación de módulo y del primer render —
// incluido el boundary de la primera pintura, que es exactamente la población
// de `chunk_load` posterior a un deploy que esta telemetría existe para ver.
// La flag decide si el canal envía; los listeners se registran igual.
installClientErrorReporter()

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void initializeNativeApp().catch((error) => {
  console.error('[native] initialization failed', error)
})
