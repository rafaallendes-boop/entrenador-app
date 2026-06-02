import { shouldShowPlanQuality } from '../../services/ai/showPlanQualityFlag'
import type { PlanQualityGrade, PlanQualityReview } from '../../services/planBuilder/qualityReview'

interface PlanQualityBadgeProps {
  review: PlanQualityReview
}

const GRADE_LABELS: Record<PlanQualityGrade, string> = {
  excellent: 'excellent',
  good: 'good',
  needs_review: 'needs_review',
  poor: 'poor',
}

const GRADE_TONE: Record<PlanQualityGrade, { border: string; color: string; background: string }> = {
  excellent: { border: 'rgba(16,185,129,0.35)', color: '#34d399', background: 'rgba(16,185,129,0.10)' },
  good: { border: 'rgba(14,165,233,0.35)', color: '#38bdf8', background: 'rgba(14,165,233,0.10)' },
  needs_review: { border: 'rgba(245,158,11,0.35)', color: '#fbbf24', background: 'rgba(245,158,11,0.10)' },
  poor: { border: 'rgba(244,63,94,0.35)', color: '#fb7185', background: 'rgba(244,63,94,0.10)' },
}

export function PlanQualityBadge({ review }: PlanQualityBadgeProps) {
  if (!shouldShowPlanQuality()) return null

  const tone = GRADE_TONE[review.grade]

  return (
    <section
      data-testid="plan-quality-badge"
      style={{
        borderRadius: 14,
        border: '1px dashed rgba(255,255,255,0.16)',
        background: 'rgba(255,255,255,0.035)',
        padding: '12px 13px',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
          <span
            style={{
              border: `1px solid ${tone.border}`,
              background: tone.background,
              color: tone.color,
              borderRadius: 999,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            {GRADE_LABELS[review.grade]}
          </span>
          <span style={{ color: 'rgba(245,245,247,0.88)', fontWeight: 700 }}>score {review.score}</span>
          <span style={{ color: 'rgba(176,176,179,0.95)' }}>{review.warningCount} warnings</span>
          {review.repairCount > 0 && (
            <span style={{ color: 'rgba(176,176,179,0.95)' }}>{review.repairCount} reparaciones</span>
          )}
          {review.criticalIssueCount > 0 && (
            <span style={{ color: '#fb7185' }}>{review.criticalIssueCount} criticas</span>
          )}
        </div>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', color: 'rgba(176,176,179,0.95)', fontSize: 11 }}>
          detalle por semana
        </summary>
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 5 }}>
          {review.weeks.map((week) => {
            const weekTone = GRADE_TONE[week.grade]
            return (
              <li
                key={week.weekIndex}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 7,
                  color: 'rgba(176,176,179,0.95)',
                }}
              >
                <span style={{ color: 'rgba(245,245,247,0.9)', fontWeight: 600 }}>Semana {week.weekIndex + 1}</span>
                <span style={{ color: weekTone.color }}>{week.grade}</span>
                <span>score {week.score}</span>
                {week.issues.length > 0 && <span>{week.issues.length} issue(s)</span>}
                {week.repairCount > 0 && <span>{week.repairCount} reparaciones</span>}
              </li>
            )
          })}
        </ul>
      </details>
    </section>
  )
}
