import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingDown, TrendingUp, Weight, Zap, Wind, Dumbbell, Trophy, Swords } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { formatWeekRange, formatShortDate, fromISO } from '../utils/date'
import WeekSummaryCard from '../components/week/WeekSummaryCard'
import { ROUTES } from '../constants/routes'
import { getMatchSessions } from '../db/queries'
import type { Session } from '../types'

type Tab = 'semanas' | 'partidos'

export default function History() {
  const { allWeekSummaries, loadAllSummaries } = useTrainingStore()
  const { setCurrentWeekStart, setSelectedDate } = useUIStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('semanas')
  const [matchSessions, setMatchSessions] = useState<Session[]>([])

  useEffect(() => {
    loadAllSummaries()
  }, [loadAllSummaries])

  useEffect(() => {
    if (tab === 'partidos') {
      getMatchSessions().then(setMatchSessions)
    }
  }, [tab])

  return (
    <div className="px-4 pt-12 pb-8 md:px-6">
      <h1 className="text-xl font-bold text-ink mb-4 md:text-2xl">Historial</h1>

      <div className="flex gap-2 mb-5 flex-wrap">
        <button
          onClick={() => setTab('semanas')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'semanas'
              ? 'bg-brand text-white'
              : 'bg-surface-card text-ink-muted hover:text-ink'
          }`}
        >
          Semanas
        </button>
        <button
          onClick={() => setTab('partidos')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'partidos'
              ? 'bg-brand text-white'
              : 'bg-surface-card text-ink-muted hover:text-ink'
          }`}
        >
          Partidos
        </button>
      </div>

      {tab === 'semanas' ? (
        <SemanasView
          allWeekSummaries={allWeekSummaries}
          onNavigate={(weekStart) => {
            setCurrentWeekStart(weekStart)
            setSelectedDate(weekStart)
            navigate(ROUTES.WEEK)
          }}
        />
      ) : (
        <PartidosView sessions={matchSessions} />
      )}
    </div>
  )
}

interface SemanasViewProps {
  allWeekSummaries: ReturnType<typeof useTrainingStore.getState>['allWeekSummaries']
  onNavigate: (weekStart: string) => void
}

