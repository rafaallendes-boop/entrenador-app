import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { formatFullDate, fromISO, isDateToday, isStrictISODate, toISO, getWeekStart, todayISO } from '../utils/date'
import PageHeader from '../components/layout/PageHeader'
import SessionCard from '../components/session/SessionCard'
import Slider from '../components/ui/Slider'
import Card from '../components/ui/Card'
import { ROUTES } from '../constants/routes'
import { getActiveAthleteId, getSelfAthleteId } from '../services/athlete/activeAthlete'
import {
  buildDayLogSavePatch,
  buildWhoopPrefillSavePatch,
  canAutoPersistWhoopPrefill,
  hasDayLogPrefillPatch,
  type PrefillField,
} from '../services/readiness/dayLogPrefillSave'
import { getLocalReadinessForDate } from '../services/readiness/localReadiness'
import { prefillDayLog } from '../services/readiness/prefillDayLog'
import { pullReadiness } from '../services/readiness/pullReadiness'
import { getDayNutrition, getLoadTypeLabel, getLoadTypeColor } from '../services/nutritionEngine'
import { resolveSessionProtocols } from '../services/trainingProtocols'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import type { AthleteProfile, DayLog, GeneratedProtocol, ReadinessDaily, Session } from '../types'

function DayFeedbackFields({
  dayLog,
  onSave,
}: {
  dayLog?: DayLog
  onSave: (patch: Partial<DayLog>) => void
}) {
  const [painNotes, setPainNotes] = useState(dayLog?.painNotes ?? '')
  const [postComment, setPostComment] = useState(dayLog?.postSessionComment ?? '')

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-ink-muted">Comentario post-sesión</label>
        <textarea
          value={postComment}
          onChange={e => setPostComment(e.target.value)}
          onBlur={() => onSave({ postSessionComment: postComment || undefined })}
          placeholder="Cómo fue, sensaciones, qué mejorar..."
          rows={2}
          className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
        />
      </div>

      {dayLog?.painLevel != null && dayLog.painLevel > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-muted">Descripción del dolor</label>
          <textarea
            value={painNotes}
            onChange={e => setPainNotes(e.target.value)}
            onBlur={() => onSave({ painNotes: painNotes || undefined })}
            placeholder="Localización, tipo, intensidad..."
            rows={2}
            className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
          />
        </div>
      )}
    </>
  )
}

