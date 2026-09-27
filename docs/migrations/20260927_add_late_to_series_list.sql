-- Add the Late category used by the deadline management table.
-- Run this once in the Supabase SQL editor before saving Late values.

ALTER TABLE public."SeriesList"
  ADD COLUMN IF NOT EXISTS "late" text;

UPDATE public."SeriesList"
SET "late" = '≤0h'
WHERE "late" IS NULL OR btrim("late") = '';

ALTER TABLE public."SeriesList"
  ALTER COLUMN "late" SET DEFAULT '≤0h';

ALTER TABLE public."SeriesList"
  ALTER COLUMN "late" SET NOT NULL;

ALTER TABLE public."SeriesList"
  DROP CONSTRAINT IF EXISTS "SeriesList_late_check";

ALTER TABLE public."SeriesList"
  ADD CONSTRAINT "SeriesList_late_check"
  CHECK ("late" IN ('≤0h', '1~3h', '3~6h', '6~10h', '>10h'));
