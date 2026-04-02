import { useRef, useState } from 'react'
import { Upload, AlertTriangle, CheckCircle2, Trash2, Plus, Sparkles, ScanText } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { currentWeekStartISO } from '../utils/date'
import { importFromPDF, type PDFImportResult } from '../services/pdfImport'
import { SESSION_TYPE_CONFIG } from '../constants/sessionTypes'
import PageHeader from '../components/layout/PageHeader'
import { ROUTES } from '../constants/routes'
import type { ParsedSessionDraft, SessionType, TimeBlock } from '../types'

function DraftRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: ParsedSessionDraft
  onChange: (updated: ParsedSessionDraft) => void
  onRemove: () => void
}) {
  const confidenceColor =
    draft.confidence === 'high' ? 'text-emerald-400' :
    draft.confidence === 'medium' ? 'text-amber-400' :
    'text-red-400'

  return (
    <div className="bg-surface-raised rounded-xl border border-surface-border p-3 space-y-2 md:p-4">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${confidenceColor}`}>
          {draft.confidence === 'high' ? 'Alta' : draft.confidence === 'medium' ? 'Media' : 'Baja'} confianza
        </span>
        <span className="flex-1" />
        <button onClick={onRemove} className="text-ink-faint hover:text-red-400 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.85fr)_88px]">
        <select
          value={draft.type ?? ''}
          onChange={(event) => onChange({ ...draft, type: event.target.value as SessionType })}
          className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand/50"
        >
          <option value="">-- Tipo --</option>
          {Object.entries(SESSION_TYPE_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={draft.date ?? ''}
          onChange={(event) => onChange({ ...draft, date: event.target.value })}
          className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand/50"
        />
        <select
          value={draft.timeBlock ?? 'AM'}
          onChange={(event) => onChange({ ...draft, timeBlock: event.target.value as TimeBlock })}
          className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand/50"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      <input
        type="text"
        value={draft.title ?? ''}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        placeholder="Titulo de la sesion"
        className="w-full bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-brand/50"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[10px] text-ink-faint uppercase tracking-wider block mb-1">Duracion (min)</label>
          <input
            type="number"
            min={5}
            max={300}
            value={draft.durationMin ?? ''}
            onChange={(event) => onChange({ ...draft, durationMin: event.target.value ? Number(event.target.value) : undefined })}
            placeholder="-"
            className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-ink-faint uppercase tracking-wider block mb-1">RPE</label>
          <input
            type="number"
            min={1}
            max={10}
            value={draft.rpe ?? ''}
            onChange={(event) => onChange({ ...draft, rpe: event.target.value ? Number(event.target.value) : undefined })}
            placeholder="-"
            className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand/50"
          />
        </div>
      </div>

      {draft.rawText && (
        <details className="text-[10px] text-ink-faint">
          <summary className="cursor-pointer">Ver texto original</summary>
          <p className="mt-1 bg-surface rounded p-1.5 whitespace-pre-wrap leading-relaxed break-words">{draft.rawText.slice(0, 200)}</p>
        </details>
      )}
    </div>
  )
}

export default function ImportPDF() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { addSession, loadWeek } = useTrainingStore()
  const { currentWeekStart } = useUIStore()

  const [status, setStatus] = useState<'idle' | 'loading' | 'preview' | 'importing' | 'done'>('idle')
  const [result, setResult] = useState<PDFImportResult | null>(null)
  const [drafts, setDrafts] = useState<ParsedSessionDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)

  const handleFile = async (file: File) => {
    setStatus('loading')
    setError(null)
    try {
      const weekStart = currentWeekStart || currentWeekStartISO()
      const nextResult = await importFromPDF(file, weekStart)
      setResult(nextResult)
      setDrafts(nextResult.drafts)
      setStatus('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setStatus('idle')
    }
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) handleFile(file)
  }

  const addBlankDraft = () => {
    const weekStart = currentWeekStart || currentWeekStartISO()
    setDrafts((current) => [...current, {
      date: weekStart,
      type: 'squash',
      timeBlock: 'AM',
      title: '',
      confidence: 'high',
    }])
  }

  const updateDraft = (index: number, updated: ParsedSessionDraft) => {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? updated : draft))
  }

  const removeDraft = (index: number) => {
    setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))
  }

  const handleImport = async () => {
    const valid = drafts.filter((draft) => draft.date && draft.type && draft.title?.trim())
    if (valid.length === 0) return

    setStatus('importing')
    let count = 0

    for (const draft of valid) {
      try {
        await addSession({
          date: draft.date!,
          timeBlock: draft.timeBlock ?? 'AM',
          type: draft.type!,
          status: 'planned',
          title: draft.title!.trim(),
          durationMin: draft.durationMin ?? 60,
          rpe: draft.rpe,
          objective: draft.objective,
          notes: draft.notes,
          subtype: draft.subtype,
          runningDetails: draft.runningDetails,
        })
        count++
      } catch {
        // Ignore malformed rows and keep importing the rest.
      }
    }

    await loadWeek(currentWeekStart || currentWeekStartISO())
    setImportedCount(count)
    setStatus('done')
  }

  const validCount = drafts.filter((draft) => draft.date && draft.type && draft.title?.trim()).length

  return (
    <div>
      <PageHeader title="Importar PDF" backTo={ROUTES.WEEK} />

      <div className="px-4 pb-8 space-y-4 md:px-6">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          {(status === 'idle' || status === 'loading') && (
            <div
              onDrop={handleDrop}
              onDragOver={(event) => event.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-surface-border rounded-2xl p-8 md:p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-brand/40 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInput}
              />
              {status === 'loading' ? (
                <>
                  <div className="w-10 h-10 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  <p className="text-sm text-ink-muted">Leyendo PDF...</p>
                </>
              ) : (
                <>
                  <Upload size={28} className="text-ink-faint" />
                  <p className="text-sm font-medium text-ink">Sube tu planificación en PDF</p>
                  <p className="text-xs text-ink-muted text-center">
                    Arrastra o toca para seleccionar · Max 10 MB
                  </p>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl p-3">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {result?.warnings.map((warning, index) => (
            <div key={index} className="flex items-start gap-2 bg-surface-raised border border-surface-border rounded-xl p-3">
              <AlertTriangle size={13} className="text-ink-faint flex-shrink-0 mt-0.5" />
              <p className="text-xs text-ink-muted">{warning}</p>
            </div>
          ))}

          {status === 'preview' && (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {drafts.length > 0 ? `${drafts.length} sesiones detectadas` : 'Ninguna detectada'}
                  </p>
                  {result && (
                    <div className="flex items-center gap-1 mt-0.5">
                      {result.usedAI ? (
                        <>
                          <Sparkles size={11} className="text-brand-light" />
                          <span className="text-[10px] text-brand-light font-medium">Analizado con IA</span>
                        </>
                      ) : (
                        <>
                          <ScanText size={11} className="text-ink-faint" />
                          <span className="text-[10px] text-ink-faint">Detección automática</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={addBlankDraft}
                  className="flex items-center gap-1 text-xs text-brand-light font-medium whitespace-nowrap"
                >
                  <Plus size={12} /> Añadir manual
                </button>
              </div>

              {drafts.length === 0 && (
                <div className="py-6 text-center">
                  <p className="text-ink-faint text-sm">No se detectó ninguna sesión.</p>
                  <p className="text-ink-faint text-xs mt-1">Añade sesiones manualmente con el botón de arriba.</p>
                </div>
              )}

              <div className="space-y-3">
                {drafts.map((draft, index) => (
                  <DraftRow
                    key={index}
                    draft={draft}
                    onChange={(updated) => updateDraft(index, updated)}
                    onRemove={() => removeDraft(index)}
                  />
                ))}
              </div>

              {drafts.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={validCount === 0}
                  className="w-full bg-brand text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-40 active:scale-[0.98] transition-all"
                >
                  Importar {validCount} sesión{validCount !== 1 ? 'es' : ''} al calendario
                </button>
              )}
            </>
          )}

          {status === 'importing' && (
            <div className="py-10 flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-brand border-t-transparent animate-spin" />
              <p className="text-sm text-ink-muted">Importando sesiones...</p>
            </div>
          )}

          {status === 'done' && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={40} className="text-emerald-400" />
              <p className="text-base font-semibold text-ink">{importedCount} sesiones importadas</p>
              <p className="text-sm text-ink-muted">Puedes verlas en la vista Semana</p>
              <button
                onClick={() => {
                  setStatus('idle')
                  setResult(null)
                  setDrafts([])
                }}
                className="mt-2 text-sm text-brand-light font-medium"
              >
                Importar otro PDF
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
