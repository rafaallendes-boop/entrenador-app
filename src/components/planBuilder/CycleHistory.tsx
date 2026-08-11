import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { db } from '../../db/db'
import { useAuthStore } from '../../store/useAuthStore'
import { filterRowsToActiveScope } from '../../services/athlete/activeScopeFilter'
import {
  comparePlanCanonicalRecency,
  summarizeCycle,
} from '../../services/planBuilder/planCycle'
import { deletePlanCycle } from '../../services/planBuilder/deletePlanCycle'
import { getPhaseLabel } from '../../services/macroPlan'
import {
  formatGoalEventWindow,
  goalEventWindowFromMacroPlan,
} from '../../services/goalEventWindow'
import ConfirmDialog from '../ui/ConfirmDialog'
import type { WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const T = {
  brandLt: '#ff7a33',
  lime: '#d1fc00',
  ink: '#f5f5f7',
  muted: '#b0b0b3',
  faint: '#6e6e73',
  card: 'rgba(21,21,21,0.96)',
  raised: 'rgba(30,30,30,0.9)',
  border: 'rgba(255,255,255,0.07)',
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
  fontDisp: "'Lexend', 'Inter', system-ui, sans-serif",
}

interface CycleRow {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  weeksTrained: number
  avgAdherence: number | null
}

function formatEventDate(macroSnapshot: TrainingPlan['macroSnapshot']): string {
  // Un ciclo archivado puede haber sido un campeonato de varios días: mostrar
  // sólo el inicio lo haría indistinguible de un evento de un día.
  return formatGoalEventWindow(goalEventWindowFromMacroPlan(macroSnapshot))
}

function selectCanonicalArchivedPlans(plans: TrainingPlan[]): TrainingPlan[] {
  const canonicalByEvent = new Map<string, TrainingPlan>()
  for (const plan of [...plans].sort(comparePlanCanonicalRecency)) {
    if (!canonicalByEvent.has(plan.goalEventId)) {
      canonicalByEvent.set(plan.goalEventId, plan)
    }
  }

  return [...canonicalByEvent.values()].sort((a, b) =>
    b.macroSnapshot.goalEventDate.localeCompare(a.macroSnapshot.goalEventDate)
    || comparePlanCanonicalRecency(a, b))
}

export function CycleHistory({ weekSummaries, onChanged }: {
  weekSummaries: WeekSummary[]
  onChanged?: () => void
}) {
  const lastSuccessfulSyncAt = useAuthStore((state) => state.syncDetails.lastSuccessfulSyncAt)
  const syncAttemptInFlight = useAuthStore((state) => state.syncDetails.syncAttemptInFlight)
  const [rows, setRows] = useState<CycleRow[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loadRequestId = useRef(0)

  const readRows = useCallback(async (): Promise<CycleRow[]> => {
    const all = await db.trainingPlans.toArray()
    const archived = selectCanonicalArchivedPlans(
      filterRowsToActiveScope(all).filter((plan) => plan.status === 'archived'),
    )

    const next = await Promise.all(archived.map(async (plan): Promise<CycleRow> => {
      const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
      weeks.sort((a, b) => a.weekIndex - b.weekIndex)
      const { weeksTrained, avgAdherence } = summarizeCycle({
        weekStartDates: weeks.map((week) => week.weekStartDate),
        weekSummaries,
      })
      return { plan, weeks, weeksTrained, avgAdherence }
    }))
    return next
  }, [weekSummaries])

  useEffect(() => {
    const requestId = ++loadRequestId.current
    void readRows().then((next) => {
      if (requestId === loadRequestId.current) setRows(next)
    })
    return () => {
      loadRequestId.current += 1
    }
  }, [lastSuccessfulSyncAt, syncAttemptInFlight, readRows])

  async function refresh() {
    const requestId = ++loadRequestId.current
    const next = await readRows()
    if (requestId === loadRequestId.current) setRows(next)
  }

  async function confirmDelete(planId: string) {
    setPendingDeleteId(null)
    const result = await deletePlanCycle(planId)
    if (result === 'deleted') {
      setNotice(null)
      setExpandedId((current) => current === planId ? null : current)
      await refresh()
      onChanged?.()
      return
    }
    setNotice(result === 'pending_sync'
      ? 'El borrado se completará al sincronizar.'
      : 'No se pudo eliminar el ciclo. Revisá tu conexión y reintentá.')
  }

  if (rows == null || rows.length === 0) return null

  const pendingPlan = rows.find((row) => row.plan.id === pendingDeleteId)?.plan ?? null

  return (
    <section
      aria-label="Ciclos anteriores"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 18,
        padding: 16,
      }}
    >
      <h2 style={{
        margin: '0 0 12px',
        color: T.faint,
        fontFamily: T.fontMono,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
      }}>
        Ciclos anteriores
      </h2>

      {notice && (
        <p role="status" style={{ color: T.muted, fontSize: 12, margin: '0 0 10px' }}>
          {notice}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ plan, weeks, weeksTrained, avgAdherence }) => {
          const expanded = expandedId === plan.id
          const active = expanded || hoveredId === plan.id
          return (
            <div
              key={plan.id}
              onMouseEnter={() => setHoveredId(plan.id)}
              onMouseLeave={() => setHoveredId((current) => current === plan.id ? null : current)}
              style={{
                background: active ? 'rgba(209,252,0,0.03)' : T.raised,
                border: `1px solid ${active ? 'rgba(209,252,0,0.18)' : T.border}`,
                borderRadius: 14,
                overflow: 'hidden',
                transition: 'background .15s ease, border-color .15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'stretch' }}>
                <button
                  type="button"
                  aria-label={`${expanded ? 'Contraer' : 'Expandir'} ciclo ${plan.title}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : plan.id)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 10px 12px 12px',
                    color: T.ink,
                    background: 'transparent',
                    border: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <ChevronDown
                    size={15}
                    color={T.faint}
                    style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : undefined }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: T.fontDisp,
                      fontSize: 13,
                      fontWeight: 700,
                    }}>
                      {plan.title}
                    </span>
                    <span style={{
                      display: 'block',
                      marginTop: 3,
                      color: T.faint,
                      fontFamily: T.fontMono,
                      fontSize: 10,
                    }}>
                      {formatEventDate(plan.macroSnapshot)}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ display: 'block', color: T.muted, fontSize: 11 }}>
                      {weeksTrained} sem
                    </span>
                    <span style={{
                      display: 'block',
                      marginTop: 2,
                      color: avgAdherence == null ? T.faint : T.lime,
                      fontFamily: T.fontMono,
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                      {avgAdherence == null ? '—' : `${avgAdherence}%`}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  aria-label={`Eliminar ciclo ${plan.title}`}
                  onClick={() => {
                    setNotice(null)
                    setPendingDeleteId(plan.id)
                  }}
                  style={{
                    width: 44,
                    border: 0,
                    borderLeft: `1px solid ${T.border}`,
                    background: 'transparent',
                    color: '#fb7185',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {expanded && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '0 12px 12px 37px',
                }}>
                  {weeks.map((week) => {
                    const adherence = weekSummaries
                      .find((summary) => summary.weekStartDate === week.weekStartDate)
                      ?.adherencePct
                    return (
                      <div
                        key={week.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 9px',
                          borderRadius: 9,
                          background: 'rgba(255,255,255,0.025)',
                        }}
                      >
                        <span
                          data-testid="history-week-label"
                          style={{ color: T.brandLt, fontFamily: T.fontMono, fontSize: 10 }}
                        >
                          S{week.weekIndex + 1}
                        </span>
                        <span style={{ flex: 1, color: T.muted, fontSize: 11 }}>
                          {getPhaseLabel(week.phase)}
                        </span>
                        <span style={{
                          color: adherence == null ? T.faint : T.ink,
                          fontFamily: T.fontMono,
                          fontSize: 10,
                        }}>
                          {adherence == null ? '—' : `${adherence}%`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={pendingPlan != null}
        title="Eliminar ciclo"
        message={pendingPlan
          ? `Se eliminará el plan ${pendingPlan.title}. Las semanas generadas se conservarán.`
          : ''}
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => {
          if (pendingDeleteId) void confirmDelete(pendingDeleteId)
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
