-- Run once in Supabase SQL Editor before deploying the new bonus configuration.
-- If SUPABASE_TABLE_BONUS_SETTINGS is customized, substitute that table name.
BEGIN;
ALTER TABLE "BonusSettings"
  ADD COLUMN IF NOT EXISTS "bonusPolicy" jsonb NOT NULL DEFAULT '{"versions": []}'::jsonb;
COMMENT ON COLUMN "BonusSettings"."bonusPolicy" IS
  'Monthly effective versions: KPI lump sum and per-chapter bonus strictly after a fully completed milestone.';
NOTIFY pgrst, 'reload schema';
COMMIT;
