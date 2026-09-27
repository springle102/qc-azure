-- Seed/update the difficulty levels, background colors, text colors, and prices
-- for the Japan and Latin fields.
-- This script is safe to run more than once.

INSERT INTO public."Fields" ("name")
VALUES ('Japan'), ('Latin')
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE public."DifficultyLevels"
  ADD COLUMN IF NOT EXISTS "textColor" varchar(7) NOT NULL DEFAULT '#FFFFFF';

WITH level_seed("field", "difficulty", "color", "textColor") AS (
  VALUES
    ('Japan',  'Training',  '#ACD4F5', '#075985'),
    ('Japan',  'Normal',    '#BFDEC0', '#166534'),
    ('Japan',  'Medium',    '#E6D7A7', '#854D0E'),
    ('Japan',  'Hard',      '#E6C3CC', '#9F1239'),
    ('Japan',  'Very hard', '#A00B19', '#FFFFFF'),
    ('Latin',  'Training',  '#ACD4F5', '#075985'),
    ('Latin',  'Pass',      '#E6C3CC', '#9F1239'),
    ('Latin',  'Good',      '#E6D7A7', '#854D0E'),
    ('Latin',  'Great',     '#BFDEC0', '#166534'),
    ('Latin',  'Excellent', '#10715B', '#FFFFFF')
)
INSERT INTO public."DifficultyLevels" ("field", "difficulty", "color", "textColor")
SELECT "field", "difficulty", "color", "textColor"
FROM level_seed
ON CONFLICT ("field", "difficulty") DO UPDATE SET
  "color" = EXCLUDED."color",
  "textColor" = EXCLUDED."textColor";

WITH price_seed("field", "difficulty", "price") AS (
  VALUES
    ('Japan', 'Training',  70000.00),
    ('Japan', 'Normal',    85000.00),
    ('Japan', 'Medium',   100000.00),
    ('Japan', 'Hard',     120000.00),
    ('Japan', 'Very hard',140000.00),
    ('Latin', 'Training',  70000.00),
    ('Latin', 'Pass',      90000.00),
    ('Latin', 'Good',     100000.00),
    ('Latin', 'Great',    120000.00),
    ('Latin', 'Excellent',140000.00)
)
INSERT INTO public."DifficultyPricing" ("field", "difficulty", "price")
SELECT "field", "difficulty", "price"
FROM price_seed
ON CONFLICT ("field", "difficulty") DO UPDATE SET
  "price" = EXCLUDED."price";
