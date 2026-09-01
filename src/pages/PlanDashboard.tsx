import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Edit2, Flag, ChevronRight, BarChart2, Zap, CircleCheck, LockKeyhole } from 'lucide-react'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { db } from '../db/db'
import { computeMacroPlan, getPrimaryGoalEvent, getPhaseLabel } from '../services/macroPlan'
import { fromISO, todayISO } from '../utils/date'
import {
  formatGoalEventKeyDate,
  formatGoalEventWindow,
  resolveGoalEventWindow,
  type GoalEventWindowInput,
} from '../services/goalEventWindow'
import {
  resolveCurrentPlanWeekNumber,
  resolvePlanStartDate,
  resolvePlanWeekNumber,
} from '../services/planBuilder/planProgress'
import { ROUTES } from '../constants/routes'
import { resolveGeneratedWeeksRoute } from './planDashboardNavigation'
import { PlanQualityBadge } from '../components/planBuilder/PlanQualityBadge'
import { CycleHistory } from '../components/planBuilder/CycleHistory'
import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'
import {
  comparePlanCanonicalRecency,
  resolvePlanCycleState,
  summarizeCycle,
} from '../services/planBuilder/planCycle'
import type { MacroPlanPhase } from '../types'
import type { TrainingPlan } from '../types/planBuilder'

// ── Design tokens ────────────────────────────────────────────
const T = {
  brand:     '#ff4d00',
  brandLt:   '#ff7a33',
  lime:      '#d1fc00',
  cyan:      '#00e3fd',
  ember:     '#ffeb9c',
  ink:       '#f5f5f7',
  muted:     '#b0b0b3',
  faint:     '#6e6e73',
  card:      'rgba(21,21,21,0.96)',
  raised:    'rgba(30,30,30,0.9)',
  border:    'rgba(255,255,255,0.07)',
  fontMono:  "'JetBrains Mono', ui-monospace, monospace",
  fontDisp:  "'Lexend', 'Inter', system-ui, sans-serif",
}

// ── Phase focus fallback (used for past phases not in timeline) ──
const PHASE_FOCUS_FALLBACK: Record<MacroPlanPhase, string> = {
  base:       'Volumen y resistencia general',
  build:      'Técnica específica y aumento de carga',
  peak:       'Máxima intensidad y afinación del rendimiento.',
  taper:      'Reducción de carga, frescura',
  race:       'Semana del evento',
  transition: 'Recuperación post-evento',
}

const PHASE_ORDER: MacroPlanPhase[] = ['base', 'build', 'peak', 'taper', 'race']

// Standard phase duration (in weeks) for display
const PHASE_WEEKS: Partial<Record<MacroPlanPhase, string>> = {
  base:       '4+ sem',
  build:      '4 sem',
  peak:       '4 sem',
  taper:      '4 sem',
  race:       '1 sem',
  transition: '2+ sem',
}

// ── Sport chip colors ────────────────────────────────────────
const SPORT_CONF: Record<string, { color: string; label: string }> = {
  squash:    { color: '#ff4d00', label: 'Squash' },
  running:   { color: '#00e3fd', label: 'Running' },
  strength:  { color: '#d1fc00', label: 'Fuerza' },
  cycling:   { color: '#00e3fd', label: 'Ciclismo' },
  mobility:  { color: '#d1fc00', label: 'Movilidad' },
  recovery:  { color: '#ffeb9c', label: 'Recuperación' },
}

