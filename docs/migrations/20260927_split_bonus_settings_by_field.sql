-- Split bonus and QC default price settings by configured field.
-- Run this once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."BonusSettings"
  ADD COLUMN IF NOT EXISTS "field" varchar(50);

ALTER TABLE public."BonusSettings"
  ADD COLUMN IF NOT EXISTS "qcDefaultPrice" numeric(14, 2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "BonusSettings_field_unique"
  ON public."BonusSettings" ("field")
  WHERE "field" IS NOT NULL;

-- Copy the current global values to each configured field as the initial value.
-- The existing table uses a required integer id without an automatic default,
-- so assign new ids after the current maximum.
INSERT INTO public."BonusSettings" ("id", "field", "taskThreshold", "bonusPerTask", "qcDefaultPrice")
SELECT
  COALESCE((SELECT MAX("id") FROM public."BonusSettings"), 0)
    + ROW_NUMBER() OVER (ORDER BY fields."name"),
  fields."name",
  COALESCE(defaults."taskThreshold", 20),
  COALESCE(defaults."bonusPerTask", 10000),
  COALESCE(defaults."qcDefaultPrice", 0)
FROM public."Fields" fields
LEFT JOIN LATERAL (
  SELECT "taskThreshold", "bonusPerTask", "qcDefaultPrice"
  FROM public."BonusSettings"
  WHERE "field" IS NULL
  ORDER BY "id"
  LIMIT 1
) defaults ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public."BonusSettings" existing
  WHERE existing."field" = fields."name"
);
