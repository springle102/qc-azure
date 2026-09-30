-- Repair the first receivedAt backfill when it accidentally used deadline/status dates.
-- This migration is safe to run by itself in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."SeriesList"
  ADD COLUMN IF NOT EXISTS "receivedAt" timestamptz;

UPDATE public."SeriesList"
SET "receivedAt" = now()
WHERE "receivedAt" IS NULL
   OR ("endTask" IS NOT NULL AND "receivedAt" = "endTask")
   OR ("submittedAt" IS NOT NULL AND "receivedAt" = "submittedAt")
   OR ("doingStartedAt" IS NOT NULL AND "receivedAt" = "doingStartedAt");

CREATE INDEX IF NOT EXISTS "SeriesList_received_at_idx"
  ON public."SeriesList" ("receivedAt" DESC);
