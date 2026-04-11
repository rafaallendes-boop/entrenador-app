import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingDown, TrendingUp, Weight, Zap, Wind, Dumbbell, Trophy, Swords, Activity } from 'lucide-react'
import { useTrainingStore } from '../store/useTrainingStore'
import { useUIStore } from '../store/useUIStore'
import { formatWeekRange, formatShortDate, fromISO } from '../utils/date'
import { getRecentSquashCompetitiveExposure, isPracticeSquashMatch } from '../utils/squash'
import WeekSummaryCard from '../components/week/WeekSummaryCard'
import { ROUTES } from '../constants/routes'
import { getMatchSessions } from '../db/queries'
import type { Session } from '../types'
import { getAthleteProgressionInsights, type AthleteProgressionInsights } from '../services/progressionInsights'
import type { DisciplineAcwr } from '../services/loadAnalytics'

type Tab = 'semanas' | 'partidos' | 'progresion'

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
        <button
          onClick={() => setTab('progresion')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'progresion'
              ? 'bg-brand text-white'
              : 'bg-surface-card text-ink-muted hover:text-ink'
          }`}
        >
          Progresión
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
      ) : tab === 'partidos' ? (
        <PartidosView sessions={matchSessions} />
      ) : (
        <ProgresionView />
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
  const exposure = getRecentSquashCompetitiveExposure(sessions, sessions.length)
  const wins = withResult.filter((session) => session.matchResult === 'win').length
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
            <p className="text-xs text-ink-muted">exposiciones</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-brand-light">{exposure.practiceMatchCount}</p>
            <p className="text-xs text-ink-muted">practice match</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-300">{exposure.competitionMatchCount}</p>
            <p className="text-xs text-ink-muted">competencias</p>
          </div>
          {withResult.length > 0 && (
            <>
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
          <MatchCard
            key={session.id}
            session={session}
            subtitle={
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isPracticeSquashMatch(session)
                  ? 'bg-brand/10 text-brand-light'
                  : 'bg-amber-500/10 text-amber-300'
              }`}>
                {isPracticeSquashMatch(session) ? 'Practice match' : 'Competencia'}
              </span>
            }
          />
        ))}
      </div>
    </div>
  )
}

