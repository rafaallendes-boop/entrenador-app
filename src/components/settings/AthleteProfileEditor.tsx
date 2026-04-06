import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type {
  AthleteProfile,
  NutritionProfile,
  RecoveryProfile,
  RunningProfile,
  ScheduleProfile,
  StrengthProfile,
  SupportedSport,
  TrainingPriority,
} from '../../types'
import {
  getEnabledSports,
  getPrimarySportNormalized,
  getSportPrioritySummary,
} from '../../utils/athlete'
import { computeMacroPlan } from '../../services/macroPlan'


const DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']

const SPORT_OPTIONS: { value: SupportedSport; label: string }[] = [
  { value: 'squash', label: 'Squash' },
  { value: 'running', label: 'Running' },
  { value: 'cycling', label: 'Bicicleta' },
  { value: 'strength', label: 'Pesas / Fuerza' },
  { value: 'mobility', label: 'Movilidad' },
]

const PRIORITY_OPTIONS: { value: TrainingPriority; label: string }[] = [
  { value: 'performance', label: 'Competir mejor' },
  { value: 'fitness', label: 'Condicion fisica' },
  { value: 'body_composition', label: 'Composicion corporal' },
  { value: 'return_to_play', label: 'Volver de lesion' },
]

interface Props {
  profile: AthleteProfile | null
  isSaving: boolean
  onSave: (patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>) => Promise<void>
}

type Section = 'sport' | 'running' | 'strength' | 'recovery' | 'schedule' | 'nutrition' | 'goalEvent'

