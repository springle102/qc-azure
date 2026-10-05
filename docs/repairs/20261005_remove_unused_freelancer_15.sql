-- Keep active profile 20 and all its tasks/salary. Remove only unused duplicate 15.
-- Run after verifying that both IDs still belong to the same person.
BEGIN;
LOCK TABLE public."Freelancer", public."Accounts", public."SeriesList",
  public."DeadlineRegistrations", public."Errors" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."Freelancer" WHERE "fIld" = 15) THEN
    RETURN; -- Already repaired.
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Freelancer" old JOIN public."Freelancer" active
      ON active."fIld" = 20
    WHERE old."fIld" = 15
      AND NULLIF(lower(btrim(old."email")), '') = lower(btrim(active."email"))
      AND old."name" = active."name" AND old."field" = active."field"
      AND NULLIF(old."imageQR", '') IS NULL
      AND NULLIF(old."note", '') IS NULL AND COALESCE(old."salary", 0) = 0
      AND EXISTS (SELECT 1 FROM public."Accounts" WHERE "freelancerId" = 20)
  ) THEN
    RAISE EXCEPTION 'Duplicate identity or active account changed; stop repair';
  END IF;
  IF EXISTS (SELECT 1 FROM public."Accounts" WHERE "freelancerId" = 15)
    OR EXISTS (SELECT 1 FROM public."SeriesList" WHERE "fIld" = 15)
    OR EXISTS (SELECT 1 FROM public."DeadlineRegistrations" WHERE "fIld" = 15)
    OR EXISTS (SELECT 1 FROM public."Errors" WHERE "editorFreelancerId" = 15)
  THEN
    RAISE EXCEPTION 'Profile 15 has references; stop repair to preserve history';
  END IF;
  DELETE FROM public."Freelancer" WHERE "fIld" = 15;
END;
$$;
COMMIT;