function SemanasView({ allWeekSummaries, onNavigate }: SemanasViewProps) {
  if (allWeekSummaries.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-ink-faint text-sm">Sin historial aun</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 md:space-y-6">
      {allWeekSummaries.map((summary, index) => (
        <div key={summary.id}>
          <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink capitalize">
                {formatWeekRange(fromISO(summary.weekStartDate))}
              </p>
              <div className="flex gap-3 mt-1 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-yellow-400">
                  <Zap size={11} /> {summary.squashSessions}
                </span>
                <span className="flex items-center gap-1 text-xs text-sky-400">
                  <Wind size={11} /> {summary.runningSessions}
                </span>
                <span className="flex items-center gap-1 text-xs text-orange-400">
                  <Dumbbell size={11} /> {summary.strengthSessions}
                </span>
              </div>
            </div>
            <button
              onClick={() => onNavigate(summary.weekStartDate)}
              className="text-xs text-brand-light font-medium px-3 py-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 transition-colors whitespace-nowrap"
            >
              Ver semana
            </button>
          </div>

          <WeekSummaryCard summary={summary} showDisciplineAdherence />

          {summary.avgBodyWeight != null && (
            <div className="mt-2 px-1 flex items-center gap-2 flex-wrap text-xs">
              <span className="inline-flex items-center gap-1 text-cyan-400">
                <Weight size={12} />
                {summary.avgBodyWeight.toFixed(1)} kg promedio
              </span>
              {renderWeightDelta(summary.avgBodyWeight, allWeekSummaries[index + 1]?.avgBodyWeight)}
              {summary.weightEntries != null && summary.weightEntries > 0 && (
                <span className="text-ink-faint">
                  {summary.weightEntries} registro{summary.weightEntries !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {summary.weekNotes && (
            <p className="text-xs text-ink-muted mt-2 px-1 italic">
              {summary.weekNotes}
            </p>
          )}

          {summary.objectives && summary.objectives.length > 0 && (
            <div className="mt-2 px-1">
              <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-1">
                Objetivos
              </p>
              <ul className="space-y-0.5">
                {summary.objectives.map((objective, objectiveIndex) => (
                  <li key={objectiveIndex} className="flex items-start gap-2 text-xs text-ink-muted">
                    <span className="w-1 h-1 rounded-full bg-ink-faint mt-1.5 flex-shrink-0" />
                    {objective}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function renderWeightDelta(current?: number, previous?: number) {
  if (current == null || previous == null) return null

  const delta = current - previous
  if (Math.abs(delta) < 0.05) {
    return <span className="text-ink-faint">sin cambio relevante</span>
  }

  const rising = delta > 0
  const Icon = rising ? TrendingUp : TrendingDown
  const colorClass = rising ? 'text-amber-400' : 'text-emerald-400'

  return (
    <span className={`inline-flex items-center gap-1 ${colorClass}`}>
      <Icon size={12} />
      {`${rising ? '+' : ''}${delta.toFixed(1)} kg vs semana previa`}
    </span>
  )
}

function PartidosView({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <Swords size={28} className="text-ink-faint mx-auto mb-3" />
        <p className="text-ink-faint text-sm">Sin partidos registrados aun</p>
        <p className="text-ink-faint/60 text-xs mt-1">
          Registra sesiones de squash con subtipo partido o competitivo
        </p>
      </div>
    )
  }

  const withResult = sessions.filter((session) => session.matchResult != null)
  const wins = withResult.filter((session) => session.matchResult === 'win').length
  const losses = withResult.filter((session) => session.matchResult === 'loss').length
  const winratePct = withResult.length > 0 ? Math.round((wins / withResult.length) * 100) : null

  const rivalMap: Record<string, { total: number; wins: number }> = {}
  for (const session of sessions) {
    if (!session.opponent) continue
    if (!rivalMap[session.opponent]) rivalMap[session.opponent] = { total: 0, wins: 0 }
    rivalMap[session.opponent].total++
    if (session.matchResult === 'win') rivalMap[session.opponent].wins++
  }

  const topRivals = Object.entries(rivalMap)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)

  return (
    <div className="space-y-4">
      <div className="bg-surface-card border border-surface-border rounded-xl p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={14} className="text-yellow-400" />
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Resumen
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-2xl font-bold text-ink">{sessions.length}</p>
            <p className="text-xs text-ink-muted">partidos</p>
          </div>
          {withResult.length > 0 && (
            <>
              <div>
                <p className="text-2xl font-bold text-emerald-400">{wins}</p>
                <p className="text-xs text-ink-muted">victorias</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">{losses}</p>
                <p className="text-xs text-ink-muted">derrotas</p>
              </div>
              {winratePct != null && (
                <div>
                  <p className="text-2xl font-bold text-brand-light">{winratePct}%</p>
                  <p className="text-xs text-ink-muted">winrate</p>
                </div>
              )}
            </>
          )}
        </div>

        {topRivals.length > 0 && (
          <div className="mt-3 pt-3 border-t border-surface-border">
            <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">
              Rivales frecuentes
            </p>
            <div className="flex flex-wrap gap-2">
              {topRivals.map(([name, stats]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 text-xs bg-surface-hover rounded-lg px-2.5 py-1"
                >
                  <span className="text-ink">{name}</span>
                  <span className="text-ink-faint">
                    {stats.total}P · {stats.wins}V
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {sessions.map((session) => (
          <MatchCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  )
}

function MatchCard({ session }: { session: Session }) {
  const hasResult = session.matchResult != null
  const hasScore = session.gamesWon != null && session.gamesLost != null
  const isWin = session.matchResult === 'win'

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-ink-muted tabular-nums">
            {formatShortDate(fromISO(session.date))}
          </span>
          <span className="text-sm font-medium text-ink break-words">
            {session.opponent ? `vs. ${session.opponent}` : session.title}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {hasScore && (
            <span className="text-xs font-semibold text-ink-muted tabular-nums">
              {session.gamesWon}-{session.gamesLost}
            </span>
          )}
          {session.location && (
            <span className="text-xs text-ink-faint break-words">{session.location}</span>
          )}
          {!hasResult && (
            <span className="text-xs text-ink-faint italic">sin resultado</span>
          )}
        </div>
      </div>

      {hasResult && (
        <span
          className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${
            isWin
              ? 'text-emerald-400 bg-emerald-400/10'
              : 'text-red-400 bg-red-400/10'
          }`}
        >
          {isWin ? 'Victoria' : 'Derrota'}
        </span>
      )}
    </div>
  )
}
