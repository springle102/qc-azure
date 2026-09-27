-- Add the text color used by the Giá tiền tab for each difficulty level.
-- Run this once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."DifficultyLevels"
  ADD COLUMN IF NOT EXISTS "textColor" varchar(7) NOT NULL DEFAULT '#FFFFFF';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."DifficultyLevels"'::regclass
      AND conname = 'DifficultyLevels_textColor_check'
  ) THEN
    ALTER TABLE public."DifficultyLevels"
      ADD CONSTRAINT "DifficultyLevels_textColor_check"
      CHECK ("textColor" ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;
