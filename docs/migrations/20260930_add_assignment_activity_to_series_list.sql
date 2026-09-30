-- Track when a freelancer is assigned so the dashboard can show recent assignments.
-- Run once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."SeriesList"
  ADD COLUMN IF NOT EXISTS "assignedAt" timestamptz;

-- Existing rows did not previously store assignment time. Use the closest
-- available activity timestamp as a one-time baseline; new assignments use the
-- exact assignment time written by the API.
UPDATE public."SeriesList"
SET "assignedAt" = COALESCE("submittedAt", "doingStartedAt", "endTask", now())
WHERE "fIld" IS NOT NULL
  AND "assignedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "SeriesList_assigned_at_idx"
  ON public."SeriesList" ("assignedAt" DESC);
