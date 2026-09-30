-- Track when Admin/QC sets or changes a deadline date.
-- Run once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."SeriesList"
  ADD COLUMN IF NOT EXISTS "deadlineSetAt" timestamptz;

-- Existing rows did not previously store this event time. Use the closest
-- available timestamp as a one-time baseline; future edits use the exact API time.
UPDATE public."SeriesList"
SET "deadlineSetAt" = COALESCE("submittedAt", "doingStartedAt", "endTask", now())
WHERE "deadlineSetAt" IS NULL
  AND "endTask" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "SeriesList_deadline_set_at_idx"
  ON public."SeriesList" ("deadlineSetAt" DESC);
