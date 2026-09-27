-- Store the mapping from a configured field to its Google Drive root folder.
-- Example: {"Japan":"JP","Latin":"Latin"}

ALTER TABLE public."GeneralSettings"
  ADD COLUMN IF NOT EXISTS "googleDriveFolders" text;
