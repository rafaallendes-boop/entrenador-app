import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Plus, FileUp, Sparkles, MessageSquareText } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { formatFullDate, fromISO, getWeekDays, toISO, isDateToday } from '../utils/date'
import WeekStrip from '../components/week/WeekStrip'
import WeekSummaryCard from '../components/week/WeekSummaryCard'
import SessionCard from '../components/session/SessionCard'
import AddSessionModal from '../components/session/AddSessionModal'
import { ROUTES } from '../constants/routes'
import type { TimeBlock } from '../types'
import { downloadICS } from '../utils/ics'

export default function WeeklyView() {
  const { sessions, currentWeekSummary, isLoading, loadedWeekStart, loadWeek, generateCoachNote } = useTrainingStore()
  const { currentWeekStart, selectedDate } = useUIStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [isGeneratingNote, setIsGeneratingNote] = useState(false)

  useEffect(() => {
    loadWeek(currentWeekStart)
  }, [currentWeekStart, loadWeek])

  const navigate = useNavigate()
  const weekDays = getWeekDays(fromISO(currentWeekStart))

  const getSessionsForDay = (dateISO: string, block?: TimeBlock) =>
    sessions
      .filter((session) => session.date === dateISO && (!block || session.timeBlock === block))
      .sort((a, b) => a.timeBlock.localeCompare(b.timeBlock))

  const dayData = weekDays.map((day) => {
    const iso = toISO(day)
    return {
      iso,
      day,
      amSessions: getSessionsForDay(iso, 'AM'),
      pmSessions: getSessionsForDay(iso, 'PM'),
    }
  })

  const selectedDayData = dayData.find((day) => day.iso === selectedDate) ?? dayData[0]
  const weekLoaded = loadedWeekStart === currentWeekStart && !isLoading
  const isWeekEmpty = weekLoaded && sessions.length === 0

  const handleExport = () => {
    downloadICS(sessions, `entrenador-${currentWeekStart}.ics`)
  }

  const handleGenerateCoachNote = async () => {
    setIsGeneratingNote(true)
    try {
      await generateCoachNote(currentWeekStart)
    } finally {
      setIsGeneratingNote(false)
    }
  }

  return (
    <div className="pb-6 md:pb-8">
      <div className="pt-12 px-4 pb-2 flex flex-col gap-3 md:px-6 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-bold text-ink md:text-2xl">Semana</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {isWeekEmpty ? (
            <button
              onClick={() => navigate(ROUTES.CHAT)}
              title="Pedir al coach que cree tu semana"
              className="flex items-center gap-1.5 text-xs text-white px-4 py-2 rounded-lg bg-brand hover:bg-brand-light transition-colors active:scale-95 font-medium"
            >
              <Sparkles size={14} />
              <span>Crear semana</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate(ROUTES.IMPORT)}
                title="Importar planificación desde PDF"
                className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink px-3 py-1.5 rounded-lg bg-surface-raised border border-surface-border hover:border-brand/40 transition-colors"
              >
                <FileUp size={13} />
                <span>PDF</span>
              </button>
              <button
                onClick={handleExport}
                title="Exportar semana a calendario"
                className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink px-3 py-1.5 rounded-lg bg-surface-raised border border-surface-border hover:border-brand/40 transition-colors"
              >
                <Download size={13} />
                <span>Exportar</span>
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                title="Agregar sesión"
                className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-light transition-colors active:scale-95"
              >
                <Plus size={13} />
                <span>Agregar</span>
              </button>
            </>
          )}
        </div>
      </div>

      <WeekStrip showNav={true} />

      <div className="px-4 mt-2 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-start md:px-6">
        {selectedDayData && (
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold text-ink capitalize md:text-lg">
                  {formatFullDate(selectedDayData.day)}
                </h2>
                {isDateToday(selectedDayData.iso) && (
                  <span className="text-xs text-brand-light font-medium">Hoy</span>
                )}
              </div>
              <button
                onClick={() => navigate(ROUTES.DAY(selectedDayData.iso))}
                className="text-xs text-brand-light font-medium px-3 py-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 transition-colors whitespace-nowrap"
              >
                Ver día completo
              </button>
            </div>

            {selectedDayData.amSessions.length === 0 && selectedDayData.pmSessions.length === 0 ? (
              <div className="py-8 text-center rounded-2xl bg-surface-card border border-surface-border">
                <p className="text-ink-faint text-sm">Sin sesiones planificadas</p>
                <p className="text-ink-faint text-xs mt-1">Día libre o de descanso</p>
              </div>
            ) : (
              <div className="space-y-4">
                {selectedDayData.amSessions.length > 0 && (
                  <div>
                    <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Mañana</p>
                    <div className="space-y-2">
                      {selectedDayData.amSessions.map((session) => (
                        <SessionCard key={session.id} session={session} />
                      ))}
                    </div>
                  </div>
                )}
                {selectedDayData.pmSessions.length > 0 && (
                  <div>
                    <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Tarde</p>
                    <div className="space-y-2">
                      {selectedDayData.pmSessions.map((session) => (
                        <SessionCard key={session.id} session={session} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {currentWeekSummary && (
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Resumen semanal</p>
              <button
                onClick={handleGenerateCoachNote}
                disabled={isGeneratingNote}
                className="inline-flex items-center gap-1.5 text-[11px] text-brand-light font-medium px-3 py-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <MessageSquareText size={13} />
                {isGeneratingNote ? 'Generando...' : currentWeekSummary.coachNote ? 'Regenerar coach note' : 'Generar coach note'}
              </button>
            </div>
            <WeekSummaryCard summary={currentWeekSummary} />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="px-4 py-4 text-center text-sm text-ink-muted md:px-6">Cargando...</div>
      )}

      {showAddModal && (
        <AddSessionModal
          defaultDate={selectedDayData?.iso}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
