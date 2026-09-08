import { useState } from 'react'
import type { AthleteProfile, RunningDetails } from '../../types'
import { RUNNING_SESSION_LIBRARY } from '../../services/training/runningSessionLibrary'
import { materializeRunningTemplate } from '../../services/training/runningTemplateMaterializer'
import { runningProfileWithRestrictions } from '../../services/training/runningPolicy'

export default function RunningTemplatePicker({ durationMin, athleteProfile, value, onChange }: {
  durationMin: number; athleteProfile?: AthleteProfile | null; value?: RunningDetails
  onChange: (value?: RunningDetails) => void
}) {
  const [query, setQuery] = useState('')
  const profile = runningProfileWithRestrictions(athleteProfile)
  const preview = value?.templateRef ? materializeRunningTemplate({ template: value.templateRef.id, durationMin, profile }) : undefined
  const structure = value?.templateRef ? preview?.ok ? preview.structure : undefined : value?.intervalStructure
  return <div className="space-y-2 rounded-xl border border-surface-border p-3">
    <label className="block text-sm">Buscar plantilla de running
      <input aria-label="Buscar plantilla de running" value={query} onChange={e => setQuery(e.target.value)} className="mt-1 w-full rounded border bg-surface-raised px-2 py-1" />
    </label>
    <select aria-label="Plantilla de running" className="w-full rounded border bg-surface-raised px-2 py-2" value={value?.templateRef?.id ?? ''} onChange={e => {
      const definition = RUNNING_SESSION_LIBRARY.find(d => d.id === e.target.value)
      if (!definition) { onChange(undefined); return }
      const dose = materializeRunningTemplate({ template: definition, durationMin, profile })
      if (dose.ok) onChange({ runningType: definition.runningType, templateRef: dose.templateRef, intervalStructure: dose.structure, selectionReason: `Elección manual: ${definition.description}` })
    }}>
      <option value="">Sesión personalizada</option>
      {RUNNING_SESSION_LIBRARY.filter(d => `${d.name} ${d.family} ${d.description}`.toLowerCase().includes(query.toLowerCase()) || d.id === value?.templateRef?.id).map(d => {
        const dose = materializeRunningTemplate({ template: d, durationMin, profile })
        const restricted = profile.impactRestriction === 'no_running' || profile.impactRestriction === 'no_fast_running' && d.prescription.effort !== 'easy'
        return <option key={d.id} value={d.id} disabled={!dose.ok || restricted}>{d.name} · {d.intensity}{restricted ? ' · restricción activa' : !dose.ok ? ` · ${dose.message}` : ''}</option>
      })}
    </select>
    {value?.selectionReason && <p className="text-xs text-ink-muted">{value.selectionReason}</p>}
    {structure && <ol className="space-y-1 text-xs">{structure.blocks.map((b, i) => <li key={i}>{b.label}: {Math.round((b.durationMin ?? 0) * 60)} s{b.distanceKm ? ` · ${b.distanceKm * 1000} m (tiempo estimado)` : ''}{b.targetPace ? ` · ${b.targetPace}` : ''}</li>)}</ol>}
  </div>
}
