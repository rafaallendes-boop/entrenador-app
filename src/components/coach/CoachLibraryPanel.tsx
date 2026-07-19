import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import type { CoachSessionDraft } from '../../services/athlete/coachSessionSerializer'
import {
  createSessionTemplate,
  listSessionTemplates,
  SessionTemplateGoneError,
  softDeleteSessionTemplate,
  updateSessionTemplate,
} from '../../services/athlete/sessionTemplates'
import { templateToDraft } from '../../services/athlete/sessionTemplateSerializer'
import {
  isSupportedSessionTemplate,
  type SessionTemplateExercise,
  type StoredSessionTemplate,
  type SupportedSessionTemplate,
} from '../../types/sessionTemplate'
import { todayISO } from '../../utils/date'
import ConfirmDialog from '../ui/ConfirmDialog'
import SessionForm from '../session/SessionForm'

type EditorState =
  | { mode: 'create' }
  | {
      mode: 'edit'
      opened: SupportedSessionTemplate
      draft: CoachSessionDraft
      originalsById: Map<string, SessionTemplateExercise>
    }

/**
 * Support is a pure function of the row, and deciding it walks the entire
 * payload (drills, blocks, protocol steps, exercises). Classifying once per load
 * keeps that work off every re-render of the panel.
 */
interface ListedTemplate {
  template: StoredSessionTemplate
  supported: SupportedSessionTemplate | null
}

export default function CoachLibraryPanel() {
  const lastSuccessfulSyncAt = useAuthStore((state) => state.syncDetails.lastSuccessfulSyncAt)
  const lastErrorAt = useAuthStore((state) => state.syncDetails.lastErrorAt)
  const [templates, setTemplates] = useState<ListedTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [editorSubmitting, setEditorSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StoredSessionTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deletingRef = useRef(false)
  const editorSubmittingRef = useRef(false)

  const load = useCallback(async (options?: { preserveError?: boolean }) => {
    if (!options?.preserveError) setError(null)
    try {
      const rows = await listSessionTemplates()
      // Defensa adicional al contrato del servicio: una respuesta desactualizada
      // nunca debe volver visible un tombstone en la Biblioteca.
      setTemplates(rows
        .filter((row) => row.deletedAt == null)
        .map((row) => ({
          template: row,
          supported: isSupportedSessionTemplate(row) ? row : null,
        })))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la Biblioteca.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [lastSuccessfulSyncAt, load])

  const openEdit = (template: SupportedSessionTemplate) => {
    const prepared = templateToDraft(template.payload, todayISO())
    setEditor({ mode: 'edit', opened: template, ...prepared })
  }

  const submitEditor = async (
    draft: CoachSessionDraft,
    meta?: { templateName: string },
  ) => {
    if (editorSubmittingRef.current) return
    editorSubmittingRef.current = true
    setEditorSubmitting(true)
    setError(null)
    try {
      if (!editor || editor.mode === 'create') {
        await createSessionTemplate(meta?.templateName ?? '', draft)
      } else {
        await updateSessionTemplate(
          editor.opened.id,
          editor.opened,
          draft,
          editor.originalsById,
          meta?.templateName ?? '',
        )
      }
      setEditor(null)
      await load()
    } catch (submitError) {
      if (submitError instanceof SessionTemplateGoneError) {
        setEditor(null)
        setError(submitError.message)
        await load({ preserveError: true })
        return
      }
      throw submitError
    } finally {
      editorSubmittingRef.current = false
      setEditorSubmitting(false)
    }
  }

  const performDelete = async () => {
    if (!deleteTarget || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setError(null)
    try {
      await softDeleteSessionTemplate(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar la plantilla.')
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const showStaleNotice = lastErrorAt != null
    && (lastSuccessfulSyncAt == null || lastErrorAt > lastSuccessfulSyncAt)

  return (
    <section aria-label="Biblioteca de plantillas">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Biblioteca</h2>
          <p className="text-xs text-ink-muted">Sesiones reutilizables para todos tus atletas.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditor({ mode: 'create' })}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          Nueva plantilla
        </button>
      </div>

      {showStaleNotice && (
        <p className="mb-3 text-xs text-amber-200/80">
          No se pudo actualizar desde el servidor; estás viendo los datos guardados en este dispositivo.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status" className="text-sm text-ink-muted">Cargando plantillas…</p>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/15 px-5 py-8 text-center">
          <p className="text-sm text-ink-muted">
            Todavía no tienes plantillas. Crea la primera o guarda una sesión desde Planificación.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(({ template, supported }) => {
            return (
              <article key={template.id} className="rounded-2xl border border-ink/10 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{template.name}</h3>
                    <p className="text-xs text-ink-muted">
                      {supported
                        ? `${supported.payload.type} · ${supported.payload.durationMin} min`
                        : 'Formato no compatible'}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={supported == null}
                      onClick={() => { if (supported) openEdit(supported) }}
                      className="text-xs font-semibold text-brand underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(template)}
                      className="text-xs font-semibold text-red-400 underline"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {editor && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center md:p-6">
          <button
            type="button"
            aria-label="Cerrar editor de plantilla"
            disabled={editorSubmitting}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!editorSubmittingRef.current) setEditor(null) }}
          />
          <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border-t border-surface-border bg-surface-card md:max-w-3xl md:rounded-2xl md:border">
            <SessionForm
              mode="template"
              initialName={editor.mode === 'edit' ? editor.opened.name : undefined}
              initialValues={editor.mode === 'edit' ? editor.draft : undefined}
              defaultSport={editor.mode === 'edit' ? editor.opened.payload.type : 'squash'}
              heading={editor.mode === 'edit' ? 'Editar plantilla' : 'Nueva plantilla'}
              submitLabel={editor.mode === 'edit' ? 'Guardar cambios' : 'Crear plantilla'}
              onSubmit={submitEditor}
              onCancel={() => { if (!editorSubmittingRef.current) setEditor(null) }}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Eliminar plantilla"
        message="Las sesiones ya asignadas a tus atletas no se modifican."
        confirmLabel="Eliminar"
        destructive
        isLoading={deleting}
        onConfirm={() => { void performDelete() }}
        onCancel={() => { if (!deletingRef.current) setDeleteTarget(null) }}
      />
    </section>
  )
}
