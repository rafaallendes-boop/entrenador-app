interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  isLoading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 max-w-sm rounded-2xl border border-surface-border bg-surface-card p-5">
        <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
        <p className="mb-4 text-xs leading-relaxed text-ink-muted">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
              destructive
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-brand/20 text-brand-light hover:bg-brand/30'
            }`}
          >
            {isLoading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