function MatchCard({
  session,
  showRpe = false,
  subtitle,
}: {
  session: Pick<Session, 'date' | 'title' | 'opponent' | 'gamesWon' | 'gamesLost' | 'matchResult' | 'location' | 'actualRpe'>
  showRpe?: boolean
  subtitle?: React.ReactNode
}) {
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
          {showRpe && session.actualRpe != null && (
            <span className="text-xs text-ink-faint font-medium">
              RPE {session.actualRpe}
            </span>
          )}
          {session.location && (
            <span className="text-xs text-ink-faint break-words">{session.location}</span>
          )}
          {subtitle}
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

function ProgresionView() {
  const [insights, setInsights] = useState<AthleteProgressionInsights | null>(null)
  
  useEffect(() => {
    let cancelled = false
    void getAthleteProgressionInsights().then((value) => {
      if (!cancelled) setInsights(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  
  if (!insights) {
    return <div className="text-center py-12"><p className="text-sm text-ink-muted">Cargando progresión...</p></div>
  }

  const hasSquashLoad = insights.squashWeeklyLoads.some((w) => w.totalLoad > 0)
  const hasStrengthLoad = insights.strengthWeeklyLoads.some((w) => w.totalLoad > 0)

  if (insights.matches.length === 0 && insights.strength.length === 0 && !hasSquashLoad && !hasStrengthLoad) {
    return (
      <div className="text-center py-12">
        <Activity size={28} className="text-ink-faint mx-auto mb-3" />
        <p className="text-ink-faint text-sm">Aún no hay datos suficientes de partidos o sesiones de fuerza.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ProgressionOverview insights={insights} />

      {(insights.squashRecommendation || insights.strengthRecommendation) && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Recomendaciones Actuales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
             {insights.squashRecommendation && (
                <RecommendationCard title="Squash" rec={insights.squashRecommendation} icon={<Trophy size={16}/>} />
             )}
             {insights.strengthRecommendation && (
                <RecommendationCard title="Fuerza" rec={insights.strengthRecommendation} icon={<Dumbbell size={16}/>} />
             )}
          </div>
        </div>
      )}

      {(hasSquashLoad || hasStrengthLoad) && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Carga Semanal</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {hasSquashLoad && (
              <LoadTrendCard
                title="Squash"
                icon={<Trophy size={16} />}
                loads={insights.squashWeeklyLoads}
                acwr={insights.squashAcwr}
              />
            )}
            {hasStrengthLoad && (
              <LoadTrendCard
                title="Fuerza"
                icon={<Dumbbell size={16} />}
                loads={insights.strengthWeeklyLoads}
                acwr={insights.strengthAcwr}
              />
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Historial Squash</h3>
            <p className="text-xs text-ink-faint mt-1">Últimas 10 exposiciones competitivas, separando practice match y competencia real.</p>
          </div>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-card px-4 py-3">
          <p className="text-xs text-ink-muted">
            Exposicion reciente: {insights.squashCompetitiveExposure.practiceMatchCount} practice match / {insights.squashCompetitiveExposure.competitionMatchCount} competencia real.
          </p>
        </div>
        {insights.matches.length > 0 ? (
          insights.matches.map((match) => (
            <MatchCard
              key={match.id}
              session={{
                date: match.date,
                title: match.title,
                opponent: match.opponent,
                gamesWon: match.gamesWon,
                gamesLost: match.gamesLost,
                matchResult: match.result,
                actualRpe: match.actualRpe,
              }}
              showRpe
              subtitle={
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  match.competitiveRole === 'practice_match'
                    ? 'bg-brand/10 text-brand-light'
                    : 'bg-amber-500/10 text-amber-300'
                }`}>
                  {match.competitiveRole === 'practice_match' ? 'Practice match' : 'Competencia'}
                </span>
              }
            />
          ))
        ) : (
          <EmptyInsightCard
            title="Sin partidos recientes"
            detail="Registra practice matches o competencias de squash para ver continuidad y confianza competitiva."
          />
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Progresión de Fuerza</h3>
          <p className="text-xs text-ink-faint mt-1">Últimas 4 exposiciones por familia, con tendencia.</p>
        </div>
        {insights.strength.length > 0 ? (
          insights.strength.map((family) => (
            <StrengthProgressCard key={family.exerciseKey} family={family} />
          ))
        ) : (
          <EmptyInsightCard
            title="Sin sesiones de fuerza suficientes"
            detail="Completa sesiones con ejercicios y carga para ver progresión por patrón principal."
          />
        )}
      </div>
    </div>
  )
}

function getAcwrStatusColor(status: DisciplineAcwr['status']): string {
  if (status === 'optimal') return 'text-emerald-400 bg-emerald-400/10'
  if (status === 'risk') return 'text-rose-400 bg-rose-400/10'
  if (status === 'undertrained') return 'text-amber-400 bg-amber-400/10'
  return 'text-ink-muted bg-surface-hover'
}

function getAcwrStatusLabel(status: DisciplineAcwr['status']): string {
  if (status === 'optimal') return 'Óptima'
  if (status === 'risk') return 'Elevada'
  if (status === 'undertrained') return 'Baja'
  return 'Insuf.'
}

function LoadTrendCard({
  title,
  icon,
  loads,
  acwr,
}: {
  title: string
  icon: React.ReactNode
  loads: Array<{ weekStart: string; totalLoad: number; sessionsCount: number; practiceMatchCount?: number; competitionMatchCount?: number }>
  acwr: DisciplineAcwr
}) {
  const displayLoads = [...loads].reverse().slice(-4)
  const maxLoad = Math.max(...displayLoads.map((w) => w.totalLoad), 1)
  const currentWeek = loads[0]

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-brand-light">{icon}</span>
          <span className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {acwr.ratio != null && (
            <span className="text-xs text-ink-muted tabular-nums">{acwr.ratio.toFixed(2)}</span>
          )}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${getAcwrStatusColor(acwr.status)}`}>
            {getAcwrStatusLabel(acwr.status)}
          </span>
        </div>
      </div>

      {displayLoads.length > 0 && (
        <div className="flex items-end gap-1.5 h-14">
          {displayLoads.map((week, index) => {
            const pct = (week.totalLoad / maxLoad) * 100
            const isCurrentWeek = index === displayLoads.length - 1
            return (
              <div key={week.weekStart} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end" style={{ height: '40px' }}>
                  <div
                    className={`w-full rounded-sm transition-all ${isCurrentWeek ? 'bg-brand/70' : 'bg-brand/30'}`}
                    style={{ height: `${Math.max(pct, week.totalLoad > 0 ? 12 : 4)}%` }}
                  />
                </div>
                <span className="text-[9px] text-ink-faint tabular-nums">
                  {index === displayLoads.length - 1 ? 'Actual' : `S${index - displayLoads.length + 1}`}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {currentWeek && currentWeek.sessionsCount > 0 && (
        <p className="text-xs text-ink-faint">
          {currentWeek.sessionsCount} {currentWeek.sessionsCount === 1 ? 'sesión' : 'sesiones'} esta semana
        </p>
      )}

      {acwr.status === 'risk' && (
        <p className="text-xs text-rose-400">Carga elevada — considera reducir volumen esta semana.</p>
      )}
      {acwr.status === 'undertrained' && (
        <p className="text-xs text-amber-400">Carga baja — hay margen para progresar.</p>
      )}
    </div>
  )
}

type Recommendation = NonNullable<AthleteProgressionInsights['squashRecommendation']> | NonNullable<AthleteProgressionInsights['strengthRecommendation']>

function RecommendationCard({ title, rec, icon }: { title: string, rec: Recommendation, icon: React.ReactNode }) {
  const getStatusColor = (status: string) => {
    if (status === 'progress') return 'text-emerald-400 bg-emerald-400/10'
    if (status === 'rotate') return 'text-amber-400 bg-amber-400/10'
    if (status === 'deload') return 'text-rose-400 bg-rose-400/10'
    return 'text-ink-muted bg-surface-hover' // hold
  }
  const getStatusLabel = (status: string) => {
    if (status === 'progress') return 'En progresión'
    if (status === 'rotate') return 'Rotar estímulo'
    if (status === 'deload') return 'Descarga'
    return 'Mantener' 
  }
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
           <span className="text-brand-light">{icon}</span>
           <span className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${getStatusColor(rec.status)}`}>
           {getStatusLabel(rec.status)}
        </span>
      </div>
      <p className="text-sm text-ink-muted mt-1">{rec.message}</p>
    </div>
  )
}

function StrengthProgressCard({
  family,
}: {
  family: AthleteProgressionInsights['strength'][number]
}) {
  const maxWeight = Math.max(...family.entries.map((entry) => entry.weight ?? 0), 1)

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold text-ink capitalize flex items-center gap-2">
          <Activity size={14} className="text-ink-muted" />
          {family.exerciseLabel}
        </p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
          family.trend === 'up'
            ? 'text-emerald-400 bg-emerald-400/10'
            : family.trend === 'flat'
              ? 'text-ink-muted bg-surface-hover'
              : family.trend === 'mixed'
                ? 'text-amber-400 bg-amber-400/10'
                : 'text-sky-400 bg-sky-400/10'
        }`}>
          {family.trendLabel}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mb-2 hide-scrollbar">
        {family.entries.map((entry, index) => (
          <div key={index} className="flex-shrink-0 bg-surface-hover rounded-lg px-3 py-2 flex flex-col min-w-[96px]">
            <span className="text-[10px] text-ink-muted mb-1">{formatShortDate(fromISO(entry.date))}</span>
            <div className="h-1.5 rounded-full bg-surface-border overflow-hidden mb-2">
              <div
                className={`h-full rounded-full ${
                  family.trend === 'up'
                    ? 'bg-emerald-400'
                    : family.trend === 'mixed'
                      ? 'bg-amber-400'
                      : family.trend === 'flat'
                        ? 'bg-ink-faint'
                        : 'bg-sky-400'
                }`}
                style={{ width: `${Math.max(((entry.weight ?? 0) / maxWeight) * 100, entry.weight != null ? 18 : 8)}%` }}
              />
            </div>
            <span className="text-sm font-medium text-ink">{entry.sets}×{entry.reps}</span>
            {entry.weight != null ? (
              <span className="text-xs text-brand-light mt-0.5">@ {entry.weight}kg</span>
            ) : (
              <span className="text-xs text-ink-faint mt-0.5">sin kg</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyInsightCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl px-4 py-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-xs text-ink-faint mt-1 leading-relaxed">{detail}</p>
    </div>
  )
}

function ProgressionOverview({ insights }: { insights: AthleteProgressionInsights }) {
  const recommendationStatuses = [
    insights.squashRecommendation?.status,
    insights.strengthRecommendation?.status,
  ].filter((status): status is NonNullable<Recommendation['status']> => Boolean(status))

  const progressingCount = recommendationStatuses.filter((status) => status === 'progress').length
  const rotatingCount = recommendationStatuses.filter((status) => status === 'rotate').length
  const deloadCount = recommendationStatuses.filter((status) => status === 'deload').length

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <OverviewStat
        label="Progresando"
        value={progressingCount}
        detail="disciplinas listas para progresar"
        tone="emerald"
      />
      <OverviewStat
        label="Rotación"
        value={rotatingCount}
        detail="disciplinas que piden variar"
        tone="amber"
      />
      <OverviewStat
        label="Descarga"
        value={deloadCount}
        detail="disciplinas que conviene proteger"
        tone="rose"
      />
    </div>
  )
}

function OverviewStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: number
  detail: string
  tone: 'emerald' | 'amber' | 'rose'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
      : tone === 'amber'
        ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
        : 'text-rose-400 bg-rose-400/10 border-rose-400/20'

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-[11px] mt-1 opacity-80">{detail}</p>
    </div>
  )
}
