BEGIN;

ALTER TABLE public."GeneralSettings"
  ADD COLUMN IF NOT EXISTS "taskRemindersEnabled" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public."TaskReminderDeliveries" (
  "deliveryKey" text PRIMARY KEY,
  "seriesId" text NOT NULL,
  "chapterNumber" text NOT NULL,
  "freelancerId" text NOT NULL,
  "dueAt" timestamptz NOT NULL,
  "milestone" text NOT NULL CHECK ("milestone" IN ('24h', '6h', '3h', 'overdue')),
  "email" text NOT NULL DEFAULT '',
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'retry', 'sent', 'failed', 'skipped', 'cancelled', 'needs_review')),
  "attemptCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "firstAttemptAt" timestamptz,
  "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
  "leaseToken" uuid,
  "leaseUntil" timestamptz,
  "sentAt" timestamptz,
  "providerMessageId" text,
  "lastError" text NOT NULL DEFAULT '',
  "uncertain" boolean NOT NULL DEFAULT false,
  UNIQUE ("seriesId", "chapterNumber", "freelancerId", "dueAt", "milestone")
);
CREATE INDEX IF NOT EXISTS task_reminder_pending_idx ON public."TaskReminderDeliveries" ("nextAttemptAt")
  WHERE "status" IN ('pending', 'retry', 'processing');
CREATE INDEX IF NOT EXISTS task_reminder_history_idx ON public."TaskReminderDeliveries" ("createdAt" DESC, "deliveryKey");
ALTER TABLE public."TaskReminderDeliveries" ENABLE ROW LEVEL SECURITY;

-- Same atomic operations are called by PostgreSQL and by PostgREST RPC.
-- Invoker rights: only the backend database owner/service role may operate this store.
CREATE OR REPLACE FUNCTION public.task_reminder_store(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  result jsonb;
  delivery public."TaskReminderDeliveries";
BEGIN
  IF p_action = 'enqueue' THEN
    INSERT INTO public."TaskReminderDeliveries" ("deliveryKey", "seriesId", "chapterNumber", "freelancerId", "dueAt", "milestone", "email", "payload", "status", "lastError")
    SELECT item->>'deliveryKey', item->>'seriesId', item->>'chapterNumber', item->>'freelancerId',
      (item->>'dueAt')::timestamptz, item->>'milestone', COALESCE(item->>'email', ''), item->'payload',
      CASE WHEN item->>'status' = 'skipped' THEN 'skipped' ELSE 'pending' END, COALESCE(item->>'lastError', '')
    FROM jsonb_array_elements(p_data->'records') AS item
    ON CONFLICT ("deliveryKey") DO UPDATE SET "status" = 'pending', "email" = EXCLUDED."email",
      "payload" = EXCLUDED."payload", "lastError" = ''
    WHERE "TaskReminderDeliveries"."status" = 'skipped' AND "TaskReminderDeliveries"."attemptCount" = 0
      AND EXCLUDED."status" = 'pending';
    RETURN '{}'::jsonb;
  ELSIF p_action = 'pending' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) INTO result FROM (
      SELECT * FROM public."TaskReminderDeliveries"
      WHERE "status" IN ('pending', 'retry', 'processing') AND "nextAttemptAt" <= now()
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())
      ORDER BY "nextAttemptAt", "createdAt", "deliveryKey" LIMIT 100
    ) AS rows;
    RETURN result;
  ELSIF p_action = 'claim' THEN
    SELECT * INTO delivery FROM public."TaskReminderDeliveries"
    WHERE "deliveryKey" = p_data->>'deliveryKey' AND "status" IN ('pending', 'retry', 'processing')
      AND "nextAttemptAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
    IF delivery."firstAttemptAt" <= now() - interval '24 hours' OR delivery."attemptCount" >= 4 THEN
      UPDATE public."TaskReminderDeliveries" SET "status" = CASE
        WHEN delivery."uncertain" OR delivery."status" = 'processing' THEN 'needs_review' ELSE 'failed' END,
        "lastError" = 'Đã hết cửa sổ thử lại an toàn hoặc số lần thử; cần kiểm tra kết quả gửi.',
        "leaseToken" = NULL, "leaseUntil" = NULL WHERE "deliveryKey" = delivery."deliveryKey";
      RETURN 'null'::jsonb;
    END IF;
    UPDATE public."TaskReminderDeliveries" SET "status" = 'processing',
      "leaseToken" = (p_data->>'leaseToken')::uuid, "leaseUntil" = now() + interval '2 minutes',
      "firstAttemptAt" = COALESCE("firstAttemptAt", now()), "attemptCount" = "attemptCount" + 1
    WHERE "deliveryKey" = delivery."deliveryKey" RETURNING to_jsonb("TaskReminderDeliveries".*) INTO result;
    RETURN result;
  ELSIF p_action = 'finish' THEN
    IF p_data->>'status' NOT IN ('sent', 'retry', 'failed', 'skipped', 'cancelled', 'needs_review') THEN
      RAISE EXCEPTION 'Invalid reminder outcome';
    END IF;
    UPDATE public."TaskReminderDeliveries" SET "status" = p_data->>'status',
      "lastError" = COALESCE(p_data->>'lastError', ''),
      "providerMessageId" = p_data->>'providerMessageId',
      "sentAt" = CASE WHEN p_data->>'status' = 'sent' THEN now() ELSE NULL END,
      "nextAttemptAt" = COALESCE((p_data->>'nextAttemptAt')::timestamptz, now()),
      "uncertain" = "uncertain" OR COALESCE((p_data->>'uncertain')::boolean, false),
      "leaseToken" = NULL, "leaseUntil" = NULL
    WHERE "deliveryKey" = p_data->>'deliveryKey' AND "leaseToken" = (p_data->>'leaseToken')::uuid
      AND "status" = 'processing'
    RETURNING to_jsonb("TaskReminderDeliveries".*) INTO result;
    RETURN COALESCE(result, 'null'::jsonb);
  ELSIF p_action = 'list' THEN
    SELECT jsonb_build_object('total', (SELECT count(*) FROM public."TaskReminderDeliveries"),
      'items', COALESCE(jsonb_agg(to_jsonb(rows) - 'payload' - 'leaseToken'), '[]'::jsonb)) INTO result FROM (
      SELECT * FROM public."TaskReminderDeliveries" ORDER BY "createdAt" DESC, "deliveryKey"
      LIMIT LEAST(100, GREATEST(1, COALESCE((p_data->>'limit')::integer, 50)))
      OFFSET GREATEST(0, COALESCE((p_data->>'offset')::integer, 0))
    ) AS rows;
    RETURN result;
  ELSE
    RAISE EXCEPTION 'Unknown reminder operation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.task_reminder_store(text, jsonb) FROM PUBLIC;
REVOKE ALL ON TABLE public."TaskReminderDeliveries" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public."TaskReminderDeliveries" FROM anon;
    REVOKE ALL ON FUNCTION public.task_reminder_store(text, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public."TaskReminderDeliveries" FROM authenticated;
    REVOKE ALL ON FUNCTION public.task_reminder_store(text, jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public."TaskReminderDeliveries" TO service_role;
    GRANT EXECUTE ON FUNCTION public.task_reminder_store(text, jsonb) TO service_role;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
