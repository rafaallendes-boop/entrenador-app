import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Download, Plus, FileUp, Sparkles, MessageSquareText } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useUIStore } from '../store/useUIStore'

import { formatFullDate, fromISO, getWeekDays, getWeekStart, toISO, isDateToday, todayISO } from '../utils/date'
import WeekStrip from '../components/week/WeekStrip'
import WeekSummaryCard from '../components/week/WeekSummaryCard'
import MacroPhaseSummaryCard from '../components/week/MacroPhaseSummaryCard'
import SessionCard from '../components/session/SessionCard'
import AddSessionModal from '../components/session/AddSessionModal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Card from '../components/ui/Card'
import { ROUTES } from '../constants/routes'
import type { CoachProposal, TimeBlock } from '../types'
import { downloadICS } from '../utils/ics'
import { useMacroWeekCoherence } from '../hooks/useMacroWeekCoherence'
import { useWeeklyActionNavigator } from '../hooks/useWeeklyActionNavigator'
import { useWeeklySnapshot } from '../hooks/useWeeklySnapshot'
import { useWeeklyLaunchIntent } from '../hooks/useWeeklyLaunchIntent'
import {
  buildWeeklyActionComposerDraft,
  serializeWeeklyActionLaunchIntent,
} from '../services/weeklyLaunchIntent'

const DailyCheckInCard = lazy(() => import('../components/dashboard/DailyCheckInCard'))
const WeeklyActionCenterCard = lazy(() => import('../components/week/WeeklyActionCenterCard'))
const ProposalDrawer = lazy(() => import('../components/chat/ProposalDrawer'))

