ALTER TABLE public."GeneralSettings"
ADD COLUMN IF NOT EXISTS "googleDriveRawTransfer" jsonb NOT NULL
DEFAULT '{"enabled": false, "mappings": {}}'::jsonb;
