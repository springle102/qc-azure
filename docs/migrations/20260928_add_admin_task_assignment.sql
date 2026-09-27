-- Allow an Admin account to receive a deadline without creating a Freelancer profile.
-- Run this once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."SeriesList"
  ADD COLUMN IF NOT EXISTS "assignedAdminId" bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SeriesList_admin_fkey'
  ) THEN
    ALTER TABLE public."SeriesList"
      ADD CONSTRAINT "SeriesList_admin_fkey"
      FOREIGN KEY ("assignedAdminId")
      REFERENCES public."Accounts" ("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "SeriesList_admin_idx"
  ON public."SeriesList" ("assignedAdminId");