function DayRecoveryNotes({
  dayLog,
  sleepHoursValue,
  sleepHoursFromWhoop,
  onSave,
}: {
  dayLog?: DayLog
  sleepHoursValue?: number
  sleepHoursFromWhoop?: boolean
  onSave: (patch: Partial<DayLog>, editedPrefillFields?: PrefillField[]) => void
}) {
  const [notes, setNotes] = useState(dayLog?.generalNotes ?? '')
  const [sleepHours, setSleepHours] = useState(sleepHoursValue?.toString() ?? '')

  const saveSleepHours = () => {
    const normalized = sleepHours.trim().replace(',', '.')
    const parsed = normalized === '' ? undefined : Number(normalized)

    onSave(
      { sleepHours: parsed != null && Number.isFinite(parsed) ? parsed : undefined },
      ['sleepHours'],
    )

    if (parsed != null && Number.isFinite(parsed)) {
      setSleepHours(String(parsed))
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-ink-muted">Horas de sueño</label>
            {sleepHoursFromWhoop && <WhoopPrefillHint />}
          </div>
          <span className="text-sm font-semibold text-ink">
            {sleepHoursValue != null ? `${sleepHoursValue}h` : '—'}
          </span>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={sleepHours}
          onChange={e => setSleepHours(e.target.value)}
          onBlur={saveSleepHours}
          placeholder="ej: 7,5"
          className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint w-full focus:outline-none focus:border-brand/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-ink-muted">Notas generales del día</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => onSave({ generalNotes: notes || undefined })}
          placeholder="Cómo fue el día en general..."
          rows={2}
          className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
        />
      </div>
    </>
  )
}

function DayNutritionCard({
  sessions,
  profile,
  dayLog,
}: {
  sessions: Session[]
  profile?: AthleteProfile | null
  dayLog?: DayLog
}) {
  const rec = getDayNutrition(sessions, profile, dayLog)
  const colorClass = getLoadTypeColor(rec.loadType)
  const label = getLoadTypeLabel(rec.loadType)
  const sportLabel = getNutritionSportLabel(rec.sport)
  const sessionLabel = `${rec.sessionCount} sesión${rec.sessionCount === 1 ? '' : 'es'}`
  const preLabel = getNutritionTimingLabel(rec.sport, rec.loadType, 'pre')
  const postLabel = getNutritionTimingLabel(rec.sport, rec.loadType, 'post')

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Nutrición del día</h2>
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            {sportLabel} · {sessionLabel}
          </p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
          {label}
        </span>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-ink">{rec.mainFocus}</p>
        <p className="text-xs text-amber-300">{rec.keyAction}</p>
        <p className="text-xs text-ink-muted">{rec.whyItMatters}</p>
      </div>
      {rec.proteinTarget && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-400">{rec.proteinTarget}</span>
          <span className="text-[10px] text-ink-faint">objetivo del día</span>
        </div>
      )}
      <div className="space-y-2 pt-1">
        <div>
          <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">Hidratación</p>
          <p className="text-xs text-ink-muted mt-0.5">{rec.hydrationGuidance.summary}</p>
        </div>
        {rec.preWorkoutGuidance && (
          <div>
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">{preLabel}</p>
            <p className="text-xs text-ink-muted mt-0.5">{rec.preWorkoutGuidance.summary}</p>
          </div>
        )}
        {rec.postWorkoutGuidance && (
          <div>
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">{postLabel}</p>
            <p className="text-xs text-ink-muted mt-0.5">{rec.postWorkoutGuidance.summary}</p>
          </div>
        )}
        {rec.recoveryNote && (
          <div>
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">Recuperación</p>
            <p className="text-xs text-ink-muted mt-0.5">{rec.recoveryNote}</p>
          </div>
        )}
        <div>
          <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">Contexto {sportLabel}</p>
          <p className="text-xs text-ink-muted mt-0.5">{rec.reasoning.summary}</p>
        </div>
      </div>
      {rec.dietaryNotes && (
        <div className="pt-2 border-t border-surface-border">
          <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider mb-1">Tus preferencias</p>
          <p className="text-xs text-ink-muted leading-relaxed">{rec.dietaryNotes}</p>
        </div>
      )}
    </Card>
  )
}

function getNutritionSportLabel(sport: ReturnType<typeof getDayNutrition>['sport']): string {
  switch (sport) {
    case 'running':
      return 'running'
    case 'cycling':
      return 'ciclismo'
    case 'strength':
      return 'fuerza'
    case 'squash':
      return 'squash'
    case 'mobility':
      return 'movilidad'
    case 'mixed':
      return 'día mixto'
    default:
      return 'sin sesión'
  }
}

function getNutritionTimingLabel(
  sport: ReturnType<typeof getDayNutrition>['sport'],
  dayType: ReturnType<typeof getDayNutrition>['dayType'],
  timing: 'pre' | 'post',
): string {
  if (dayType === 'competition' && sport === 'squash') {
    return timing === 'pre' ? 'Antes del partido' : 'Después del partido'
  }

  switch (sport) {
    case 'running':
      return timing === 'pre' ? 'Antes de correr' : 'Después de correr'
    case 'cycling':
      return timing === 'pre' ? 'Antes de pedalear' : 'Después de pedalear'
    case 'strength':
      return timing === 'pre' ? 'Antes de fuerza' : 'Después de fuerza'
    case 'squash':
      return timing === 'pre' ? 'Antes de la sesión' : 'Después de la sesión'
    case 'mixed':
      return timing === 'pre' ? 'Antes del bloque' : 'Después del bloque'
    default:
      return timing === 'pre' ? 'Antes' : 'Después'
  }
}

