-- Store screenshots attached to managed errors.
-- Run this once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."Errors"
  ADD COLUMN IF NOT EXISTS "screenshot" text;
