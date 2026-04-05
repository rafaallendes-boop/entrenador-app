import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type {
  AthleteProfile,
  RunningProfile,
  StrengthProfile,
  RecoveryProfile,
  ScheduleProfile,
  NutritionProfile,
} from '../../types'

const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

interface Props {
  profile: AthleteProfile | null
  isSaving: boolean
  onSave: (patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>) => Promise<void>
}

type Section = 'sport' | 'running' | 'strength' | 'recovery' | 'schedule' | 'nutrition'

export default function AthleteProfileEditor({ profile, isSaving, onSave }: Props) {
  const [open, setOpen] = useState<Section | null>(null)
  const [saved, setSaved] = useState(false)

  // Local draft state per section
  const [name, setName] = useState(profile?.name ?? '')
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '')
  const [weightKg, setWeightKg] = useState(profile?.weightKg != null ? String(profile.weightKg) : '')
  const [primarySport, setPrimarySport] = useState(profile?.primarySport ?? '')
  const [secondarySports, setSecondarySports] = useState(profile?.secondarySports?.join(', ') ?? '')
  const [mainGoal, setMainGoal] = useState(profile?.mainGoal ?? '')
  const [secondaryGoal, setSecondaryGoal] = useState(profile?.secondaryGoal ?? '')

  const [running, setRunning] = useState<RunningProfile>(profile?.runningProfile ?? {})
  const [strength, setStrength] = useState<StrengthProfile>(profile?.strengthProfile ?? {})
  const [recovery, setRecovery] = useState<RecoveryProfile>(profile?.recoveryProfile ?? {})
  const [availableDays, setAvailableDays] = useState<string[]>(profile?.scheduleProfile?.availableDays ?? [])
  const [doubleSessionDays, setDoubleSessionDays] = useState<string[]>(profile?.scheduleProfile?.doubleSessionDays ?? [])
  const [scheduleConstraints, setScheduleConstraints] = useState(profile?.scheduleProfile?.constraints ?? '')
  const [nutrition, setNutrition] = useState<NutritionProfile>(profile?.nutritionProfile ?? {})

  const handleSave = async () => {
    const scheduleProfile: ScheduleProfile = {
      availableDays: availableDays.length > 0 ? availableDays : undefined,
      doubleSessionDays: doubleSessionDays.length > 0 ? doubleSessionDays : undefined,
      constraints: scheduleConstraints.trim() || undefined,
    }

    await onSave({
      name: name.trim() || undefined,
      age: numOrUndef(age),
      weightKg: numOrUndef(weightKg),
      primarySport: primarySport.trim() || undefined,
      secondarySports: secondarySports.trim()
        ? secondarySports.split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
      mainGoal: mainGoal.trim() || undefined,
      secondaryGoal: secondaryGoal.trim() || undefined,
      runningProfile: hasData(running) ? running : undefined,
      strengthProfile: hasData(strength) ? strength : undefined,
      recoveryProfile: hasData(recovery) ? recovery : undefined,
      scheduleProfile: hasData(scheduleProfile) ? scheduleProfile : undefined,
      nutritionProfile: hasData(nutrition) ? nutrition : undefined,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const toggle = (s: Section) => setOpen(prev => prev === s ? null : s)

  return (
    <div className="space-y-2">

      {/* Sport & Goals */}
      <SectionPanel
        title="Deporte y objetivos"
        open={open === 'sport'}
        onToggle={() => toggle('sport')}
        filled={!!(primarySport || mainGoal)}
      >
        <Field label="Nombre visible">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre del atleta"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Edad">
            <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="32" className={inputCls} min={10} max={99} />
          </Field>
          <Field label="Peso (kg)">
            <input type="number" value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="78" className={inputCls} min={30} max={200} step={0.5} />
          </Field>
        </div>
        <Field label="Deporte principal">
          <input
            value={primarySport}
            onChange={e => setPrimarySport(e.target.value)}
            placeholder="squash"
            className={inputCls}
          />
        </Field>
        <Field label="Deportes secundarios" hint="separados por coma">
          <input
            value={secondarySports}
            onChange={e => setSecondarySports(e.target.value)}
            placeholder="running, fuerza"
            className={inputCls}
          />
        </Field>
        <Field label="Objetivo principal">
          <input
            value={mainGoal}
            onChange={e => setMainGoal(e.target.value)}
            placeholder="rendir mejor en squash"
            className={inputCls}
          />
        </Field>
        <Field label="Objetivo secundario">
          <input
            value={secondaryGoal}
            onChange={e => setSecondaryGoal(e.target.value)}
            placeholder="preparar media maratón"
            className={inputCls}
          />
        </Field>
      </SectionPanel>

      {/* Running */}
      <SectionPanel
        title="Perfil de running"
        open={open === 'running'}
        onToggle={() => toggle('running')}
        filled={!!(running.fiveKTime || running.z2PaceMin)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="5K actual">
            <input value={running.fiveKTime ?? ''} onChange={e => setRunning(r => ({ ...r, fiveKTime: e.target.value || undefined }))} placeholder="23:30" className={inputCls} />
          </Field>
          <Field label="10K actual">
            <input value={running.tenKTime ?? ''} onChange={e => setRunning(r => ({ ...r, tenKTime: e.target.value || undefined }))} placeholder="49:00" className={inputCls} />
          </Field>
          <Field label="Media maratón">
            <input value={running.halfMarathonTime ?? ''} onChange={e => setRunning(r => ({ ...r, halfMarathonTime: e.target.value || undefined }))} placeholder="1:48:00" className={inputCls} />
          </Field>
        </div>
        <p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium mt-3 mb-1">Ritmos /km <span className="normal-case font-normal">(formato M:SS, ej: 5:30)</span></p>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['Z2 mín', 'z2PaceMin', '5:30'],
            ['Z2 máx', 'z2PaceMax', '6:00'],
            ['Easy mín', 'easyPaceMin', '5:45'],
            ['Easy máx', 'easyPaceMax', '6:15'],
            ['Umbral', 'thresholdPace', '4:45'],
            ['Long run', 'longRunPace', '5:50'],
          ] as const).map(([label, key, ph]) => {
            const val = running[key] ?? ''
            const err = !isValidPace(val)
            return (
              <Field key={key} label={label}>
                <input
                  value={val}
                  onChange={e => {
                    const v = e.target.value
                    setRunning(r => ({ ...r, [key]: v || undefined }))
                  }}
                  placeholder={ph}
                  className={err && val ? inputErrCls : inputCls}
                />
                {err && val && <p className="text-[10px] text-rose-400 mt-0.5">Formato: M:SS (ej: {ph})</p>}
              </Field>
            )
          })}
        </div>
        <Field label="Notas running" className="mt-3">
          <input value={running.notes ?? ''} onChange={e => setRunning(r => ({ ...r, notes: e.target.value || undefined }))} placeholder="molestia gemelo izquierdo, foco en Z2 este bloque..." className={inputCls} />
        </Field>
      </SectionPanel>

      {/* Strength */}
      <SectionPanel
        title="Fuerza — 1RM de referencia"
        open={open === 'strength'}
        onToggle={() => toggle('strength')}
        filled={!!(strength.benchPress1RM || strength.squat1RM)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Press banca (kg)">
            <input type="number" value={strength.benchPress1RM ?? ''} onChange={e => setStrength(s => ({ ...s, benchPress1RM: numOrUndef(e.target.value) }))} placeholder="90" className={inputCls} />
          </Field>
          <Field label="Sentadilla (kg)">
            <input type="number" value={strength.squat1RM ?? ''} onChange={e => setStrength(s => ({ ...s, squat1RM: numOrUndef(e.target.value) }))} placeholder="120" className={inputCls} />
          </Field>
          <Field label="Peso muerto (kg)">
            <input type="number" value={strength.deadlift1RM ?? ''} onChange={e => setStrength(s => ({ ...s, deadlift1RM: numOrUndef(e.target.value) }))} placeholder="140" className={inputCls} />
          </Field>
          <Field label="Press hombro (kg)">
            <input type="number" value={strength.overheadPress1RM ?? ''} onChange={e => setStrength(s => ({ ...s, overheadPress1RM: numOrUndef(e.target.value) }))} placeholder="65" className={inputCls} />
          </Field>
          <Field label="Dominadas (reps)">
            <input type="number" value={strength.pullUpMaxReps ?? ''} onChange={e => setStrength(s => ({ ...s, pullUpMaxReps: numOrUndef(e.target.value) }))} placeholder="12" className={inputCls} />
          </Field>
        </div>
        <Field label="Notas fuerza" className="mt-3">
          <input value={strength.notes ?? ''} onChange={e => setStrength(s => ({ ...s, notes: e.target.value || undefined }))} placeholder="foco en press este bloque, pierna limitada por isquio..." className={inputCls} />
        </Field>
      </SectionPanel>

      {/* Recovery */}
      <SectionPanel
        title="Lesiones y restricciones"
        open={open === 'recovery'}
        onToggle={() => toggle('recovery')}
        filled={!!(recovery.currentInjuries || recovery.restrictions)}
      >
        <Field label="Lesión o molestia actual">
          <input value={recovery.currentInjuries ?? ''} onChange={e => setRecovery(r => ({ ...r, currentInjuries: e.target.value || undefined }))} placeholder="dolor isquiotibial derecho, evitar sentadilla pesada" className={inputCls} />
        </Field>
        <Field label="Restricciones activas">
          <input value={recovery.restrictions ?? ''} onChange={e => setRecovery(r => ({ ...r, restrictions: e.target.value || undefined }))} placeholder="no fuerza pesada día previo a partido" className={inputCls} />
        </Field>
        <Field label="Lesiones previas relevantes">
          <input value={recovery.previousInjuries ?? ''} onChange={e => setRecovery(r => ({ ...r, previousInjuries: e.target.value || undefined }))} placeholder="rotura de fibras gemelo 2024" className={inputCls} />
        </Field>
      </SectionPanel>

      {/* Schedule */}
      <SectionPanel
        title="Disponibilidad semanal"
        open={open === 'schedule'}
        onToggle={() => toggle('schedule')}
        filled={availableDays.length > 0}
      >
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">Días disponibles</p>
          <DayPicker selected={availableDays} onChange={setAvailableDays} />
          <p className="text-xs text-ink-muted mt-2">Días con doble sesión posible</p>
          <DayPicker selected={doubleSessionDays} onChange={setDoubleSessionDays} />
          <Field label="Restricciones horarias" className="mt-3">
            <input value={scheduleConstraints} onChange={e => setScheduleConstraints(e.target.value)} placeholder="solo AM los martes, no disponible sábados" className={inputCls} />
          </Field>
        </div>
      </SectionPanel>

      {/* Nutrition */}
      <SectionPanel
        title="Nutrición y composición corporal"
        open={open === 'nutrition'}
        onToggle={() => toggle('nutrition')}
        filled={hasData(nutrition)}
      >
        <p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium mb-1">Composición corporal</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Peso objetivo (kg)">
            <input type="number" value={nutrition.goalBodyWeightKg ?? ''} onChange={e => setNutrition(n => ({ ...n, goalBodyWeightKg: numOrUndef(e.target.value) }))} placeholder="75" className={inputCls} step={0.5} />
          </Field>
          <Field label="% Masa grasa actual">
            <input type="number" value={nutrition.fatMassPct ?? ''} onChange={e => setNutrition(n => ({ ...n, fatMassPct: numOrUndef(e.target.value) }))} placeholder="20" className={inputCls} step={0.1} />
          </Field>
          <Field label="% Masa grasa objetivo">
            <input type="number" value={nutrition.fatMassGoalPct ?? ''} onChange={e => setNutrition(n => ({ ...n, fatMassGoalPct: numOrUndef(e.target.value) }))} placeholder="16" className={inputCls} step={0.1} />
          </Field>
          <Field label="Masa muscular (kg)">
            <input type="number" value={nutrition.muscleMassKg ?? ''} onChange={e => setNutrition(n => ({ ...n, muscleMassKg: numOrUndef(e.target.value) }))} placeholder="38.7" className={inputCls} step={0.1} />
          </Field>
          <Field label="Masa muscular objetivo (kg)">
            <input type="number" value={nutrition.muscleMassGoalKg ?? ''} onChange={e => setNutrition(n => ({ ...n, muscleMassGoalKg: numOrUndef(e.target.value) }))} placeholder="40" className={inputCls} step={0.1} />
          </Field>
        </div>
        <p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium mt-4 mb-1">Objetivos diarios</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proteína diaria (g)" hint="~2g/kg como referencia">
            <input type="number" value={nutrition.proteinTargetG ?? ''} onChange={e => setNutrition(n => ({ ...n, proteinTargetG: numOrUndef(e.target.value) }))} placeholder="156" className={inputCls} />
          </Field>
          <Field label="Agua base (L/día)" hint="sin entrenar">
            <input type="number" value={nutrition.dailyWaterLiters ?? ''} onChange={e => setNutrition(n => ({ ...n, dailyWaterLiters: numOrUndef(e.target.value) }))} placeholder="2.5" className={inputCls} step={0.1} />
          </Field>
        </div>
        <Field label="Intolerancias / preferencias" className="mt-3">
          <input value={nutrition.notes ?? ''} onChange={e => setNutrition(n => ({ ...n, notes: e.target.value || undefined }))} placeholder="sin lactosa, prefiere pollo y pescado..." className={inputCls} />
        </Field>
      </SectionPanel>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-emerald-400 font-medium">Perfil guardado</span>}
        <button
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? 'Guardando...' : 'Guardar perfil'}
        </button>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionPanel({ title, open, onToggle, filled, children }: {
  title: string
  open: boolean
  onToggle: () => void
  filled: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-surface-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-raised hover:bg-surface transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          {filled && <span className="w-1.5 h-1.5 rounded-full bg-brand-light flex-shrink-0" />}
          {title}
        </span>
        {open ? <ChevronUp size={15} className="text-ink-faint" /> : <ChevronDown size={15} className="text-ink-faint" />}
      </button>
      {open && (
        <div className="px-3 py-3 space-y-3 border-t border-surface-border bg-surface">
          {children}
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children, className }: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-ink-muted mb-1">
        {label}{hint && <span className="text-ink-faint ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function DayPicker({ selected, onChange }: { selected: string[]; onChange: (days: string[]) => void }) {
  const toggle = (day: string) =>
    onChange(selected.includes(day) ? selected.filter(d => d !== day) : [...selected, day])

  return (
    <div className="flex gap-1.5 flex-wrap">
      {DAYS.map(day => (
        <button
          key={day}
          onClick={() => toggle(day)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            selected.includes(day)
              ? 'bg-brand/20 text-brand-light border border-brand/30'
              : 'bg-surface-raised text-ink-muted border border-surface-border'
          }`}
        >
          {day}
        </button>
      ))}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-xl bg-surface-raised border border-surface-border px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40'
const inputErrCls = 'w-full rounded-xl bg-surface-raised border border-rose-500/50 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-rose-500/40'

/** Returns true if value matches M:SS or MM:SS format (e.g. "5:30", "12:00") */
function isValidPace(val: string): boolean {
  return val === '' || /^\d{1,2}:\d{2}$/.test(val)
}

function numOrUndef(val: string): number | undefined {
  const n = parseFloat(val)
  return isNaN(n) ? undefined : n
}

function hasData(obj: object): boolean {
  return Object.values(obj).some(v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
}