function ProtocolGuideCard({ label, protocol }: { label: string; protocol?: GeneratedProtocol }) {
  if (!protocol) return null

  const isWarmup = label.includes('Warm-up')
  const containerClass = isWarmup
    ? 'border-brand/20 bg-brand/5'
    : 'border-surface-soft/40 bg-surface-raised/60'
  const titleClass = isWarmup ? 'text-brand-light/80' : 'text-ink-muted'

  return (
    <div className={`rounded-xl border p-3 ${containerClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[10px] font-medium uppercase tracking-wider ${titleClass}`}>{label}</p>
        <span className="text-[11px] text-ink-faint">{protocol.durationMin} min</span>
      </div>
      <p className="mt-1 text-sm font-medium text-ink">{protocol.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{protocol.note}</p>
      <div className="mt-2 space-y-1">
        {protocol.steps.slice(0, 4).map((step, index) => (
          <p key={index} className="text-[11px] leading-relaxed text-ink-faint">
            · {step.label}
            {step.detail ? ` — ${step.detail}` : ''}
          </p>
        ))}
      </div>
    </div>
  )
}

function WhoopPrefillHint() {
  return (
    <span className="inline-flex w-fit rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
      desde Whoop
    </span>
  )
}

export default function DayDetail() {
  const { date } = useParams<{ date: string }>()
  const { sessions, dayLogs, loadWeek, saveDayLog, updateSession } = useTrainingStore()
  const { athleteProfile } = useCoachMemoryStore()
  const activeAthleteFromStore = useAuthStore((state) => state.activeAthleteId)
  const { setCurrentWeekStart, setSelectedDate } = useUIStore()
  const hasValidDateParam = typeof date === 'string' && isStrictISODate(date)

  useEffect(() => {
    if (!date || !hasValidDateParam) return
    const weekStart = toISO(getWeekStart(fromISO(date)))
    setCurrentWeekStart(weekStart)
    setSelectedDate(date)
    loadWeek(weekStart)
  }, [date, hasValidDateParam, loadWeek, setCurrentWeekStart, setSelectedDate])

  const dateISO = hasValidDateParam && date ? date : ''
  const daySessions = sessions
    .filter(s => s.date === dateISO)
    .sort((a, b) => a.timeBlock.localeCompare(b.timeBlock))
  const amSessions = daySessions.filter(s => s.timeBlock === 'AM')
  const pmSessions = daySessions.filter(s => s.timeBlock === 'PM')
  const completedSessions = daySessions.filter(session => session.status === 'completed')
  const dayLog = dayLogs[dateISO]
  const activeAthleteId = activeAthleteFromStore ?? getActiveAthleteId()
  const selfAthleteId = getSelfAthleteId()
  const [readiness, setReadiness] = useState<ReadinessDaily | undefined>(undefined)
  const prefill = useMemo(() => prefillDayLog(dayLog ?? {}, readiness), [dayLog, readiness])
  const activePrefillSource = useMemo(
    () => ({
      ...prefill.prefillSource,
      ...(dayLog?.prefillSource ?? {}),
    }),
    [dayLog?.prefillSource, prefill.prefillSource],
  )
  const energyValue = dayLog?.energyLevel ?? prefill.patch.energyLevel
  const sleepQualityValue = dayLog?.sleepQuality ?? prefill.patch.sleepQuality
  const sleepHoursValue = dayLog?.sleepHours ?? prefill.patch.sleepHours

  useEffect(() => {
    let cancelled = false

    async function loadReadiness() {
      if (!activeAthleteId || !dateISO) {
        if (!cancelled) setReadiness(undefined)
        return
      }

      await pullReadiness().catch(() => undefined)
      const nextReadiness = await getLocalReadinessForDate(activeAthleteId, dateISO)
      if (!cancelled) setReadiness(nextReadiness)
    }

    void loadReadiness()

    return () => {
      cancelled = true
    }
  }, [activeAthleteId, dateISO])

  useEffect(() => {
    if (!dateISO || !hasDayLogPrefillPatch(prefill)) return
    if (!canAutoPersistWhoopPrefill({
      date: dateISO,
      today: todayISO(),
      activeAthleteId,
      selfAthleteId,
      readinessAthleteId: readiness?.athleteId,
    })) return

    void saveDayLog(dateISO, buildWhoopPrefillSavePatch(prefill, dayLog))
  }, [activeAthleteId, dateISO, dayLog, prefill, readiness?.athleteId, saveDayLog, selfAthleteId])

  const save = async (
    patch: Parameters<typeof saveDayLog>[1],
    editedPrefillFields: PrefillField[] = [],
  ) => {
    if (!dateISO) return
    const patchWithPrefill = buildDayLogSavePatch(patch, dayLog, editedPrefillFields)

    await saveDayLog(dateISO, patchWithPrefill)

    if (completedSessions.length === 1 && 'postSessionComment' in patch) {
      await updateSession(completedSessions[0].id, { completionNotes: patch.postSessionComment })
    }
  }

  const saveSessionActualRpe = async (sessionId: string, actualRpe: number) => {
    await updateSession(sessionId, { actualRpe })
  }

  const isToday = dateISO ? isDateToday(dateISO) : false
  const completedCount = completedSessions.length

  if (!hasValidDateParam) {
    return (
      <div>
        <PageHeader
          title="Día inválido"
          subtitle="La fecha de esta ruta no es válida"
          backTo={ROUTES.WEEK}
        />

        <div className="px-4 pb-8">
          <Card variant="panel" className="p-6 text-center">
            <p className="text-sm text-ink-muted">No pudimos abrir este día.</p>
            <p className="mt-1 text-xs text-ink-faint">Revisa la URL o vuelve a la vista semanal.</p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={dateISO ? formatFullDate(fromISO(dateISO)) : 'Día'}
        subtitle={isToday ? 'Hoy' : undefined}
        backTo={ROUTES.WEEK}
      />

      <div className="px-4 space-y-5 pb-8">
        {daySessions.length > 0 && (
          <Card variant="hud" accent="cyan" className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
                  Estado del día
                </p>
                <p className="mt-1 text-sm text-ink-muted">Resumen rápido de ejecución y recuperación.</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-semibold text-ink">
                  <span className="text-forge-cyan">{completedCount}</span>
                  <span className="text-ink-faint">/{daySessions.filter(s => s.status !== 'skipped').length}</span>
                </p>
                <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">completadas</p>
              </div>
            </div>
          </Card>
        )}

        {daySessions.length === 0 ? (
          <Card variant="panel" className="p-6 text-center">
            <p className="text-ink-muted text-sm">Sin sesiones este día</p>
            <p className="text-ink-faint text-xs mt-1">Día libre o de descanso</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {amSessions.length > 0 && (
              <Card variant="panel" className="p-4">
                <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Mañana</p>
                <div className="space-y-2">
                  {amSessions.map((s) => {
                    const protocols = resolveSessionProtocols(s, { dayLog, recentSessions: sessions })
                    return (
                      <div key={s.id} className="space-y-2">
                        <SessionCard session={s} />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ProtocolGuideCard label="Warm-up recomendado" protocol={protocols.warmup} />
                          <ProtocolGuideCard label="Cooldown recomendado" protocol={protocols.cooldown} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
            {pmSessions.length > 0 && (
              <Card variant="panel" className="p-4">
                <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Tarde</p>
                <div className="space-y-2">
                  {pmSessions.map((s) => {
                    const protocols = resolveSessionProtocols(s, { dayLog, recentSessions: sessions })
                    return (
                      <div key={s.id} className="space-y-2">
                        <SessionCard session={s} />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ProtocolGuideCard label="Warm-up recomendado" protocol={protocols.warmup} />
                          <ProtocolGuideCard label="Cooldown recomendado" protocol={protocols.cooldown} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        <DayNutritionCard sessions={daySessions} profile={athleteProfile} dayLog={dayLog} />

        <Card variant="hud" accent="lime" className="p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">RPE por sesión</h2>
            <p className="text-xs text-ink-muted mt-1">
              Registra el esfuerzo real de cada sesión completada. Esto alimenta las métricas semanales.
            </p>
          </div>

          {completedSessions.length === 0 ? (
            <p className="text-sm text-ink-faint">Aún no hay sesiones completadas este día.</p>
          ) : (
            <div className="space-y-4">
              {completedSessions.map(session => {
                const value = session.actualRpe ?? (
                  completedSessions.length === 1 ? dayLog?.rpeActual : undefined
                )

                return (
                  <div key={session.id} className="rounded-xl border border-surface-border bg-surface-raised/80 p-3">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-sm font-medium text-ink">{session.title}</p>
                        <p className="text-xs text-ink-muted mt-0.5">
                          {session.timeBlock} · {session.type}
                        </p>
                      </div>
                      {session.rpe != null && (
                        <span className="text-[11px] text-ink-faint">Planificado {session.rpe}/10</span>
                      )}
                    </div>

                    <Slider
                      label="RPE real de la sesión"
                      value={value}
                      min={1}
                      max={10}
                      onChange={v => saveSessionActualRpe(session.id, v)}
                      formatValue={v => `${v}/10`}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card variant="hud" accent="ember" className="p-4 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Feedback del día</h2>

          <div className="space-y-1">
            <Slider
              label="Energía general"
              value={energyValue}
              min={1}
              max={10}
              onChange={v => save({ energyLevel: v }, ['energyLevel'])}
              formatValue={v => `${v}/10`}
            />
            {activePrefillSource.energyLevel && <WhoopPrefillHint />}
          </div>

          <Slider
            label="Dolor / molestia"
            value={dayLog?.painLevel}
            min={0}
            max={10}
            onChange={v => save({ painLevel: v })}
            formatValue={v => v === 0 ? 'Sin dolor' : `${v}/10`}
            accentClass="accent-rose-500"
          />

          {completedSessions.length === 1 && dayLog?.rpeActual != null && (
            <p className="text-xs text-ink-faint">
              El RPE diario previo se usa como valor inicial de la sesión si solo hubo una sesión completada.
            </p>
          )}

          <DayFeedbackFields
            key={`${dateISO}-${dayLog?.updatedAt ?? 'empty'}-${dayLog?.painLevel ?? 'none'}-${dayLog?.painNotes ?? ''}-${dayLog?.postSessionComment ?? ''}`}
            dayLog={dayLog}
            onSave={patch => void save(patch)}
          />
        </Card>

        <Card variant="hud" accent="cyan" className="p-4 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Sueño y recuperación</h2>

          <div className="space-y-1">
            <Slider
              label="Calidad de sueño"
              value={sleepQualityValue}
              min={1}
              max={5}
              step={1}
              onChange={v => save({ sleepQuality: v }, ['sleepQuality'])}
              formatValue={v => ['', 'Muy mal', 'Mal', 'Regular', 'Bien', 'Excelente'][v] ?? String(v)}
            />
            {activePrefillSource.sleepQuality && <WhoopPrefillHint />}
          </div>

          <DayRecoveryNotes
            key={`${dateISO}-${dayLog?.updatedAt ?? 'empty'}-${dayLog?.generalNotes ?? ''}-${sleepHoursValue ?? 'none'}-${activePrefillSource.sleepHours ?? 'manual'}`}
            dayLog={dayLog}
            sleepHoursValue={sleepHoursValue}
            sleepHoursFromWhoop={activePrefillSource.sleepHours === 'whoop'}
            onSave={(patch, editedPrefillFields) => void save(patch, editedPrefillFields)}
          />
        </Card>
      </div>
    </div>
  )
}
