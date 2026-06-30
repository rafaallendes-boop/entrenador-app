import type { Athlete } from '../types'

/** Supabase row shape for public.athletes (snake_case). */
export interface AthleteRow {
  id: string
  owner_account_id: string
  linked_account_id: string | null
  display_name: string | null
  status: string
  created_at: number
  updated_at: number
}

export function athleteToRow(athlete: Athlete): AthleteRow {
  return {
    id: athlete.id,
    owner_account_id: athlete.ownerAccountId,
    linked_account_id: athlete.linkedAccountId ?? null,
    display_name: athlete.displayName ?? null,
    status: athlete.status,
    created_at: athlete.createdAt,
    updated_at: athlete.updatedAt,
  }
}

export function rowToAthlete(row: AthleteRow): Athlete {
  return {
    id: row.id,
    ownerAccountId: row.owner_account_id,
    linkedAccountId: row.linked_account_id,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
