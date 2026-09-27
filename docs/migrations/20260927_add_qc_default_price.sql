-- Add the default per-task QC price used by the salary calculation.
-- Run this once in the PostgreSQL/Supabase SQL editor before saving the setting.

ALTER TABLE public."BonusSettings"
  ADD COLUMN IF NOT EXISTS "qcDefaultPrice" numeric(14, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."BonusSettings"'::regclass
      AND conname = 'BonusSettings_qcDefaultPrice_check'
  ) THEN
    ALTER TABLE public."BonusSettings"
      ADD CONSTRAINT "BonusSettings_qcDefaultPrice_check"
      CHECK ("qcDefaultPrice" >= 0);
  END IF;
END $$;
