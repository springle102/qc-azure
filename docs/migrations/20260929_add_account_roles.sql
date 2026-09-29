-- Allow a small number of accounts to carry two roles.
-- The legacy `role` column remains the effective (highest privilege) role.
BEGIN;

ALTER TABLE public."Accounts"
  ADD COLUMN IF NOT EXISTS "roles" text[];

UPDATE public."Accounts"
SET "roles" = ARRAY["role"]::text[]
WHERE "roles" IS NULL OR cardinality("roles") = 0;

ALTER TABLE public."Accounts"
  ALTER COLUMN "roles" SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN "roles" SET NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_account_role_from_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_values text[];
BEGIN
  role_values := COALESCE(NEW."roles", ARRAY[]::text[]);
  IF cardinality(role_values) = 0 THEN
    role_values := ARRAY[NEW."role"]::text[];
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(role_values) AS item(value)
    WHERE item.value NOT IN ('Admin', 'QC', 'Freelancer')
  ) THEN
    RAISE EXCEPTION 'Accounts.roles chỉ được chứa Admin, QC hoặc Freelancer';
  END IF;
  IF cardinality(role_values) < 1 OR cardinality(role_values) > 2 THEN
    RAISE EXCEPTION 'Accounts.roles chỉ được có tối đa hai role';
  END IF;

  NEW."roles" := ARRAY(SELECT DISTINCT item.value FROM unnest(role_values) AS item(value));
  IF 'Admin' = ANY(NEW."roles") THEN
    NEW."role" := 'Admin';
  ELSIF 'QC' = ANY(NEW."roles") THEN
    NEW."role" := 'QC';
  ELSE
    NEW."role" := 'Freelancer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Accounts_sync_role_from_roles" ON public."Accounts";
DROP TRIGGER IF EXISTS "Accounts_00_sync_role_from_roles" ON public."Accounts";
CREATE TRIGGER "Accounts_00_sync_role_from_roles"
BEFORE INSERT OR UPDATE OF "role", "roles"
ON public."Accounts"
FOR EACH ROW
EXECUTE FUNCTION public.sync_account_role_from_roles();

ALTER TABLE public."Accounts"
  DROP CONSTRAINT IF EXISTS "Accounts_roles_check";
ALTER TABLE public."Accounts"
  ADD CONSTRAINT "Accounts_roles_check"
  CHECK (
    cardinality("roles") BETWEEN 1 AND 2
    AND "roles" <@ ARRAY['Admin', 'QC', 'Freelancer']::text[]
  );

CREATE OR REPLACE FUNCTION public.assign_freelancer_for_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_freelancer_id integer;
BEGIN
  IF NEW."roles" && ARRAY['Freelancer', 'QC']::text[] AND NEW."freelancerId" IS NULL THEN
    SELECT COALESCE(MAX("fIld"), 0) + 1 INTO next_freelancer_id FROM "Freelancer";
    INSERT INTO "Freelancer" ("fIld", "name", "email", "field", "fields")
    VALUES (next_freelancer_id, NEW."displayName", NEW."email", NEW."field", NEW."fields");
    NEW."freelancerId" := next_freelancer_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_account_to_freelancer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."roles" && ARRAY['Freelancer', 'QC']::text[] AND NEW."freelancerId" IS NOT NULL THEN
    UPDATE "Freelancer"
    SET "name" = NEW."displayName",
        "email" = NEW."email",
        "field" = NEW."field",
        "fields" = NEW."fields"
    WHERE "fIld" = NEW."freelancerId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_account_to_qc()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF 'QC' = ANY(NEW."roles") THEN
    INSERT INTO "QC" ("qcId", "name", "email")
    VALUES (NEW."id"::integer, NEW."displayName", NEW."email")
    ON CONFLICT ("qcId") DO UPDATE
      SET "name" = EXCLUDED."name", "email" = EXCLUDED."email";
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
