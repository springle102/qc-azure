BEGIN;

-- Match orphan profiles by a non-empty email, never by display name alone.
CREATE OR REPLACE FUNCTION public.assign_freelancer_for_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  next_freelancer_id integer;
  matched_ids integer[];
  account_email text;
BEGIN
  IF COALESCE(NEW."roles", ARRAY[NEW."role"]) && ARRAY['Freelancer', 'QC']::text[]
    AND NEW."freelancerId" IS NULL
  THEN
    PERFORM pg_advisory_xact_lock(6100501);
    account_email := NULLIF(lower(btrim(NEW."email")), '');
    IF account_email IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public."Freelancer" f JOIN public."Accounts" a
          ON a."freelancerId" = f."fIld"
        WHERE lower(btrim(f."email")) = account_email AND a."id" IS DISTINCT FROM NEW."id"
      ) THEN
        RAISE EXCEPTION 'Email này đã được liên kết với một account khác.' USING ERRCODE = '23514';
      END IF;
      SELECT array_agg(f."fIld" ORDER BY f."fIld") INTO matched_ids
      FROM public."Freelancer" f
      WHERE lower(btrim(f."email")) = account_email
        AND NOT EXISTS (
          SELECT 1 FROM public."Accounts" a
          WHERE a."freelancerId" = f."fIld" AND a."id" IS DISTINCT FROM NEW."id"
        );
      IF cardinality(matched_ids) > 1 THEN
        RAISE EXCEPTION 'Email này có nhiều hồ sơ freelancer chưa liên kết. Cần hợp nhất hồ sơ trước khi tạo account.' USING ERRCODE = '23514';
      ELSIF cardinality(matched_ids) = 1 THEN
        NEW."freelancerId" := matched_ids[1];
        RETURN NEW;
      END IF;
    END IF;
    SELECT COALESCE(MAX("fIld"), 0) + 1 INTO next_freelancer_id FROM public."Freelancer";
    INSERT INTO public."Freelancer" ("fIld", "name", "email", "field", "fields")
    VALUES (next_freelancer_id, NEW."displayName", NEW."email", NEW."field", NEW."fields");
    NEW."freelancerId" := next_freelancer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Accounts_assign_freelancer" ON public."Accounts";
CREATE TRIGGER "Accounts_assign_freelancer"
  BEFORE INSERT OR UPDATE OF role, roles, "freelancerId" ON public."Accounts"
  FOR EACH ROW EXECUTE FUNCTION public.assign_freelancer_for_account();

COMMIT;
