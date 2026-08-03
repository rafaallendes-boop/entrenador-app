import { useState } from 'react'

import { acceptConsent } from '../../services/legal/consentService'
import { getDocument, type ConsentDocumentId } from '../../services/legal/consentDocuments'
import { useAuthStore } from '../../store/useAuthStore'
import ConsentAccountActions from './ConsentAccountActions'

const LABELS: Record<ConsentDocumentId, string> = {
  terms: 'Términos y Condiciones',
  privacy: 'Política de Privacidad',
  health: 'Descargo de salud',
  whoop_biometric: 'Descargo de datos biométricos',
}

interface ConsentScreenProps {
  documents: ConsentDocumentId[]
  onAccepted: () => void
  isUpdate?: boolean
  variant?: 'page' | 'inline'
}

export default function ConsentScreen({
  documents,
  onAccepted,
  isUpdate = false,
  variant = 'page',
}: ConsentScreenProps) {
  const user = useAuthStore((state) => state.user)
  const [checked, setChecked] = useState<Set<ConsentDocumentId>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const allChecked = documents.every((document) => checked.has(document))

  const toggle = (document: ConsentDocumentId) => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(document)) next.delete(document)
      else next.add(document)
      return next
    })
  }

  const submit = async () => {
    if (!user || !allChecked || busy) return
    setBusy(true)
    setError(undefined)

    let succeeded = 0
    for (const document of documents) {
      const result = await acceptConsent(user.id, document)
      if (result.ok) succeeded += 1
    }

    setBusy(false)
    if (succeeded !== documents.length) {
      setError('No pudimos registrar todo. Revisá tu conexión y probá de nuevo.')
    }
    // Un éxito parcial se deriva desde las filas confirmadas; el padre vuelve
    // a calcular y muestra únicamente lo que todavía falta.
    if (succeeded > 0) onAccepted()
  }

  const content = (
    <div className={variant === 'inline'
      ? 'rounded-xl border border-surface-border bg-surface-raised p-4'
      : 'w-full max-w-lg rounded-card border border-surface-border bg-surface-card p-8 shadow-card'}>
      <h1 className="text-lg font-semibold text-ink">
        {isUpdate ? 'Actualizamos nuestros documentos' : 'Antes de empezar'}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {isUpdate
          ? 'Cambió el texto de lo que sigue. Necesitamos que lo revises de nuevo.'
          : 'Necesitamos tu aceptación para poder darte el servicio.'}
      </p>

      <ul className="mt-6 space-y-3">
        {documents.map((document) => {
          const definition = getDocument(document)
          return (
            <li key={document}>
              <label className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface-card px-3 py-3">
                <input
                  type="checkbox"
                  checked={checked.has(document)}
                  disabled={busy}
                  onChange={() => toggle(document)}
                  className="mt-0.5 h-4 w-4 rounded border-surface-border bg-surface"
                />
                <span className="text-xs leading-relaxed text-ink-muted">
                  Acepto{' '}
                  <a
                    href={definition.route}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {LABELS[document]}
                  </a>{' '}
                  <span className="text-ink-subtle">(versión {definition.currentVersion})</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

      <button
        type="button"
        disabled={!allChecked || busy}
        onClick={() => void submit()}
        className="mt-6 w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Registrando…' : 'Acepto y continuar'}
      </button>

      {variant === 'page' && <ConsentAccountActions />}
    </div>
  )

  if (variant === 'inline') return content
  return <div className="flex min-h-screen items-center justify-center bg-surface px-6 py-10">{content}</div>
}