// ── Helpers ──────────────────────────────────────────────────
function daysToEvent(dateISO: string): number {
  const now = new Date()
  const event = fromISO(dateISO)
  return Math.max(0, Math.ceil((event.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
}


/**
 * El countdown sigue midiendo contra el inicio, pero la etiqueta debe describir
 * la ventana completa: un campeonato de una semana no es "9 sep 2026".
 */
function formatEventDate(event: GoalEventWindowInput): string {
  return formatGoalEventWindow(event)
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

// ── Sub-components ───────────────────────────────────────────

function Micro({ children, color = T.faint }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      fontFamily: T.fontMono,
      fontSize: 9.5,
      fontWeight: 600,
      letterSpacing: '0.26em',
      textTransform: 'uppercase' as const,
      color,
    }}>
      {children}
    </span>
  )
}

function ProgressBar({ value, total, color = T.brand, height = 5 }: {
  value: number; total: number; color?: string; height?: number;
}) {
  const pct = Math.min(100, Math.round((value / total) * 100))
  return (
    <div style={{
      height,
      background: 'rgba(255,255,255,0.07)',
      borderRadius: 999,
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}, ${color}cc)`,
        borderRadius: 999,
        transition: 'width 1s ease',
        boxShadow: `0 0 10px -2px ${color}80`,
      }} />
    </div>
  )
}

function SportChip({ sport }: { sport: string }) {
  const conf = SPORT_CONF[sport] ?? { color: T.faint, label: sport }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 8px',
      borderRadius: 999,
      background: `${conf.color}14`,
      border: `1px solid ${conf.color}30`,
      fontFamily: T.fontMono,
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: '0.22em',
      textTransform: 'uppercase' as const,
      color: conf.color,
    }}>
      {conf.label}
    </span>
  )
}

// ── EventCountdown card ──────────────────────────────────────
function EventCountdown({ title, event, planStartISO }: {
  title: string; event: GoalEventWindowInput; planStartISO?: string;
}) {
  const { startDate, endDate } = resolveGoalEventWindow(event)
  const today = todayISO()
  const isEventActive = today >= startDate && today <= endDate
  const days = daysToEvent(startDate)
  const daysToEnd = daysToEvent(endDate)
  const planStart = planStartISO ? fromISO(planStartISO) : null
  const eventDate = fromISO(startDate)
  const totalDays = planStart
    ? Math.ceil((eventDate.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24))
    : days * 2
  const elapsed = Math.max(0, totalDays - days)
  const pct = totalDays > 0 ? Math.round((elapsed / totalDays) * 100) : 0

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: 22,
      border: '1px solid rgba(72,72,71,0.4)',
      background: 'linear-gradient(150deg, rgba(24,14,8,0.99), rgba(10,8,8,1))',
      padding: '18px 20px',
      boxShadow: '0 20px 60px -30px rgba(0,0,0,0.9)',
      backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
      backgroundSize: '22px 22px',
    }}>
      {/* Top stripe */}
      <div style={{
        position: 'absolute', inset: '0 0 auto',
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,77,0,0.55), transparent)',
      }} />
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: -20, right: -20,
        width: 120, height: 120, borderRadius: '50%',
        background: 'rgba(255,77,0,0.1)', filter: 'blur(44px)',
        pointerEvents: 'none',
      }} />
      {/* Watermark target icon */}
      <div style={{
        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
        opacity: 0.04, pointerEvents: 'none',
      }}>
        <svg width={110} height={110} viewBox="0 0 24 24" fill="none" stroke="#ff4d00" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
        </svg>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <Flag size={13} color={T.brandLt} />
          <Micro color={T.brandLt}>Evento objetivo</Micro>
        </div>
        <div style={{
          fontFamily: T.fontDisp, fontSize: 21, fontWeight: 800,
          color: T.ink, lineHeight: 1.2, marginBottom: 4,
        }}>
          {title}
        </div>
        <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.faint }}>
          {formatEventDate(event)}
          {formatGoalEventKeyDate(event) && <> · {formatGoalEventKeyDate(event)}</>}
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{
            fontFamily: T.fontDisp, fontSize: isEventActive ? 32 : 44, fontWeight: 800,
            color: T.brand, lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {isEventActive ? 'En curso' : days}
          </span>
          <span style={{ fontSize: 13, color: T.muted }}>
            {isEventActive
              ? (daysToEnd === 0 ? 'termina hoy' : `${daysToEnd} día${daysToEnd === 1 ? '' : 's'} para el término`)
              : 'días restantes'}
          </span>
        </div>
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={elapsed} total={totalDays} color={T.brand} height={5} />
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 5,
          }}>
            <Micro>Inicio</Micro>
            <Micro color={T.brandLt}>{pct}% completado</Micro>
            <Micro>Evento</Micro>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── KPI pills ────────────────────────────────────────────────
function KPIPill({ label, value, color = T.brand }: {
  label: string; value: string; color?: string;
}) {
  return (
    <div style={{
      flex: 1, padding: '11px 12px', borderRadius: 13,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${T.border}`,
    }}>
      <Micro color={color}>{label}</Micro>
      <div style={{
        fontFamily: T.fontMono, fontSize: 18, fontWeight: 700,
        color: T.ink, marginTop: 5, fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  )
}

function EventCompleted({ title, event, summary }: {
  title: string
  event: GoalEventWindowInput
  summary: { weeksTrained: number; avgAdherence: number | null } | null
}) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: 22,
      border: '1px solid rgba(209,252,0,0.22)',
      background: 'linear-gradient(150deg, rgba(16,22,8,0.99), rgba(8,10,8,1))',
      padding: '18px 20px',
      boxShadow: '0 20px 60px -30px rgba(0,0,0,0.9)',
    }}>
      {/* Top stripe */}
      <div style={{
        position: 'absolute', inset: '0 0 auto',
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(209,252,0,0.55), transparent)',
      }} />
      {/* Ambient glow — calm register, no grid, to read as "closed" next to the countdown */}
      <div style={{
        position: 'absolute', top: -20, right: -20,
        width: 120, height: 120, borderRadius: '50%',
        background: 'rgba(209,252,0,0.09)', filter: 'blur(44px)',
        pointerEvents: 'none',
      }} />
      {/* Watermark completion seal */}
      <div style={{
        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
        opacity: 0.05, pointerEvents: 'none',
      }}>
        <svg width={110} height={110} viewBox="0 0 24 24" fill="none" stroke={T.lime} strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12.3l2.6 2.6L16.2 9.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <CircleCheck size={13} color={T.lime} />
          <Micro color={T.lime}>Evento completado</Micro>
        </div>
        <div style={{
          fontFamily: T.fontDisp, fontSize: 21, fontWeight: 800,
          color: T.ink, lineHeight: 1.2, marginBottom: 4,
        }}>
          {title}
        </div>
        <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.faint }}>
          {formatEventDate(event)}
          {formatGoalEventKeyDate(event) && <> · {formatGoalEventKeyDate(event)}</>}
        </div>
        <div style={{ marginTop: 14 }}>
          <ProgressBar value={1} total={1} color={T.lime} height={5} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
            <Micro>Inicio</Micro>
            <Micro color={T.lime}>Ciclo cerrado</Micro>
            <Micro>Evento</Micro>
          </div>
        </div>
        {summary && (
          <div data-testid="cycle-metrics" style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <KPIPill
              label="Semanas entrenadas"
              value={String(summary.weeksTrained)}
              color={T.lime}
            />
            <KPIPill
              label="Adherencia"
              value={summary.avgAdherence == null ? '—' : `${summary.avgAdherence}%`}
              color={T.brand}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Phase card ───────────────────────────────────────────────
function PhaseCard({ phase, label, focus, status, weeks, primarySport, complementarySports }: {
  phase: MacroPlanPhase
  label: string
  focus: string
  status: 'past' | 'current' | 'future'
  weeks?: string
  primarySport?: string
  complementarySports?: string[]
}) {
  const statusConf = {
    past:    { dot: T.lime,    label: 'Completada', bg: 'rgba(209,252,0,0.05)',    border: 'rgba(209,252,0,0.18)' },
    current: { dot: T.brand,   label: 'En curso',   bg: 'rgba(255,77,0,0.07)',     border: 'rgba(255,77,0,0.28)' },
    future:  { dot: T.faint,   label: 'Próxima',    bg: 'rgba(255,255,255,0.02)',  border: T.border },
  }[status]

  const sports = [
    ...(primarySport ? [primarySport] : []),
    ...(complementarySports ?? []),
  ].slice(0, 3)

  return (
    <div
      data-testid="phase-card"
      style={{
        position: 'relative',
        borderRadius: 14, padding: '13px 14px',
        background: statusConf.bg, border: `1px solid ${statusConf.border}`,
      }}
    >
      {status === 'current' && (
        <div style={{
          position: 'absolute', inset: '0 auto 0 0', width: 3,
          borderRadius: '14px 0 0 14px',
          background: T.brand,
          boxShadow: `0 0 14px ${T.brand}`,
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          fontFamily: T.fontDisp, fontSize: 13.5, fontWeight: 700, color: T.ink,
        }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%', background: statusConf.dot,
            boxShadow: status === 'current' ? `0 0 9px ${statusConf.dot}` : 'none',
          }} />
          <Micro color={statusConf.dot}>{statusConf.label}</Micro>
        </div>
      </div>
      <div style={{
        fontFamily: T.fontMono, fontSize: 10.5, color: T.faint, marginBottom: sports.length ? 9 : 0,
      }}>
        {weeks ?? PHASE_WEEKS[phase] ?? '?'} · {focus}
      </div>
      {sports.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
          {sports.map(s => <SportChip key={s} sport={s} />)}
        </div>
      )}
    </div>
  )
}

// ── Week row ─────────────────────────────────────────────────
function WeekRow({ weekNum, phaseName, adherence, isActive }: {
  weekNum: number; phaseName: string; adherence?: number; isActive?: boolean;
}) {
  const adherenceColor = !adherence ? T.faint
    : adherence >= 80 ? T.lime
    : adherence >= 60 ? T.brand
    : T.ember

  return (
    <div style={{
      borderRadius: 12, padding: '10px 12px',
      background: isActive ? 'rgba(255,77,0,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isActive ? 'rgba(255,77,0,0.22)' : T.border}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: isActive ? 'rgba(255,77,0,0.15)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isActive ? 'rgba(255,77,0,0.3)' : T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: 10.5, fontWeight: 700,
          color: isActive ? T.brand : T.faint,
        }}>
          S{weekNum}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: T.fontDisp, fontSize: 12, fontWeight: 500,
          color: isActive ? T.ink : T.muted,
        }}>
          {phaseName}
        </div>
      </div>
      {adherence != null ? (
        <span style={{
          fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: adherenceColor,
        }}>
          {adherence}%
        </span>
      ) : isActive ? (
        <span style={{
          fontFamily: T.fontMono, fontSize: 9.5, color: T.brandLt,
          letterSpacing: '0.2em', textTransform: 'uppercase' as const,
        }}>
          Actual
        </span>
      ) : null}
    </div>
  )
}

