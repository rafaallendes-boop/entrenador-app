-- =============================================================================
-- 002_athlete_profiles_unique_constraint.sql
-- 
-- PURPOSE: Enforce one-profile-per-user by adding a UNIQUE constraint on user_id.
-- This prevents INSERT race conditions from creating duplicate profiles.
-- The client code now uses `upsert(..., { onConflict: 'user_id' })` which
-- depends on this constraint existing.
--
-- SAFETY: This script is idempotent — safe to run multiple times.
--
-- PREREQUISITE: Must be run in the Supabase SQL Editor BEFORE deploying
-- the updated client code that uses onConflict: 'user_id'.
-- =============================================================================

-- Step 1: Add 'data' column if it doesn't exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'athlete_profiles'
      AND column_name = 'data'
  ) THEN
    ALTER TABLE athlete_profiles ADD COLUMN data jsonb;
  END IF;
END
$$;

-- Step 2: Clean up duplicate profiles (keep the most recently updated per user)
-- This must run BEFORE creating the unique constraint.
WITH ranked AS (
  SELECT
    id,
    user_id,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY updated_at DESC, id ASC
    ) AS rn
  FROM athlete_profiles
)
DELETE FROM athlete_profiles
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Step 3: Create unique index on user_id (idempotent with IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS athlete_profiles_user_id_unique
ON athlete_profiles (user_id);

-- Step 4: Verify the constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'athlete_profiles'
      AND indexname = 'athlete_profiles_user_id_unique'
  ) THEN
    RAISE EXCEPTION 'UNIQUE index athlete_profiles_user_id_unique was not created';
  END IF;
END
$$;
