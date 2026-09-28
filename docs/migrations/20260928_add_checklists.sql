-- Store multiple Google Sheet checklists for each configured field.
-- Run this once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."GeneralSettings"
  ADD COLUMN IF NOT EXISTS "checklists" text;
