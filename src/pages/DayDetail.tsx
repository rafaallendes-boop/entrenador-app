import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { formatFullDate, fromISO, isDateToday, toISO, getWeekStart } from '../utils/date'
import PageHeader from '../components/layout/PageHeader'
import SessionCard from '../components/session/SessionCard'
import Slider from '../components/ui/Slider'
import Card from '../components/ui/Card'
import { ROUTES } from '../constants/routes'

export default function DayDetail() {
  const { date } = useParams<{ date: string }>()
  const { sessions, dayLogs, loadWeek, saveDayLog, updateSession } = useTrainingStore()
  const { setCurrentWeekStart, setSelectedDate } = useUIStore()

  useEffect(() => {
    if (!date) return
    const weekStart = toISO(getWeekStart(fromISO(date)))
    setCurrentWeekStart(weekStart)
    setSelectedDate(date)
    loadWeek(weekStart)
  }, [date, loadWeek, setCurrentWeekStart, setSelectedDate])

  const dateISO = date ?? ''
  const daySessions = sessions
    .filter(s => s.date === dateISO)
    .sort((a, b) => a.timeBlock.localeCompare(b.timeBlock))
  const amSessions = daySessions.filter(s => s.timeBlock === 'AM')
  const pmSessions = daySessions.filter(s => s.timeBlock === 'PM')
  const completedSessions = daySessions.filter(session => session.status === 'completed')
  const dayLog = dayLogs[dateISO]

  const [notes, setNotes] = useState('')
  const [painNotes, setPainNotes] = useState('')
  const [postComment, setPostComment] = useState('')

  useEffect(() => {
    setNotes(dayLog?.generalNotes ?? '')
    setPainNotes(dayLog?.painNotes ?? '')
    setPostComment(dayLog?.postSessionComment ?? '')
  }, [dayLog?.generalNotes, dayLog?.painNotes, dayLog?.postSessionComment, dayLog?.updatedAt])

  const save = async (patch: Parameters<typeof saveDayLog>[1]) => {
    if (!dateISO) return
    await saveDayLog(dateISO, patch)

    if (completedSessions.length === 1 && 'postSessionComment' in patch) {
      await updateSession(completedSessions[0].id, { completionNotes: patch.postSessionComment })
    }
  }

  const saveSessionActualRpe = async (sessionId: string, actualRpe: number) => {
    await updateSession(sessionId, { actualRpe })
  }

  const isToday = dateISO ? isDateToday(dateISO) : false
  const completedCount = completedSessions.length

  return (
    <div>
      <PageHeader
        title={dateISO ? formatFullDate(fromISO(dateISO)) : 'Día'}
        subtitle={isToday ? 'Hoy' : undefined}
        backTo={ROUTES.WEEK}
      />

      <div className="px-4 space-y-5 pb-8">
        {daySessions.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="text-emerald-400 font-semibold">{completedCount}</span>
            <span>de {daySessions.filter(s => s.status !== 'skipped').length} sesiones completadas</span>
          </div>
        )}

        {daySessions.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-ink-muted text-sm">Sin sesiones este día</p>
            <p className="text-ink-faint text-xs mt-1">Día libre o de descanso</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {amSessions.length > 0 && (
              <div>
                <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Mañana</p>
                <div className="space-y-2">
                  {amSessions.map(s => <SessionCard key={s.id} session={s} />)}
                </div>
              </div>
            )}
            {pmSessions.length > 0 && (
              <div>
                <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Tarde</p>
                <div className="space-y-2">
                  {pmSessions.map(s => <SessionCard key={s.id} session={s} />)}
                </div>
              </div>
            )}
          </div>
        )}

        <Card className="p-4 space-y-4">
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
                  <div key={session.id} className="rounded-xl bg-surface-raised border border-surface-border p-3">
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

        <Card className="p-4 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Feedback del día</h2>

          <Slider
            label="Energía general"
            value={dayLog?.energyLevel}
            min={1}
            max={10}
            onChange={v => save({ energyLevel: v })}
            formatValue={v => `${v}/10`}
          />

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

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-muted">Comentario post-sesión</label>
            <textarea
              value={postComment}
              onChange={e => setPostComment(e.target.value)}
              onBlur={() => save({ postSessionComment: postComment || undefined })}
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
                onBlur={() => save({ painNotes: painNotes || undefined })}
                placeholder="Localización, tipo, intensidad..."
                rows={2}
                className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
              />
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Sueño y recuperación</h2>

          <Slider
            label="Calidad de sueño"
            value={dayLog?.sleepQuality}
            min={1}
            max={5}
            step={1}
            onChange={v => save({ sleepQuality: v })}
            formatValue={v => ['', 'Muy mal', 'Mal', 'Regular', 'Bien', 'Excelente'][v] ?? String(v)}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-sm text-ink-muted">Horas de sueño</label>
              <span className="text-sm font-semibold text-ink">
                {dayLog?.sleepHours != null ? `${dayLog.sleepHours}h` : '—'}
              </span>
            </div>
            <input
              type="number"
              min={0}
              max={12}
              step={0.5}
              value={dayLog?.sleepHours ?? ''}
              onChange={e => save({ sleepHours: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="ej: 7.5"
              className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint w-full focus:outline-none focus:border-brand/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-muted">Notas generales del día</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => save({ generalNotes: notes || undefined })}
              placeholder="Cómo fue el día en general..."
              rows={2}
              className="bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
