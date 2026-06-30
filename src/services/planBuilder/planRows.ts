import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

export type PlanRow = Record<string, unknown>
export type PlanWeekRow = Record<string, unknown>

function fallbackGenerationState(row: PlanRow): TrainingPlan['generationState'] {
  const status = row.status as TrainingPlan['status'] | undefined
  if (status === 'active' || status === 'archived') return 'complete'
  return 'shell'
}

export function trainingPlanToRow(plan: TrainingPlan, userId: string, deletedAt?: number | null): PlanRow {
  return {
    id: plan.id,
    user_id: userId,
    athlete_id: plan.athleteId,
    goal_event_id: plan.goalEventId,
    status: plan.status,
    generation_state: plan.generationState,
    title: plan.title,
    start_date: plan.startDate,
    end_date: plan.endDate,
    total_weeks: plan.totalWeeks,
    phases: plan.phases,
    wizard_config: plan.wizardConfig,
    macro_snapshot: plan.macroSnapshot,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    accepted_at: plan.acceptedAt ?? null,
    notes: plan.notes ?? null,
    generation_summary: plan.generationSummary ?? null,
    deleted_at: deletedAt ?? null,
  }
}

export function rowToTrainingPlan(row: PlanRow): TrainingPlan {
  return {
    id: row.id as string,
    athleteId: row.athlete_id as string,
    goalEventId: row.goal_event_id as string,
    status: row.status as TrainingPlan['status'],
    generationState: (row.generation_state as TrainingPlan['generationState'] | undefined) ?? fallbackGenerationState(row),
    title: row.title as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    totalWeeks: row.total_weeks as number,
    phases: (row.phases as TrainingPlan['phases']) ?? [],
    wizardConfig: row.wizard_config as TrainingPlan['wizardConfig'],
    macroSnapshot: row.macro_snapshot as TrainingPlan['macroSnapshot'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    acceptedAt: (row.accepted_at as number | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    generationSummary: (row.generation_summary as TrainingPlan['generationSummary'] | null) ?? undefined,
  }
}

export function trainingPlanWeekToRow(week: TrainingPlanWeek, userId: string, deletedAt?: number | null): PlanWeekRow {
  return {
    id: week.id,
    user_id: userId,
    athlete_id: week.athleteId ?? null,
    plan_id: week.planId,
    week_index: week.weekIndex,
    week_start_date: week.weekStartDate,
    phase: week.phase,
    status: week.status,
    sessions: week.sessions,
    week_objectives: week.weekObjectives,
    target_load_by_sport: week.targetLoadBySport,
    validation_issues: week.validationIssues,
    generation_meta: week.generationMeta,
    created_at: week.createdAt,
    updated_at: week.updatedAt,
    deleted_at: deletedAt ?? null,
  }
}

export function rowToTrainingPlanWeek(row: PlanWeekRow): TrainingPlanWeek {
  return {
    id: row.id as string,
    athleteId: (row.athlete_id as string | null) ?? undefined,
    planId: row.plan_id as string,
    weekIndex: row.week_index as number,
    weekStartDate: row.week_start_date as string,
    phase: row.phase as TrainingPlanWeek['phase'],
    status: row.status as TrainingPlanWeek['status'],
    sessions: (row.sessions as TrainingPlanWeek['sessions']) ?? [],
    weekObjectives: (row.week_objectives as TrainingPlanWeek['weekObjectives']) ?? [],
    targetLoadBySport: (row.target_load_by_sport as TrainingPlanWeek['targetLoadBySport']) ?? {},
    validationIssues: (row.validation_issues as TrainingPlanWeek['validationIssues']) ?? [],
    generationMeta: (row.generation_meta as TrainingPlanWeek['generationMeta']) ?? { attempts: 0 },
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}
