import { useRef, useState } from 'react'
import { Upload, AlertTriangle, CheckCircle2, Trash2, Plus } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { currentWeekStartISO } from '../utils/date'
import { importFromPDF, type PDFImportResult } from '../services/pdfImport'
import { SESSION_TYPE_CONFIG } from '../constants/sessionTypes'
import PageHeader from '../components/layout/PageHeader'
import { ROUTES } from '../constants/routes'
import type { ParsedSessionDraft, SessionType, TimeBlock } from '../types'

// ─── Draft row editor ─────────────────────────────────────────────────────────

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
    <div className="bg-surface-raised rounded-xl border border-surface-border p-3 space-y-2">
      {/* Row header */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${confidenceColor}`}>
          {draft.confidence === 'high' ? '✓ Alta' : draft.confidence === 'medium' ? '~ Media' : '? Baja'} confianza
        </span>
        <span className="flex-1" />
        <button onClick={onRemove} className="text-ink-faint hover:text-red-400 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Type + Date + TimeBlock */}
      <div className="flex gap-2 flex-wrap">
        <select
          value={draft.type ?? ''}
          onChange={e => onChange({ ...draft, type: e.target.value as SessionType })}
          className="flex-1 min-w-[100px] bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand/50"
        >
          <option value="">-- Tipo --</option>
          {Object.entries(SESSION_TYPE_CONFIG).map(([k, c]) => (
            <option key={k} value={k}>{c.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={draft.date ?? ''}
          onChange={e => onChange({ ...draft, date: e.target.value })}
          className="flex-1 min-w-[120px] bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand/50"
        />
        <select
          value={draft.timeBlock ?? 'AM'}
          onChange={e => onChange({ ...draft, timeBlock: e.target.value as TimeBlock })}
          className="w-20 bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand/50"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      {/* Title */}
      <input
        type="text"
        value={draft.title ?? ''}
        onChange={e => onChange({ ...draft, title: e.target.value })}
        placeholder="Título de la sesión"
        className="w-full bg-surface border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-brand/50"
      />

      {/* Duration + RPE */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-ink-faint uppercase tracking-wider block mb-1">Duración (min)</label>
          <input
            type="number"
            min={5} max={300}
            value={draft.durationMin ?? ''}
            onChange={e => onChange({ ...draft, durationMin: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="—"
            className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand/50"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-ink-faint uppercase tracking-wider block mb-1">RPE</label>
          <input
            type="number"
            min={1} max={10}
            value={draft.rpe ?? ''}
            onChange={e => onChange({ ...draft, rpe: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="—"
            className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand/50"
          />
        </div>
      </div>

      {/* Raw text preview */}
      {draft.rawText && (
        <details className="text-[10px] text-ink-faint">
          <summary className="cursor-pointer">Ver texto original</summary>
          <p className="mt-1 bg-surface rounded p-1.5 whitespace-pre-wrap leading-relaxed">{draft.rawText.slice(0, 200)}</p>
        </details>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

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
      const res = await importFromPDF(file, weekStart)
      setResult(res)
      setDrafts(res.drafts)
      setStatus('preview')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setStatus('idle')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const addBlankDraft = () => {
    const weekStart = currentWeekStart || currentWeekStartISO()
    setDrafts(prev => [...prev, {
      date: weekStart,
      type: 'squash',
      timeBlock: 'AM',
      title: '',
      confidence: 'high',
    }])
  }

  const updateDraft = (index: number, updated: ParsedSessionDraft) => {
    setDrafts(prev => prev.map((d, i) => i === index ? updated : d))
  }

  const removeDraft = (index: number) => {
    setDrafts(prev => prev.filter((_, i) => i !== index))
  }

  const handleImport = async () => {
    const valid = drafts.filter(d => d.date && d.type && d.title?.trim())
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
        // Skip failed drafts
      }
    }

    await loadWeek(currentWeekStart || currentWeekStartISO())
    setImportedCount(count)
    setStatus('done')
  }

  const validCount = drafts.filter(d => d.date && d.type && d.title?.trim()).length

  return (
    <div>
      <PageHeader title="Importar PDF" backTo={ROUTES.WEEK} />

      <div className="px-4 pb-8 space-y-4">
        {/* Upload area */}
        {(status === 'idle' || status === 'loading') && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-surface-border rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-brand/40 transition-colors"
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
                  Arrastra o toca para seleccionar · Máx 10 MB
                </p>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl p-3">
            <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* Warnings from parsing */}
        {result?.warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2 bg-surface-raised border border-surface-border rounded-xl p-3">
            <AlertTriangle size={13} className="text-ink-faint flex-shrink-0 mt-0.5" />
            <p className="text-xs text-ink-muted">{w}</p>
          </div>
        ))}

        {/* Preview + editor */}
        {status === 'preview' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">
                {drafts.length > 0 ? `${drafts.length} sesiones detectadas` : 'Ninguna detectada'}
              </p>
              <button
                onClick={addBlankDraft}
                className="flex items-center gap-1 text-xs text-brand-light font-medium"
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
              {drafts.map((draft, i) => (
                <DraftRow
                  key={i}
                  draft={draft}
                  onChange={updated => updateDraft(i, updated)}
                  onRemove={() => removeDraft(i)}
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

        {/* Importing state */}
        {status === 'importing' && (
          <div className="py-10 flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            <p className="text-sm text-ink-muted">Importando sesiones...</p>
          </div>
        )}

        {/* Done */}
        {status === 'done' && (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <p className="text-base font-semibold text-ink">{importedCount} sesiones importadas</p>
            <p className="text-sm text-ink-muted">Puedes verlas en la vista Semana</p>
            <button
              onClick={() => { setStatus('idle'); setResult(null); setDrafts([]) }}
              className="mt-2 text-sm text-brand-light font-medium"
            >
              Importar otro PDF
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
