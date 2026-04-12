import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import { ROUTES } from '../constants/routes'
import { getAllowedPlanningSports } from '../services/planningConstraints'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { getPrimaryGoalEvent } from '../services/macroPlan'
import { getAthleteFirstName } from '../utils/athlete'
import { useWeeklyLaunchIntent } from '../hooks/useWeeklyLaunchIntent'

const WEEK_OPTIONS = [
  { value: 'esta', label: 'Esta semana' },
  { value: 'proxima', label: 'Próxima semana' },
  { value: 'completo', label: 'Plan completo' },
] as const

const MAX_PLAN_WEEKS = 12

const FOCUS_OPTIONS = [
  { value: 'balance', label: 'Balance general' },
  { value: 'competencia', label: 'Competencia cercana' },
  { value: 'carga', label: 'Subir carga' },
  { value: 'recuperacion', label: 'Recuperación' },
] as const

export default function PlanBuilderPage() {
  const navigate = useNavigate()
  const athleteProfile = useCoachMemoryStore((state) => state.athleteProfile)
  const athleteFirstName = getAthleteFirstName(athleteProfile, 'atleta')
  const enabledSports = getAllowedPlanningSports(athleteProfile)
  const goalEvent = getPrimaryGoalEvent(athleteProfile)
  useWeeklyLaunchIntent()

  const [weekTarget, setWeekTarget] = useState<(typeof WEEK_OPTIONS)[number]['value']>('esta')
  const [focus, setFocus] = useState<(typeof FOCUS_OPTIONS)[number]['value']>('balance')
  const [notes, setNotes] = useState('')

  const weeksToEvent = useMemo(() => {
    if (!goalEvent) return null
    const today = new Date()
    const eventDate = new Date(goalEvent.date)
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    return Math.max(1, Math.ceil((eventDate.getTime() - today.getTime()) / msPerWeek))
  }, [goalEvent])

  const planWeeksCount = useMemo(() => {
    if (weekTarget !== 'completo') return null
    return Math.min(weeksToEvent ?? 8, MAX_PLAN_WEEKS)
  }, [weekTarget, weeksToEvent])

  const cappedAt12 = weeksToEvent != null && weeksToEvent > MAX_PLAN_WEEKS

  const prompt = useMemo(() => {
    const focusText = FOCUS_OPTIONS.find((item) => item.value === focus)?.label.toLowerCase() ?? 'balance general'
    const sportsText = enabledSports.length > 0 ? enabledSports.join(', ') : 'mi perfil actual'
    const notesText = notes.trim() ? ` Notas: ${notes.trim()}.` : ''

    if (weekTarget === 'completo') {
      const count = planWeeksCount ?? 8
      const weekStarts = buildWeekStartDates(count)
      const weekSchedule = weekStarts.map((date, i) => `Semana ${i + 1}: lunes ${date}`).join(' | ')
      const eventText = goalEvent ? ` preparando para ${goalEvent.title} el ${goalEvent.date}` : ''
      return `Créame un plan de entrenamiento completo para ${count} semanas${eventText}. Genera UNA acción create_week por semana (${count} acciones en total). Semanas: ${weekSchedule}. Foco general: ${focusText}. Deportes: ${sportsText}. Sesiones compactas — omite warmup/cooldown, el sistema los genera. 4-6 sesiones por semana.${notesText}`
    }

    const weekText = weekTarget === 'esta' ? 'esta semana' : 'la próxima semana'
    const eventText = goalEvent ? ` Considera como evento principal ${goalEvent.title} el ${goalEvent.date}.` : ''
    return `Créame un plan de entrenamiento para ${weekText}. Prioriza ${focusText}. Usa mis deportes activos (${sportsText}) y mi perfil del atleta.${eventText}${notesText}`
  }, [enabledSports, focus, goalEvent, notes, planWeeksCount, weekTarget])

  return (
    <div className="px-4 pt-12 pb-8 space-y-5 md:px-6 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Plan Builder</h1>
        <p className="text-sm text-ink-muted">
          Crea una semana con inputs guiados y luego envíala al coach para generar el borrador.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Atleta</p>
          <p className="mt-1 text-sm text-ink">{athleteFirstName}</p>
          {goalEvent && (
            <p className="mt-1 text-xs text-ink-faint">
              Evento principal activo: {goalEvent.title} · {goalEvent.date}
            </p>
          )}
        </div>

        <Field label="Semana objetivo">
          <div className="flex flex-wrap gap-2">
            {WEEK_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setWeekTarget(option.value)}
                className={choiceCls(weekTarget === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {weekTarget === 'completo' && (
            <div className="mt-2 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-xs text-ink-muted">
              {planWeeksCount != null && (
                <span>Se generarán <strong className="text-ink">{planWeeksCount} semanas</strong> de sesiones.</span>
              )}
              {!goalEvent && (
                <span> Sin evento configurado: se usarán 8 semanas por defecto.</span>
              )}
              {cappedAt12 && (
                <span> Tu evento está a {weeksToEvent} semanas — se limita a {MAX_PLAN_WEEKS} para optimizar la respuesta del coach. Podés extender más adelante.</span>
              )}
            </div>
          )}
        </Field>

        <Field label="Foco principal">
          <div className="flex flex-wrap gap-2">
            {FOCUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFocus(option.value)}
                className={choiceCls(focus === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notas para el plan" hint="opcional">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder="Ej: llego cansado, quiero priorizar running, tengo partido el sábado..."
            className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </Field>

        <div className="rounded-xl border border-surface-border bg-surface-raised px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Prompt estructurado</p>
          <p className="mt-2 text-sm leading-relaxed text-ink">{prompt}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate(ROUTES.CHAT, { state: { composerDraft: prompt, fromPlanBuilder: true } })}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light"
          >
            Abrir en coach
          </button>
          <button
            onClick={() => navigate(ROUTES.WEEK)}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-raised px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Volver a semana
          </button>
        </div>
      </Card>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function choiceCls(active: boolean): string {
  return `rounded-xl border px-3 py-2 text-sm transition-colors ${
    active
      ? 'border-brand/40 bg-brand/15 text-brand-light'
      : 'border-surface-border bg-surface-raised text-ink-muted hover:border-brand/30 hover:text-ink'
  }`
}

function buildWeekStartDates(count: number): string[] {
  const formatLocalISODate = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(today)
  monday.setDate(today.getDate() + daysToMonday)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: count }, (_, i) => {
    const ws = new Date(monday)
    ws.setDate(monday.getDate() + i * 7)
    return formatLocalISODate(ws)
  })
}