// ── Section title ────────────────────────────────────────────
function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 10,
    }}>
      <span style={{
        fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 600,
        letterSpacing: '0.3em', textTransform: 'uppercase' as const, color: T.faint,
      }}>
        {children}
      </span>
      {right}
    </div>
  )
}

/**
 * En solo lectura desaparece "Planificar próximo evento". La ausencia se
 * explica en el mismo lugar donde estaba la acción: un ciclo cerrado sin
 * salida visible deja al atleta sin siguiente paso.
 */
function ReadOnlyPlanningOffer({ onViewPlans }: { onViewPlans: () => void }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: '15px 16px',
        background: 'linear-gradient(150deg, rgba(255,77,0,0.09), rgba(255,255,255,0.02))',
        border: '1px solid rgba(255,77,0,0.22)',
      }}
    >
      <div style={{
        fontFamily: T.fontDisp, fontSize: 13.5, fontWeight: 700, color: T.ink,
      }}>
        Planificar un ciclo nuevo está en Avanzado
      </div>
      <p style={{
        margin: '5px 0 0', fontSize: 13, lineHeight: 1.5, color: T.muted,
      }}>
        Este plan queda disponible para consultarlo cuando quieras. Para preparar
        tu próximo evento, sube de plan.
      </p>
      <button
        type="button"
        onClick={onViewPlans}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: 12, padding: '10px 14px', borderRadius: 11,
          background: T.brand, border: 'none', cursor: 'pointer',
          fontFamily: T.fontDisp, fontSize: 13, fontWeight: 700,
          color: '#1a0800',
        }}
      >
        Ver planes
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Main PlanDashboard component
// ═══════════════════════════════════════════════════════════════

