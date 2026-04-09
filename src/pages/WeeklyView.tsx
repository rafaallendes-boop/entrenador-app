import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Plus, FileUp, Sparkles, MessageSquareText } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { computeLoadAnalytics, type LoadAnalytics } from '../services/loadAnalytics'
import { formatFullDate, fromISO, getWeekDays, toISO, isDateToday, todayISO } from '../utils/date'
import WeekStrip from '../components/week/WeekStrip'
import WeekSummaryCard from '../components/week/WeekSummaryCard'
import MacroPhaseSummaryCard from '../components/week/MacroPhaseSummaryCard'
import SessionCard from '../components/session/SessionCard'
import AddSessionModal from '../components/session/AddSessionModal'
import { ROUTES } from '../constants/routes'
import type { TimeBlock, WeeklyActionItem } from '../types'
import { downloadICS } from '../utils/ics'
import { buildMacroWeekCoherenceSummary } from '../services/macroWeekCoherence'
import { buildWeeklyActionSummary } from '../services/weeklyActionLoop'

const DailyCheckInCard = lazy(() => import('../components/dashboard/DailyCheckInCard'))
const WeeklyActionCenterCard = lazy(() => import('../components/week/WeeklyActionCenterCard'))

export default function WeeklyView() {
  const { sessions, currentWeekSummary, dayLogs, isLoading, loadedWeekStart, loadWeek, generateCoachNote, deleteSession } = useTrainingStore()
  const { currentWeekStart, selectedDate, setSelectedDate, setCurrentWeekStart } = useUIStore()
  const athleteProfile = useCoachMemoryStore((state) => state.athleteProfile)
  const [showAddModal, setShowAddModal] = useState(false)
  const [isGeneratingNote, setIsGeneratingNote] = useState(false)
  const [checkInExpandToken, setCheckInExpandToken] = useState(0)
  const [loadAnalytics, setLoadAnalytics] = useState<LoadAnalytics | null>(null)

  useEffect(() => {
    loadWeek(currentWeekStart)
  }, [currentWeekStart, loadWeek])

  useEffect(() => {
    void computeLoadAnalytics(4).then(setLoadAnalytics)
  }, [currentWeekStart, sessions])

  const navigate = useNavigate()
  const weekDays = getWeekDays(fromISO(currentWeekStart))
  const today = todayISO()

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
  const macroWeekCoherence = useMemo(() => buildMacroWeekCoherenceSummary({
    athleteProfile,
    sessions,
    historicalSessions: sessions.filter((session) => session.status === 'completed' || session.status === 'adjusted'),
  }), [athleteProfile, sessions])
  const weeklyActionSummary = useMemo(() => buildWeeklyActionSummary({
    sessions,
    currentWeekSummary,
    todayDayLog: dayLogs[today],
    macroWeekCoherence,
    loadAnalytics,
    today,
  }), [sessions, currentWeekSummary, dayLogs, today, macroWeekCoherence, loadAnalytics])
  const todaySessions = sessions.filter((session) => session.date === today)

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

  const handleDeleteCoachSession = async (sessionId: string) => {
    const confirmed = window.confirm('Esta sesion del coach se eliminara solo para esta semana. Esta accion no se puede deshacer.')
    if (!confirmed) return
    await deleteSession(sessionId)
  }

  const handleSelectWeeklyAction = (action: WeeklyActionItem) => {
    if (action.ctaTarget === 'plan_builder') {
      navigate(ROUTES.PLAN_BUILDER)
      return
    }

    if (action.ctaTarget === 'chat_adjust_week') {
      const composerDraft =
        action.kind === 'fix_coherence'
          ? `Ajusta mi semana para respetar esta regla del bloque: ${macroWeekCoherence.weeklyRule}`
          : action.kind === 'recover_adherence'
            ? 'Revisa mi adherencia semanal y propon un ajuste concreto para que la semana sea mas realista.'
            : 'Simplifica o ajusta mi semana segun la carga y la fatiga de estos dias.'
      navigate(ROUTES.CHAT, { state: { composerDraft } })
      return
    }

    if (action.ctaTarget === 'generate_coach_note') {
      void handleGenerateCoachNote()
      return
    }

    if (action.ctaTarget === 'today_detail') {
      navigate(ROUTES.DAY(today))
      return
    }

    setCurrentWeekStart(today)
    setSelectedDate(today)
    setCheckInExpandToken((value) => value + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="pb-6 md:pb-8">
      <div className="pt-12 px-4 pb-2 flex flex-col gap-3 md:px-6 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-bold text-ink md:text-2xl">Semana</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {isWeekEmpty && weeklyActionSummary.primaryAction?.kind === 'plan_week' ? (
            <button
              onClick={() => navigate(ROUTES.PLAN_BUILDER)}
              title="Abrir creador de plan"
              className="flex items-center gap-1.5 text-xs text-white px-4 py-2 rounded-lg bg-brand hover:bg-brand-light transition-colors active:scale-95 font-medium"
            >
              <Sparkles size={14} />
              <span>Plan Builder</span>
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
                        <SessionCard
                          key={session.id}
                          session={session}
                          onDelete={session.source === 'coach' ? (current) => void handleDeleteCoachSession(current.id) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {selectedDayData.pmSessions.length > 0 && (
                  <div>
                    <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">Tarde</p>
                    <div className="space-y-2">
                      {selectedDayData.pmSessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          onDelete={session.source === 'coach' ? (current) => void handleDeleteCoachSession(current.id) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Resumen semanal</p>
            {currentWeekSummary && (
              <button
                onClick={handleGenerateCoachNote}
                disabled={isGeneratingNote}
                className="inline-flex items-center gap-1.5 text-[11px] text-brand-light font-medium px-3 py-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <MessageSquareText size={13} />
                {isGeneratingNote ? 'Generando...' : currentWeekSummary.coachNote ? 'Regenerar coach note' : 'Generar coach note'}
              </button>
            )}
          </div>
          <div className="space-y-3">
            <Suspense fallback={<div className="h-48 rounded-card border border-surface-border bg-surface-card animate-pulse" />}>
              <WeeklyActionCenterCard summary={weeklyActionSummary} onSelectAction={handleSelectWeeklyAction} />
            </Suspense>
            <Suspense fallback={<div className="h-28 rounded-card border border-surface-border bg-surface-card animate-pulse" />}>
              <DailyCheckInCard todaySessions={todaySessions} autoExpandToken={checkInExpandToken} />
            </Suspense>
            <MacroPhaseSummaryCard summary={macroWeekCoherence} />
            {currentWeekSummary && <WeekSummaryCard summary={currentWeekSummary} />}
          </div>
        </div>
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
