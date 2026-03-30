import { useEffect, useMemo, useState } from 'react'
import { Download, Smartphone } from 'lucide-react'
import Card from '../ui/Card'

interface DeferredPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export default function InstallAppCard() {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneMode())

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as DeferredPromptEvent)
    }

    const onInstalled = () => {
      setDeferredPrompt(null)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const isIos = useMemo(
    () => /iphone|ipad|ipod/i.test(window.navigator.userAgent),
    [],
  )

  if (isInstalled) return null

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice
    if (result.outcome === 'accepted') {
      setDeferredPrompt(null)
    }
  }

  return (
    <Card className="p-4 border-brand/25 bg-brand/10">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-brand/20 text-brand-light flex items-center justify-center flex-shrink-0">
          <Smartphone size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-brand-light uppercase tracking-wider">
            Instalar app
          </p>
          <p className="text-sm text-ink mt-1 leading-relaxed">
            Instálala en la pantalla principal para abrir tus entrenamientos como app nativa y seguir usándola incluso sin señal reciente.
          </p>
          {deferredPrompt ? (
            <button
              onClick={handleInstall}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-white bg-brand px-3 py-2 rounded-xl"
            >
              <Download size={15} />
              Instalar ahora
            </button>
          ) : isIos ? (
            <p className="text-xs text-ink-muted mt-3">
              En iPhone: abre en Safari, toca compartir y elige &quot;Agregar a pantalla de inicio&quot;.
            </p>
          ) : (
            <p className="text-xs text-ink-muted mt-3">
              Si no aparece el prompt, abre el menú del navegador y busca &quot;Instalar app&quot; o &quot;Agregar a pantalla principal&quot;.
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
