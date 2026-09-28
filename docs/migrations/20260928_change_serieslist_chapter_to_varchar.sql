-- Allow deadline chapters to contain text such as 1A, 01, Prologue, or Side Story.
-- Run this once in the PostgreSQL/Supabase SQL editor.

ALTER TABLE public."SeriesList"
  ALTER COLUMN "chapterNumber" TYPE varchar(100)
  USING "chapterNumber"::varchar;