export default function AthleteProfileEditor({ profile, isSaving, onSave }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState<Section | null>(null)
  const [saved, setSaved] = useState(false)

  const [name, setName] = useState(profile?.name ?? '')
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '')
  const [weightKg, setWeightKg] = useState(profile?.weightKg != null ? String(profile.weightKg) : '')
  const [enabledSports, setEnabledSports] = useState<SupportedSport[]>(() => getEnabledSports(profile))
  const [primarySportCtx, setPrimarySportCtx] = useState<SupportedSport | null>(
    () => getPrimarySportNormalized(profile) ?? null,
  )
  const [trainingPriority, setTrainingPriority] = useState<TrainingPriority | null>(
    profile?.sportContext?.trainingPriority ?? null,
  )
  const [mainGoal, setMainGoal] = useState(profile?.mainGoal ?? '')
  const [secondaryGoal, setSecondaryGoal] = useState(profile?.secondaryGoal ?? '')
  const [running, setRunning] = useState<RunningProfile>(profile?.runningProfile ?? {})
  const [strength, setStrength] = useState<StrengthProfile>(profile?.strengthProfile ?? {})
  const [recovery, setRecovery] = useState<RecoveryProfile>(profile?.recoveryProfile ?? {})
  const [availableDays, setAvailableDays] = useState<string[]>(profile?.scheduleProfile?.availableDays ?? [])
  const [doubleSessionDays, setDoubleSessionDays] = useState<string[]>(
    profile?.scheduleProfile?.doubleSessionDays ?? [],
  )
  const [scheduleConstraints, setScheduleConstraints] = useState(profile?.scheduleProfile?.constraints ?? '')
  const [nutrition, setNutrition] = useState<NutritionProfile>(profile?.nutritionProfile ?? {})

  // Goal event is now managed by the Competition Plan wizard
  const existingEvent = profile?.goalEvents?.[0]

  const resolvedPrimarySport = primarySportCtx ?? (enabledSports.length === 1 ? enabledSports[0] : null)
  const secondarySportsCtx = resolvedPrimarySport
    ? enabledSports.filter((sport) => sport !== resolvedPrimarySport)
    : enabledSports
  const sportSummaryProfile: AthleteProfile = {
    id: profile?.id ?? 'draft',
    updatedAt: profile?.updatedAt ?? 0,
    ...(profile ?? {}),
    primarySport: resolvedPrimarySport ?? undefined,
    secondarySports: secondarySportsCtx.length > 0 ? secondarySportsCtx : undefined,
    sportContext: resolvedPrimarySport
      ? {
          enabledSports,
          primarySport: resolvedPrimarySport,
          secondarySports: secondarySportsCtx,
          trainingPriority: trainingPriority ?? undefined,
        }
      : undefined,
  }
  const sportSummary = getSportPrioritySummary(sportSummaryProfile)

  const toggle = (section: Section) => setOpen((prev) => (prev === section ? null : section))

  function toggleSport(sport: SupportedSport) {
    setEnabledSports((prev) => {
      const next = prev.includes(sport) ? prev.filter((item) => item !== sport) : [...prev, sport]
      if (next.length === 0) {
        setPrimarySportCtx(null)
      } else if (!resolvedPrimarySport || !next.includes(resolvedPrimarySport)) {
        setPrimarySportCtx(next[0] ?? null)
      }
      return next
    })
  }

  async function handleSave() {
    const scheduleProfile: ScheduleProfile = {
      availableDays: availableDays.length > 0 ? availableDays : undefined,
      doubleSessionDays: doubleSessionDays.length > 0 ? doubleSessionDays : undefined,
      constraints: scheduleConstraints.trim() || undefined,
    }

    // Goal events are managed by the Competition Plan wizard — preserve as-is
    const goalEvents = profile?.goalEvents
    const draftProfile: AthleteProfile = {
      id: profile?.id ?? 'draft',
      updatedAt: Date.now(),
      goalEvents,
    }
    const macroPlan = computeMacroPlan(draftProfile)

    await onSave({
      name: name.trim() || undefined,
      age: numOrUndef(age),
      weightKg: numOrUndef(weightKg),
      primarySport: resolvedPrimarySport ?? undefined,
      secondarySports: secondarySportsCtx.length > 0 ? secondarySportsCtx : undefined,
      sportContext:
        enabledSports.length > 0 && resolvedPrimarySport
          ? {
              enabledSports,
              primarySport: resolvedPrimarySport,
              secondarySports: secondarySportsCtx,
              trainingPriority: trainingPriority ?? undefined,
            }
          : undefined,
      mainGoal: mainGoal.trim() || undefined,
      secondaryGoal: secondaryGoal.trim() || undefined,
      runningProfile: hasData(running) ? running : undefined,
      strengthProfile: hasData(strength) ? strength : undefined,
      recoveryProfile: hasData(recovery) ? recovery : undefined,
      scheduleProfile: hasData(scheduleProfile) ? scheduleProfile : undefined,
      nutritionProfile: hasData(nutrition) ? nutrition : undefined,
      goalEvents,
      macroPlan,
    })

    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="space-y-2">
      <SectionPanel
        title="Deporte y objetivos"
        open={open === 'sport'}
        onToggle={() => toggle('sport')}
        filled={enabledSports.length > 0 || !!mainGoal}
      >
        <Field label="Nombre visible">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del atleta"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Edad">
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="32"
              className={inputCls}
              min={10}
              max={99}
            />
          </Field>
          <Field label="Peso (kg)">
            <input
              type="number"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="78"
              className={inputCls}
              min={30}
              max={200}
              step={0.5}
            />
          </Field>
        </div>

        <Field label="Disciplinas que practicas">
          <div className="mt-1 flex flex-wrap gap-2">
            {SPORT_OPTIONS.map((option) => {
              const active = enabledSports.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleSport(option.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-brand/30 bg-brand/15 text-brand-light'
                      : 'border-surface-border bg-surface-raised text-ink-muted hover:border-brand/30'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </Field>

        {enabledSports.length > 0 && (
          <Field label="Disciplina principal">
            {enabledSports.length === 1 ? (
              <div className="mt-1 inline-flex items-center rounded-lg border border-brand/30 bg-brand/15 px-3 py-1.5 text-xs font-medium text-brand-light">
                {SPORT_OPTIONS.find((option) => option.value === enabledSports[0])?.label}
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {SPORT_OPTIONS.filter((option) => enabledSports.includes(option.value)).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPrimarySportCtx(option.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      resolvedPrimarySport === option.value
                        ? 'border-brand/40 bg-brand/20 text-brand-light'
                        : 'border-surface-border bg-surface-raised text-ink-muted hover:border-brand/30'
                    }`}
                  >
                    {option.label}
                    {resolvedPrimarySport === option.value && <span className="ml-1 text-brand-light">OK</span>}
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}

        <Field label="Objetivo de entrenamiento">
          <div className="mt-1 flex flex-wrap gap-2">
            {PRIORITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTrainingPriority((prev) => (prev === option.value ? null : option.value))}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  trainingPriority === option.value
                    ? 'border-brand/30 bg-brand/15 text-brand-light'
                    : 'border-surface-border bg-surface-raised text-ink-muted hover:border-brand/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        {sportSummary && (
          <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Resumen deportivo</p>
            <p className="mt-1 text-sm text-ink">{sportSummary}</p>
          </div>
        )}

        <Field label="Objetivo libre" hint="opcional">
          <input
            value={mainGoal}
            onChange={(e) => setMainGoal(e.target.value)}
            placeholder="ej: llegar al top 10 regional"
            className={inputCls}
          />
        </Field>

        <Field label="Objetivo secundario" hint="opcional">
          <input
            value={secondaryGoal}
            onChange={(e) => setSecondaryGoal(e.target.value)}
            placeholder="ej: preparar media maraton"
            className={inputCls}
          />
        </Field>
      </SectionPanel>

      <SectionPanel
        title="Perfil de running"
        open={open === 'running'}
        onToggle={() => toggle('running')}
        filled={!!(running.fiveKTime || running.z2PaceMin)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="5K actual">
            <input
              value={running.fiveKTime ?? ''}
              onChange={(e) => setRunning((r) => ({ ...r, fiveKTime: e.target.value || undefined }))}
              placeholder="23:30"
              className={inputCls}
            />
          </Field>
          <Field label="10K actual">
            <input
              value={running.tenKTime ?? ''}
              onChange={(e) => setRunning((r) => ({ ...r, tenKTime: e.target.value || undefined }))}
              placeholder="49:00"
              className={inputCls}
            />
          </Field>
          <Field label="Media maraton">
            <input
              value={running.halfMarathonTime ?? ''}
              onChange={(e) => setRunning((r) => ({ ...r, halfMarathonTime: e.target.value || undefined }))}
              placeholder="1:48:00"
              className={inputCls}
            />
          </Field>
        </div>

        <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          Ritmos /km <span className="normal-case font-normal">(formato M:SS, ej: 5:30)</span>
        </p>

        <div className="grid grid-cols-2 gap-3">
          {([
            ['Z2 min', 'z2PaceMin', '5:30'],
            ['Z2 max', 'z2PaceMax', '6:00'],
            ['Easy min', 'easyPaceMin', '5:45'],
            ['Easy max', 'easyPaceMax', '6:15'],
            ['Umbral', 'thresholdPace', '4:45'],
            ['Long run', 'longRunPace', '5:50'],
          ] as const).map(([label, key, placeholder]) => {
            const value = running[key] ?? ''
            const invalid = !isValidPace(value)
            return (
              <Field key={key} label={label}>
                <input
                  value={value}
                  onChange={(e) => setRunning((r) => ({ ...r, [key]: e.target.value || undefined }))}
                  placeholder={placeholder}
                  className={invalid && value ? inputErrCls : inputCls}
                />
                {invalid && value && (
                  <p className="mt-0.5 text-[10px] text-rose-400">Formato: M:SS (ej: {placeholder})</p>
                )}
              </Field>
            )
          })}
        </div>

        <Field label="Notas running" className="mt-3">
          <input
            value={running.notes ?? ''}
            onChange={(e) => setRunning((r) => ({ ...r, notes: e.target.value || undefined }))}
            placeholder="molestia gemelo izquierdo, foco en Z2 este bloque..."
            className={inputCls}
          />
        </Field>
      </SectionPanel>

      <SectionPanel
        title="Fuerza - 1RM de referencia"
        open={open === 'strength'}
        onToggle={() => toggle('strength')}
        filled={!!(strength.benchPress1RM || strength.squat1RM)}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Press banca (kg)">
            <input
              type="number"
              value={strength.benchPress1RM ?? ''}
              onChange={(e) => setStrength((s) => ({ ...s, benchPress1RM: numOrUndef(e.target.value) }))}
              placeholder="90"
              className={inputCls}
            />
          </Field>
          <Field label="Sentadilla (kg)">
            <input
              type="number"
              value={strength.squat1RM ?? ''}
              onChange={(e) => setStrength((s) => ({ ...s, squat1RM: numOrUndef(e.target.value) }))}
              placeholder="120"
              className={inputCls}
            />
          </Field>
          <Field label="Peso muerto (kg)">
            <input
              type="number"
              value={strength.deadlift1RM ?? ''}
              onChange={(e) => setStrength((s) => ({ ...s, deadlift1RM: numOrUndef(e.target.value) }))}
              placeholder="140"
              className={inputCls}
            />
          </Field>
          <Field label="Press hombro (kg)">
            <input
              type="number"
              value={strength.overheadPress1RM ?? ''}
              onChange={(e) => setStrength((s) => ({ ...s, overheadPress1RM: numOrUndef(e.target.value) }))}
              placeholder="65"
              className={inputCls}
            />
          </Field>
          <Field label="Dominadas (reps)">
            <input
              type="number"
              value={strength.pullUpMaxReps ?? ''}
              onChange={(e) => setStrength((s) => ({ ...s, pullUpMaxReps: numOrUndef(e.target.value) }))}
              placeholder="12"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Notas fuerza" className="mt-3">
          <input
            value={strength.notes ?? ''}
            onChange={(e) => setStrength((s) => ({ ...s, notes: e.target.value || undefined }))}
            placeholder="foco en press este bloque, pierna limitada por isquio..."
            className={inputCls}
          />
        </Field>
      </SectionPanel>

      <SectionPanel
        title="Lesiones y restricciones"
        open={open === 'recovery'}
        onToggle={() => toggle('recovery')}
        filled={!!(recovery.currentInjuries || recovery.restrictions)}
      >
        <Field label="Lesion o molestia actual">
          <input
            value={recovery.currentInjuries ?? ''}
            onChange={(e) => setRecovery((r) => ({ ...r, currentInjuries: e.target.value || undefined }))}
            placeholder="dolor isquiotibial derecho, evitar sentadilla pesada"
            className={inputCls}
          />
        </Field>
        <Field label="Restricciones activas">
          <input
            value={recovery.restrictions ?? ''}
            onChange={(e) => setRecovery((r) => ({ ...r, restrictions: e.target.value || undefined }))}
            placeholder="no fuerza pesada el dia previo a partido"
            className={inputCls}
          />
        </Field>
        <Field label="Lesiones previas relevantes">
          <input
            value={recovery.previousInjuries ?? ''}
            onChange={(e) => setRecovery((r) => ({ ...r, previousInjuries: e.target.value || undefined }))}
            placeholder="rotura de fibras gemelo 2024"
            className={inputCls}
          />
        </Field>
      </SectionPanel>

      <SectionPanel
        title="Disponibilidad semanal"
        open={open === 'schedule'}
        onToggle={() => toggle('schedule')}
        filled={availableDays.length > 0}
      >
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">Dias disponibles</p>
          <DayPicker selected={availableDays} onChange={setAvailableDays} />
          <p className="mt-2 text-xs text-ink-muted">Dias con doble sesion posible</p>
          <DayPicker selected={doubleSessionDays} onChange={setDoubleSessionDays} />
          <Field label="Restricciones horarias" className="mt-3">
            <input
              value={scheduleConstraints}
              onChange={(e) => setScheduleConstraints(e.target.value)}
              placeholder="solo AM los martes, no disponible sabados"
              className={inputCls}
            />
          </Field>
        </div>
      </SectionPanel>

      <SectionPanel
        title="Objetivo principal"
        open={open === 'goalEvent'}
        onToggle={() => toggle('goalEvent')}
        filled={!!existingEvent}
      >
        <p className="text-xs text-ink-muted mb-3 leading-relaxed">
          Tu evento principal se configura con el wizard "Plan de competencia", que también crea el plan de entrenamiento por fases.
        </p>

        {existingEvent ? (
          <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-3 mb-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint mb-1">Evento activo</p>
            <p className="text-sm font-medium text-ink">{existingEvent.title}</p>
            <p className="text-xs text-ink-muted mt-0.5">{existingEvent.date} · {existingEvent.sport}</p>
          </div>
        ) : (
          <p className="text-xs text-ink-faint mb-3">No hay evento configurado.</p>
        )}

        <a
          href="/competition-plan"
          onClick={(e) => { e.preventDefault(); navigate('/competition-plan') }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-medium text-brand-light hover:bg-brand/20 transition-colors"
        >
          <ExternalLink size={14} />
          {existingEvent ? 'Editar en Plan de competencia' : 'Crear Plan de competencia'}
        </a>
      </SectionPanel>

      <SectionPanel
        title="Nutricion y composicion corporal"
        open={open === 'nutrition'}
        onToggle={() => toggle('nutrition')}
        filled={hasData(nutrition)}
      >
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Composicion corporal</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Peso objetivo (kg)">
            <input
              type="number"
              value={nutrition.goalBodyWeightKg ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, goalBodyWeightKg: numOrUndef(e.target.value) }))}
              placeholder="75"
              className={inputCls}
              step={0.5}
            />
          </Field>
          <Field label="% masa grasa actual">
            <input
              type="number"
              value={nutrition.fatMassPct ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, fatMassPct: numOrUndef(e.target.value) }))}
              placeholder="20"
              className={inputCls}
              step={0.1}
            />
          </Field>
          <Field label="% masa grasa objetivo">
            <input
              type="number"
              value={nutrition.fatMassGoalPct ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, fatMassGoalPct: numOrUndef(e.target.value) }))}
              placeholder="16"
              className={inputCls}
              step={0.1}
            />
          </Field>
          <Field label="Masa muscular (kg)">
            <input
              type="number"
              value={nutrition.muscleMassKg ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, muscleMassKg: numOrUndef(e.target.value) }))}
              placeholder="38.7"
              className={inputCls}
              step={0.1}
            />
          </Field>
          <Field label="Masa muscular objetivo (kg)">
            <input
              type="number"
              value={nutrition.muscleMassGoalKg ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, muscleMassGoalKg: numOrUndef(e.target.value) }))}
              placeholder="40"
              className={inputCls}
              step={0.1}
            />
          </Field>
        </div>

        <p className="mb-1 mt-4 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Objetivos diarios</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proteina diaria (g)" hint="~2g/kg como referencia">
            <input
              type="number"
              value={nutrition.proteinTargetG ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, proteinTargetG: numOrUndef(e.target.value) }))}
              placeholder="156"
              className={inputCls}
            />
          </Field>
          <Field label="Agua base (L/dia)" hint="sin entrenar">
            <input
              type="number"
              value={nutrition.dailyWaterLiters ?? ''}
              onChange={(e) => setNutrition((n) => ({ ...n, dailyWaterLiters: numOrUndef(e.target.value) }))}
              placeholder="2.5"
              className={inputCls}
              step={0.1}
            />
          </Field>
        </div>

        <Field label="Intolerancias / preferencias" className="mt-3">
          <input
            value={nutrition.notes ?? ''}
            onChange={(e) => setNutrition((n) => ({ ...n, notes: e.target.value || undefined }))}
            placeholder="sin lactosa, prefiere pollo y pescado..."
            className={inputCls}
          />
        </Field>
      </SectionPanel>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-400">
            ✓ Perfil guardado
          </span>
        )}
        <button
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Guardando...' : 'Guardar perfil'}
        </button>
      </div>
    </div>
  )
}

function SectionPanel({
  title,
  open,
  onToggle,
  filled,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  filled: boolean
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-surface-raised px-3 py-2.5 transition-colors hover:bg-surface"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          {filled && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-light" />}
          {title}
        </span>
        {open ? <ChevronUp size={15} className="text-ink-faint" /> : <ChevronDown size={15} className="text-ink-faint" />}
      </button>
      {open && <div className="space-y-3 border-t border-surface-border bg-surface px-3 py-3">{children}</div>}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs text-ink-muted">
        {label}
        {hint && <span className="ml-1 text-ink-faint">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function DayPicker({ selected, onChange }: { selected: string[]; onChange: (days: string[]) => void }) {
  const toggle = (day: string) =>
    onChange(selected.includes(day) ? selected.filter((item) => item !== day) : [...selected, day])

  return (
    <div className="flex flex-wrap gap-1.5">
      {DAYS.map((day) => (
        <button
          key={day}
          onClick={() => toggle(day)}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
            selected.includes(day)
              ? 'border-brand/30 bg-brand/20 text-brand-light'
              : 'border-surface-border bg-surface-raised text-ink-muted'
          }`}
        >
          {day}
        </button>
      ))}
    </div>
  )
}

const inputCls =
  'w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40'
const inputErrCls =
  'w-full rounded-xl border border-rose-500/50 bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-rose-500/40'

function isValidPace(value: string): boolean {
  return value === '' || /^\d{1,2}:\d{2}$/.test(value)
}

function numOrUndef(value: string): number | undefined {
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function hasData(obj: object): boolean {
  return Object.values(obj).some(
    (value) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
  )
}
