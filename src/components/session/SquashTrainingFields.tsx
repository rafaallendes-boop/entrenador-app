import type { SquashTrainingContext } from '../../types/squashTrainingContext'
import { getSquashDrillFamily, SQUASH_DRILL_LIBRARY } from '../../services/training/drillLibrary'

const families = [...new Set(SQUASH_DRILL_LIBRARY.map(getSquashDrillFamily))].sort()
export default function SquashTrainingFields({ value, onChange, results = true }: { value: SquashTrainingContext; onChange: (value: SquashTrainingContext) => void; results?: boolean }) {
  const availability = value.availability ?? {}
  // Vaciar "Intentos" borra el resultado entero: `Number('')` daba `0`, el
  // formulario rechazaba `attempts <= 0` y no quedaba forma de deshacerlo.
  const setResult = (key: 'attempts' | 'successes', raw: string) => {
    const parsed = raw === '' ? undefined : Number(raw)
    if (key === 'attempts' && parsed == null) return onChange({ ...value, technicalResult: undefined })
    const current = value.technicalResult ?? { attempts: 0, successes: 0 }
    onChange({ ...value, technicalResult: { ...current, [key]: parsed ?? 0 } })
  }
  return <fieldset className="space-y-3 rounded-xl border border-surface-border p-3">
    <legend className="text-sm">Objetivo y disponibilidad de esta sesión</legend>
    <label className="block text-xs">Compañero
      <select aria-label="Compañero de esta sesión" value={availability.partnerAvailability ?? ''} onChange={e => onChange({ ...value, availability: { ...availability, partnerAvailability: (e.target.value || undefined) as typeof availability.partnerAvailability } })} className="ml-2 rounded border bg-surface-raised p-1">
        <option value="">Usar disponibilidad del plan</option><option value="solo">Solo</option><option value="partner">Con compañero</option><option value="either">Flexible</option>
      </select>
    </label>
    <div className="flex flex-wrap gap-3">{([['court', 'Cancha'], ['coach', 'Entrenador'], ['feeder', 'Alimentador']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}
      <select aria-label={label} value={availability[key] == null ? '' : String(availability[key])} onChange={e => onChange({ ...value, availability: { ...availability, [key]: e.target.value === '' ? undefined : e.target.value === 'true' } })} className="ml-1 rounded border bg-surface-raised p-1"><option value="">Sin declarar</option><option value="true">Disponible</option><option value="false">No disponible</option></select>
    </label>)}</div>
    <label className="block text-xs">Material
      <select aria-label="Material de squash" value={availability.equipment == null ? '' : availability.equipment.length ? 'racket_ball' : 'none'} onChange={e => onChange({ ...value, availability: { ...availability, equipment: e.target.value === '' ? undefined : e.target.value === 'none' ? [] : ['racket', 'ball'] } })} className="ml-2 rounded border bg-surface-raised p-1"><option value="">Sin declarar</option><option value="racket_ball">Raqueta y pelota</option><option value="none">Sin material</option></select>
    </label>
    <label className="block text-xs">Familia técnica
      <select aria-label="Familia técnica" value={value.technicalIntent?.family ?? ''} onChange={e => onChange({ ...value, technicalIntent: e.target.value ? { ...value.technicalIntent, family: e.target.value } : undefined })} className="ml-2 rounded border bg-surface-raised p-1"><option value="">Sin objetivo específico</option>{families.map(f => <option key={f} value={f}>{f.replaceAll('_', ' ')}</option>)}</select>
    </label>
    {value.technicalIntent && <div className="flex flex-wrap gap-3">
      <label className="text-xs">Lado<select aria-label="Lado técnico" value={value.technicalIntent.side ?? 'both'} onChange={e => onChange({ ...value, technicalIntent: { ...value.technicalIntent!, side: e.target.value as 'forehand' | 'backhand' | 'both' } })} className="ml-1 rounded border bg-surface-raised p-1"><option value="both">Ambos</option><option value="forehand">Derecha</option><option value="backhand">Revés</option></select></label>
      <label className="text-xs">Objetivo de aciertos (%)<input aria-label="Objetivo de aciertos" type="number" min="1" max="100" value={value.technicalIntent.successTarget ?? ''} onChange={e => onChange({ ...value, technicalIntent: { ...value.technicalIntent!, successTarget: e.target.value ? Number(e.target.value) : undefined } })} className="ml-1 w-16 rounded border bg-surface-raised p-1" /></label>
    </div>}
    {results && <div className="space-y-1"><p className="text-xs text-ink-muted">Resultado realizado. Se usa para progresión cuando la sesión esté completada o ajustada.</p>
      {(['attempts', 'successes'] as const).map(key => <label key={key} className="mr-3 text-xs">{key === 'attempts' ? 'Intentos' : 'Aciertos'}<input aria-label={key === 'attempts' ? 'Intentos técnicos' : 'Aciertos técnicos'} type="number" min="0" step="1" value={value.technicalResult?.[key] ?? ''} onChange={e => setResult(key, e.target.value)} className="ml-1 w-20 rounded border bg-surface-raised p-1" /></label>)}
    </div>}
  </fieldset>
}