export default function WeeklyView() {
  const { sessions, currentWeekSummary, dayLogs, isLoading, loadedWeekStart, loadWeek, generateCoachNote, deleteSession } = useTrainingStore()
  const { addProposal, acceptProposal, rejectProposal } = useCoachActionsStore()
  const { athleteProfile } = useCoachMemoryStore()
  const { currentWeekStart, selectedDate, setSelectedDate, setCurrentWeekStart } = useUIStore()

  const [showAddModal, setShowAddModal] = useState(false)
  const [isGeneratingNote, setIsGeneratingNote] = useState(false)
  const [coachNoteError, setCoachNoteError] = useState<string | null>(null)
  const [checkInExpandToken, setCheckInExpandToken] = useState(0)
  const [pendingCoachDeleteId, setPendingCoachDeleteId] = useState<string | null>(null)
  const [activeProposal, setActiveProposal] = useState<CoachProposal | null>(null)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const { launchIntent, launchId } = useWeeklyLaunchIntent()
  const handledLaunchIntentKeyRef = useRef<string | null>(null)

  useEffect(() => {
    loadWeek(currentWeekStart)
  }, [currentWeekStart, loadWeek])

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
  const macroWeekCoherence = useMacroWeekCoherence()
  const handleSelectWeeklyAction = useWeeklyActionNavigator({
    weeklyRule: macroWeekCoherence.weeklyRule,
    onGenerateCoachNote: () => { void handleGenerateCoachNote() },
    onCheckIn: () => {
      setCurrentWeekStart(today)
      setSelectedDate(today)
      setCheckInExpandToken((value) => value + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  })
  const {
    weeklyActionSummary,
    autoAdjustmentDraft,
  } = useWeeklySnapshot(currentWeekStart, {
    sessions,
    currentWeekSummary,
    todayDayLog: dayLogs[today],
    macroWeekCoherence,
    athleteProfile,
    today,
  })
  const todaySessions = sessions.filter((session) => session.date === today)

  const handleExport = () => {
    downloadICS(sessions, `entrenador-${currentWeekStart}.ics`)
  }

  const handleGenerateCoachNote = useCallback(async () => {
    if (isGeneratingNote) return
    setCoachNoteError(null)
    setIsGeneratingNote(true)
    try {
      await generateCoachNote(currentWeekStart)
    } catch (error) {
      console.error('[weekly] generate coach note failed', error)
      setCoachNoteError(formatCoachNoteError(error))
    } finally {
      setIsGeneratingNote(false)
    }
  }, [currentWeekStart, generateCoachNote, isGeneratingNote])

  const handleConfirmDeleteCoachSession = async () => {
    if (!pendingCoachDeleteId) return
    await deleteSession(pendingCoachDeleteId)
    setPendingCoachDeleteId(null)
  }

  const handleOpenAutoAdjustment = useCallback(async () => {
    if (!autoAdjustmentDraft) return
    setProposalError(null)
    const proposal = await addProposal(
      autoAdjustmentDraft.message,
      autoAdjustmentDraft.actions,
      undefined,
      { source: 'weekly_action', relatedAlertId: autoAdjustmentDraft.alertId },
    )
    setActiveProposal(proposal)
  }, [addProposal, autoAdjustmentDraft])

  const handleAcceptAutoAdjustment = async () => {
    if (!activeProposal) return
    const result = await acceptProposal(activeProposal.id)
    if (result.errors.length > 0) {
      setProposalError(result.errors.join(' '))
      return
    }
    setProposalError(null)
    setActiveProposal(null)
  }

  const handleCloseAutoAdjustment = () => {
    if (activeProposal && activeProposal.status === 'pending') {
      void rejectProposal(activeProposal.id)
    }
    setProposalError(null)
    setActiveProposal(null)
  }

  useEffect(() => {
    if (!launchIntent) return

    const key = serializeWeeklyActionLaunchIntent(launchIntent)
    if (handledLaunchIntentKeyRef.current === `${launchId}:${key}`) return

    if (launchIntent.intent === 'plan_builder') {
      handledLaunchIntentKeyRef.current = `${launchId}:${key}`
      navigate(ROUTES.PLAN_BUILDER, { replace: true })
      return
    }

    if (launchIntent.intent === 'chat_adjust_week') {
      handledLaunchIntentKeyRef.current = `${launchId}:${key}`
      navigate(ROUTES.CHAT, {
        replace: true,
        state: { composerDraft: buildWeeklyActionComposerDraft(launchIntent) },
      })
      return
    }

    if (launchIntent.intent === 'today_checkin') {
      handledLaunchIntentKeyRef.current = `${launchId}:${key}`
      const targetDate = launchIntent.date ?? today
      setCurrentWeekStart(toISO(getWeekStart(fromISO(targetDate))))
      setSelectedDate(targetDate)
      setCheckInExpandToken((value) => value + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (launchIntent.intent === 'generate_coach_note') {
      if (!weekLoaded) return
      handledLaunchIntentKeyRef.current = `${launchId}:${key}`
      void handleGenerateCoachNote()
      return
    }

    if (launchIntent.intent === 'open_auto_adjustment') {
      if (!weekLoaded) return
      if (autoAdjustmentDraft) {
        handledLaunchIntentKeyRef.current = `${launchId}:${key}`
        void handleOpenAutoAdjustment()
        return
      }

      handledLaunchIntentKeyRef.current = `${launchId}:${key}`
      navigate(ROUTES.CHAT, {
        replace: true,
        state: {
          composerDraft: buildWeeklyActionComposerDraft({
            intent: 'chat_adjust_week',
            weeklyRule: launchIntent.weeklyRule,
          }),
        },
      })
    }
  }, [
    autoAdjustmentDraft,
    handleGenerateCoachNote,
    handleOpenAutoAdjustment,
    launchIntent,
    navigate,
    setCurrentWeekStart,
    setSelectedDate,
    today,
    launchId,
    weekLoaded,
  ])

  return (
    <div className="pb-6 md:pb-8">
      <div className="pt-12 px-4 pb-2 flex flex-col gap-3 md:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.24em] text-ink-faint">
            Weekly planner
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">Semana</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isWeekEmpty && weeklyActionSummary.primaryAction?.kind === 'plan_week' ? (
            <button
              onClick={() => navigate(ROUTES.PLAN_BUILDER)}
              title="Abrir creador de plan"
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-medium text-white transition-colors active:scale-95 hover:bg-brand-light"
            >
              <Sparkles size={14} />
              <span>Plan Builder</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate(ROUTES.IMPORT)}
                title="Importar planificación desde PDF"
                className="flex items-center gap-1.5 rounded-lg border border-surface-soft/80 bg-surface-panel px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-brand/30 hover:text-ink"
              >
                <FileUp size={13} />
                <span>PDF</span>
              </button>
              <button
                onClick={handleExport}
                title="Exportar semana a calendario"
                className="flex items-center gap-1.5 rounded-lg border border-surface-soft/80 bg-surface-panel px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-brand/30 hover:text-ink"
              >
                <Download size={13} />
                <span>Exportar</span>
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                title="Agregar sesión"
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs text-white transition-colors active:scale-95 hover:bg-brand-light"
              >
                <Plus size={13} />
                <span>Agregar</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mx-4 mt-4 rounded-[1.6rem] border border-surface-soft/70 bg-[linear-gradient(145deg,rgba(26,26,26,0.96),rgba(14,14,14,0.98))] shadow-panel md:mx-6">
        <WeekStrip showNav={true} />
      </div>

      <div className="px-4 mt-2 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-start md:px-6">
        {selectedDayData && (
          <div className="min-w-0">
            <Card variant="hud" accent="ember" className="mb-4 bg-[linear-gradient(145deg,rgba(26,26,26,0.96),rgba(14,14,14,0.98))] p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
                    Foco del día
                  </p>
                  <h2 className="font-display text-lg font-bold capitalize tracking-tight text-ink md:text-xl">
                    {formatFullDate(selectedDayData.day)}
                  </h2>
                  {isDateToday(selectedDayData.iso) && (
                    <span className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-light">Hoy</span>
                  )}
                </div>
                <button
                  onClick={() => navigate(ROUTES.DAY(selectedDayData.iso))}
                  className="whitespace-nowrap rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand-light transition-colors hover:bg-brand/15"
                >
                  Ver día completo
                </button>
              </div>
            </Card>

            {selectedDayData.amSessions.length === 0 && selectedDayData.pmSessions.length === 0 ? (
              <Card variant="panel" className="border-dashed py-10 text-center">
                <p className="font-mono text-2xl text-ink-faint/30">○</p>
                <p className="mt-2 text-sm font-medium text-ink-muted">Día libre</p>
                <p className="mt-0.5 text-xs text-ink-faint">Sin sesiones planificadas</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {selectedDayData.amSessions.length > 0 && (
                  <Card variant="panel" className="p-4">
                    <p className="font-display mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-faint">Mañana</p>
                    <div className="space-y-2">
                      {selectedDayData.amSessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          onDelete={session.source === 'coach' ? (current) => setPendingCoachDeleteId(current.id) : undefined}
                        />
                      ))}
                    </div>
                  </Card>
                )}
                {selectedDayData.pmSessions.length > 0 && (
                  <Card variant="panel" className="p-4">
                    <p className="font-display mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-faint">Tarde</p>
                    <div className="space-y-2">
                      {selectedDayData.pmSessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          onDelete={session.source === 'coach' ? (current) => setPendingCoachDeleteId(current.id) : undefined}
                        />
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="font-display text-sm font-semibold uppercase tracking-wider text-ink-muted">Resumen semanal</p>
            {currentWeekSummary && (
              <button
                type="button"
                onClick={handleGenerateCoachNote}
                disabled={isGeneratingNote}
                aria-busy={isGeneratingNote}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-3 py-1.5 text-[11px] font-medium text-brand-light transition-colors disabled:cursor-not-allowed disabled:opacity-60 hover:bg-brand/15"
              >
                <MessageSquareText size={13} />
                {isGeneratingNote ? 'Preparando nota...' : currentWeekSummary.coachNote ? 'Actualizar nota' : 'Generar nota'}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {coachNoteError && (
              <Card variant="panel" className="border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{coachNoteError}</span>
                </div>
              </Card>
            )}
            {proposalError && (
              <Card variant="panel" className="border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {proposalError}
              </Card>
            )}
            <Suspense fallback={<div className="h-48 rounded-card border border-surface-border bg-surface-card animate-pulse" />}>
              <WeeklyActionCenterCard
                summary={weeklyActionSummary}
                onSelectAction={handleSelectWeeklyAction}
                onOpenAutoAdjustment={autoAdjustmentDraft ? () => { void handleOpenAutoAdjustment() } : undefined}
              />
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

      <ConfirmDialog
        open={pendingCoachDeleteId != null}
        title="Eliminar sesion de RallyIQ"
        message="Esta sesion de RallyIQ se eliminara solo para esta semana. Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        onCancel={() => setPendingCoachDeleteId(null)}
        onConfirm={() => { void handleConfirmDeleteCoachSession() }}
      />

      {activeProposal && (
        <Suspense fallback={null}>
          <ProposalDrawer
            proposal={activeProposal}
            existingSessions={sessions}
            onAccept={() => { void handleAcceptAutoAdjustment() }}
            onReject={handleCloseAutoAdjustment}
            onClose={handleCloseAutoAdjustment}
          />
        </Suspense>
      )}
    </div>
  )
}

function formatCoachNoteError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `No pude generar la nota: ${error.message}`
  }
  return 'No pude generar la nota. Intenta nuevamente.'
}
