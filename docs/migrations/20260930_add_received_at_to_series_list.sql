-- Track when a task first enters the system from the web or Google Sheet.
-- Run once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."SeriesList"
  ADD COLUMN IF NOT EXISTS "receivedAt" timestamptz;

-- Existing rows did not previously store the import/creation event. Use the
-- closest available timestamp as a one-time baseline; new rows use the exact
-- time they are inserted or synchronized.
UPDATE public."SeriesList"
SET "receivedAt" = now()
WHERE "receivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "SeriesList_received_at_idx"
  ON public."SeriesList" ("receivedAt" DESC);