export default function PlanDashboard({ onEdit, onNewCycle, readOnly = false }: {
  onEdit: () => void
  onNewCycle: (goalEventId: string) => void
  /** Un plan ya generado puede consultarse en Free, pero no modificarse. */
  readOnly?: boolean
}) {
  const navigate = useNavigate()
  const { athleteProfile, loadMemory } = useCoachMemoryStore()
  const { allWeekSummaries, loadAllSummaries } = useTrainingStore()
  const [loadedActivePlan, setLoadedActivePlan] = useState<TrainingPlan | null>(null)
  const [activePlanWeekStarts, setActivePlanWeekStarts] = useState<string[]>([])
  const today = todayISO()
  const profileMacroPlan = useMemo(() => computeMacroPlan(athleteProfile), [athleteProfile])
  const profilePrimaryEvent = useMemo(() => getPrimaryGoalEvent(athleteProfile), [athleteProfile])
  const activeGeneratedPlan = profilePrimaryEvent
    && loadedActivePlan?.goalEventId !== profilePrimaryEvent.id
    ? null
    : loadedActivePlan

  useEffect(() => { void loadMemory() }, [loadMemory])
  useEffect(() => { void loadAllSummaries() }, [loadAllSummaries])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const all = await db.trainingPlans.toArray()
      if (cancelled) return
      const active = filterRowsToActiveScope(all)
        .filter((plan) => plan.status === 'active')
        .sort(comparePlanCanonicalRecency)
      const plan = profilePrimaryEvent
        ? (active.find((candidate) => candidate.goalEventId === profilePrimaryEvent.id) ?? null)
        : (active[0] ?? null)
      setLoadedActivePlan(plan)
      if (!plan) {
        setActivePlanWeekStarts([])
        return
      }
      const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
      if (!cancelled) setActivePlanWeekStarts(weeks.map((week) => week.weekStartDate))
    })()
    return () => {
      cancelled = true
    }
  }, [profilePrimaryEvent])

  const macroPlan = profileMacroPlan ?? activeGeneratedPlan?.macroSnapshot ?? null
  const generatedPrimaryEvent = useMemo(() => activeGeneratedPlan
    ? {
      id: activeGeneratedPlan.goalEventId,
      title: activeGeneratedPlan.title,
      date: activeGeneratedPlan.macroSnapshot.goalEventDate,
      endDate: activeGeneratedPlan.macroSnapshot.goalEventEndDate,
      keyDate: activeGeneratedPlan.macroSnapshot.goalEventKeyDate,
      sport: activeGeneratedPlan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport ?? 'squash',
      priority: 'primary' as const,
    }
    : null, [activeGeneratedPlan])
  const primaryEvent = profilePrimaryEvent ?? generatedPrimaryEvent
  const planConfig = athleteProfile?.planWizardConfig ?? activeGeneratedPlan?.wizardConfig
  const planStartISO = useMemo(() => resolvePlanStartDate({
    planStartDate: activeGeneratedPlan?.startDate,
    createdAt: planConfig?.createdAt,
  }), [activeGeneratedPlan?.startDate, planConfig?.createdAt])

  // Compute weeks
  const totalWeeks = useMemo(() => {
    if (activeGeneratedPlan) return activeGeneratedPlan.totalWeeks
    if (!primaryEvent?.date || !planConfig?.createdAt) return macroPlan?.weeksRemaining ?? 0
    const start = new Date(planConfig.createdAt)
    const end = new Date(primaryEvent.date)
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
  }, [activeGeneratedPlan, primaryEvent, planConfig, macroPlan])

  const weeksRemaining = macroPlan?.weeksRemaining ?? 0
  const currentWeekNum = resolveCurrentPlanWeekNumber({
    planStartDate: planStartISO,
    totalWeeks,
    dateISO: today,
    weeksRemaining,
  })

  // Adherence from last 8 weeks with data
  const avgAdherence = useMemo(() => {
    const recent = allWeekSummaries
      .filter(w => w.weekStartDate <= today && w.adherencePct != null)
      .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))
      .slice(0, 8)
    return recent.length ? avg(recent.map(w => w.adherencePct!)) : null
  }, [allWeekSummaries, today])

  const cycleState = primaryEvent
    ? resolvePlanCycleState({ event: primaryEvent, todayISO: today })
    : 'upcoming'
  const currentPhase: MacroPlanPhase = cycleState === 'post_event'
    ? 'transition'
    : (macroPlan?.currentPhase ?? 'base')
  const cycleSummary = useMemo(
    () => summarizeCycle({
      weekStartDates: activePlanWeekStarts,
      weekSummaries: allWeekSummaries,
    }),
    [activePlanWeekStarts, allWeekSummaries],
  )
  const phasesToRender: MacroPlanPhase[] = cycleState === 'post_event'
    ? [...PHASE_ORDER, 'transition']
    : PHASE_ORDER
  const currentPhaseIdx = phasesToRender.indexOf(currentPhase)

  const allPhases = phasesToRender.map((phase, idx) => {
    const status: 'past' | 'current' | 'future' =
      phase === currentPhase ? 'current'
      : idx < currentPhaseIdx ? 'past'
      : 'future'

    const timelineEntry = macroPlan?.timeline.find(e => e.phase === phase)

    let weekCount: string | undefined
    if (timelineEntry) {
      const phaseWeeks = timelineEntry.endWeek - timelineEntry.startWeek + 1
      if (phaseWeeks > 0) weekCount = `${phaseWeeks} sem`
    }

    const label = getPhaseLabel(phase)
    const focus = timelineEntry?.focus ?? PHASE_FOCUS_FALLBACK[phase]

    return { phase, status, weekCount, label, focus }
  })

  // Primary sport from event or profile
  const primarySport = primaryEvent?.sport ?? athleteProfile?.sportContext?.primarySport ?? 'squash'
  const complementarySports = planConfig?.complementarySports ?? []

  // Recent weeks for the weekly breakdown
  const recentWeeks = useMemo(() => {
    return allWeekSummaries
      .filter(w => w.weekStartDate <= today && (!planStartISO || w.weekStartDate >= planStartISO))
      .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))
      .slice(0, 4)
      .reverse()
      .map((w) => {
        const weekNum = resolvePlanWeekNumber({
          planStartDate: planStartISO,
          totalWeeks,
          dateISO: w.weekStartDate,
        })
        const isActive = weekNum === currentWeekNum
        return { weekStartDate: w.weekStartDate, weekNum, phaseName: getPhaseLabel(currentPhase), adherence: w.adherencePct, isActive }
      })
  }, [allWeekSummaries, today, planStartISO, totalWeeks, currentWeekNum, currentPhase])

  if (!primaryEvent || !macroPlan) return null

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      color: T.ink,
      paddingBottom: 100,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '56px 20px 8px',
      }}>
        <div>
          <div style={{
            fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 600,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            color: T.brandLt, marginBottom: 5,
          }}>
            Plan de competencia
          </div>
          <h1 style={{
            fontFamily: T.fontDisp, fontSize: 26, fontWeight: 800,
            color: T.ink, margin: 0, lineHeight: 1.1,
          }}>
            Tu plan
          </h1>
        </div>
        {readOnly ? (
          <div
            aria-label="Vista de solo lectura"
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${T.border}`,
              fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
              letterSpacing: '0.16em', textTransform: 'uppercase', color: T.muted,
            }}
          >
            <LockKeyhole size={12} aria-hidden />
            Solo lectura
          </div>
        ) : (
          <button
            onClick={onEdit}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 14px', borderRadius: 10,
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${T.border}`,
              fontFamily: T.fontDisp, fontSize: 13, fontWeight: 600,
              color: T.muted, cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            <Edit2 size={13} />
            Editar
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {cycleState === 'post_event' ? (
          <EventCompleted
            title={primaryEvent.title}
            event={primaryEvent}
            summary={activeGeneratedPlan ? cycleSummary : null}
          />
        ) : (
          <EventCountdown
            title={primaryEvent.title}
            event={primaryEvent}
            planStartISO={planStartISO}
          />
        )}

        {/* KPI row */}
        {cycleState === 'upcoming' && (
          <div data-testid="dashboard-kpis" style={{ display: 'flex', gap: 8 }}>
            <KPIPill label="Semanas" value={String(totalWeeks)} color={T.brand} />
            <KPIPill
              label="Adherencia"
              value={avgAdherence != null ? `${avgAdherence}%` : '—'}
              color={T.lime}
            />
            <KPIPill
              label="Semana"
              value={`${currentWeekNum}/${totalWeeks}`}
              color={T.cyan}
            />
          </div>
        )}

        {activeGeneratedPlan?.generationSummary?.qualityReview && (
          <PlanQualityBadge review={activeGeneratedPlan.generationSummary.qualityReview} />
        )}

        {/* Phases */}
        <div style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 18, padding: '16px 16px 14px',
        }}>
          <SectionTitle right={
            <span style={{
              fontFamily: T.fontMono, fontSize: 9.5,
              color: T.brandLt,
              letterSpacing: '0.2em', textTransform: 'uppercase',
            }}>
              {getPhaseLabel(currentPhase)}
            </span>
          }>
            Fases
          </SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allPhases.map(({ phase, status, weekCount, label, focus }) => (
              <PhaseCard
                key={phase}
                phase={phase}
                label={label}
                focus={focus}
                status={status}
                weeks={weekCount}
                primarySport={status === 'current' || status === 'future' ? primarySport : undefined}
                complementarySports={status === 'current' || status === 'future' ? complementarySports : undefined}
              />
            ))}
          </div>
        </div>

        {/* Recent weeks */}
        {cycleState === 'upcoming' && recentWeeks.length > 0 && (
          <div data-testid="recent-weeks" style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 18, padding: '16px 16px 14px',
          }}>
            <SectionTitle>Semanas recientes</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentWeeks.map(w => (
                <WeekRow
                  key={w.weekStartDate}
                  weekNum={w.weekNum}
                  phaseName={w.phaseName}
                  adherence={w.adherence}
                  isActive={w.isActive}
                />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cycleState === 'post_event' ? (
            <>
              {readOnly ? (
                <ReadOnlyPlanningOffer onViewPlans={() => navigate(ROUTES.PRICING)} />
              ) : (
                <button
                  type="button"
                  onClick={() => onNewCycle(primaryEvent.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', padding: '15px 20px', borderRadius: 14,
                    background: T.brand,
                    border: 'none', cursor: 'pointer',
                    fontFamily: T.fontDisp, fontSize: 14, fontWeight: 700,
                    color: '#1a0800',
                    boxShadow: `0 8px 28px -10px ${T.brand}70`,
                    transition: 'all .18s',
                  }}
                >
                  <Zap size={15} />
                  Planificar próximo evento
                  <ChevronRight size={14} />
                </button>
              )}
              {activeGeneratedPlan && (
                <button
                  type="button"
                  onClick={() => navigate(resolveGeneratedWeeksRoute(activeGeneratedPlan))}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', padding: '13px 20px', borderRadius: 14,
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${T.border}`,
                    cursor: 'pointer',
                    fontFamily: T.fontDisp, fontSize: 13, fontWeight: 600,
                    color: T.muted,
                    transition: 'all .18s',
                  }}
                >
                  Ver semanas generadas
                  <ChevronRight size={14} />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate(resolveGeneratedWeeksRoute(activeGeneratedPlan))}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '15px 20px', borderRadius: 14,
                background: T.brand,
                border: 'none', cursor: 'pointer',
                fontFamily: T.fontDisp, fontSize: 14, fontWeight: 700,
                color: '#1a0800',
                boxShadow: `0 8px 28px -10px ${T.brand}70`,
                transition: 'all .18s',
              }}
            >
              <Zap size={15} />
              Ver semanas generadas
              <ChevronRight size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(ROUTES.CHAT, { state: { prefill: 'Quiero revisar mi plan de competencia' } })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '13px 20px', borderRadius: 14,
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${T.border}`,
              cursor: 'pointer',
              fontFamily: T.fontDisp, fontSize: 13, fontWeight: 600,
              color: T.muted,
              transition: 'all .18s',
            }}
          >
            <BarChart2 size={14} />
            Consultar a RallyIQ
          </button>
        </div>

        <CycleHistory weekSummaries={allWeekSummaries} readOnly={readOnly} />

      </div>
    </div>
  )
}
