BEGIN;

-- Apply after 20261005_web_push.sql. Keep existing subscriptions and delivery history.
ALTER TABLE public."WebPushSubscriptions"
  ADD COLUMN IF NOT EXISTS "notificationRole" text CHECK ("notificationRole" IN ('Admin', 'QC', 'Freelancer'));

CREATE TABLE IF NOT EXISTS public."WebPushNotificationState" (
  "accountId" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('Admin', 'QC', 'Freelancer')),
  "eventId" text NOT NULL,
  "fingerprint" text NOT NULL,
  "version" bigint NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("accountId", "role", "eventId")
);
ALTER TABLE public."WebPushNotificationState" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.web_push_store(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF p_action = 'capabilities' THEN
    RETURN jsonb_build_object('version', 2);
  ELSIF p_action = 'subscribe' THEN
    -- Require the same device credentials to transfer an existing endpoint to another account.
    INSERT INTO public."WebPushSubscriptions" ("id", "accountId", "subscription", "notificationRole")
    VALUES (p_data->>'subscriptionId', p_data->>'accountId', p_data->'subscription', COALESCE(p_data->>'notificationRole', 'Freelancer'))
    ON CONFLICT ("id") DO UPDATE SET "accountId" = EXCLUDED."accountId", "subscription" = EXCLUDED."subscription", "notificationRole" = EXCLUDED."notificationRole", "updatedAt" = now()
    WHERE "WebPushSubscriptions"."subscription"->'keys' = EXCLUDED."subscription"->'keys'
    RETURNING to_jsonb("WebPushSubscriptions".*) INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Device credentials differ'; END IF;
    RETURN jsonb_build_object('enabled', true);
  ELSIF p_action = 'remove' THEN
    DELETE FROM public."WebPushSubscriptions" WHERE "id" = p_data->>'subscriptionId' AND "accountId" = p_data->>'accountId';
    RETURN jsonb_build_object('enabled', false);
  ELSIF p_action = 'get' THEN
    SELECT to_jsonb(s) INTO result FROM public."WebPushSubscriptions" s
    WHERE "id" = p_data->>'subscriptionId' AND "accountId" = p_data->>'accountId';
    RETURN COALESCE(result, 'null'::jsonb);
  ELSIF p_action = 'subscriptions' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO result FROM public."WebPushSubscriptions" s;
    RETURN result;
  ELSIF p_action = 'sync_notifications' THEN
    -- Serialize state transitions for an account/role across backend replicas.
    PERFORM pg_advisory_xact_lock(hashtextextended('web-push:' || (p_data->>'accountId') || ':' || (p_data->>'role'), 0));
    UPDATE public."WebPushNotificationState" SET "active" = false
    WHERE "accountId" = p_data->>'accountId' AND "role" = p_data->>'role' AND "active"
      AND "eventId" NOT IN (SELECT item->>'eventId' FROM jsonb_array_elements(p_data->'notifications') item);
    INSERT INTO public."WebPushNotificationState" ("accountId", "role", "eventId", "fingerprint")
    SELECT p_data->>'accountId', p_data->>'role', item->>'eventId', item->>'fingerprint'
    FROM jsonb_array_elements(p_data->'notifications') item
    ON CONFLICT ("accountId", "role", "eventId") DO UPDATE SET
      "version" = "WebPushNotificationState"."version" + CASE WHEN NOT "WebPushNotificationState"."active"
        OR "WebPushNotificationState"."fingerprint" <> EXCLUDED."fingerprint" THEN 1 ELSE 0 END,
      "fingerprint" = EXCLUDED."fingerprint", "active" = true;
    SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO result
    FROM public."WebPushNotificationState" s
    WHERE s."accountId" = p_data->>'accountId' AND s."role" = p_data->>'role' AND s."active";
    RETURN result;
  ELSIF p_action = 'notification_state' THEN
    SELECT to_jsonb(s) INTO result FROM public."WebPushNotificationState" s
    WHERE s."accountId" = p_data->>'accountId' AND s."role" = p_data->>'role' AND s."eventId" = p_data->>'eventId';
    RETURN COALESCE(result, 'null'::jsonb);
  ELSIF p_action = 'claim' THEN
    INSERT INTO public."WebPushDeliveries" ("deliveryKey", "subscriptionId", "accountId", "status", "leaseToken", "leaseUntil")
    SELECT p_data->>'deliveryKey', s."id", s."accountId", 'processing', (p_data->>'leaseToken')::uuid, now() + interval '2 minutes'
    FROM public."WebPushSubscriptions" s WHERE s."id" = p_data->>'subscriptionId' AND s."accountId" = p_data->>'accountId'
    ON CONFLICT ("deliveryKey") DO UPDATE SET "status" = 'processing', "leaseToken" = EXCLUDED."leaseToken",
      "leaseUntil" = EXCLUDED."leaseUntil", "attemptCount" = "WebPushDeliveries"."attemptCount" + 1
    WHERE "WebPushDeliveries"."status" = 'retry' AND "WebPushDeliveries"."nextAttemptAt" <= now()
      AND "WebPushDeliveries"."attemptCount" < 4
    RETURNING to_jsonb("WebPushDeliveries".*) INTO result;
    -- A crashed processing send may have arrived already. Do not send it again.
    RETURN COALESCE(result, 'null'::jsonb);
  ELSIF p_action = 'finish' THEN
    IF p_data->>'status' NOT IN ('sent', 'retry', 'failed', 'cancelled') THEN RAISE EXCEPTION 'Invalid push outcome'; END IF;
    UPDATE public."WebPushDeliveries" SET "status" = p_data->>'status', "leaseToken" = NULL, "leaseUntil" = NULL,
      "nextAttemptAt" = now() + interval '5 minutes'
    WHERE "deliveryKey" = p_data->>'deliveryKey' AND "leaseToken" = (p_data->>'leaseToken')::uuid AND "status" = 'processing';
    RETURN '{}'::jsonb;
  ELSE RAISE EXCEPTION 'Unknown push operation';
  END IF;
END;
$$;

REVOKE ALL ON TABLE public."WebPushNotificationState" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.web_push_store(text, jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public."WebPushNotificationState" FROM anon;
    REVOKE ALL ON FUNCTION public.web_push_store(text, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public."WebPushNotificationState" FROM authenticated;
    REVOKE ALL ON FUNCTION public.web_push_store(text, jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public."WebPushNotificationState" TO service_role;
    GRANT EXECUTE ON FUNCTION public.web_push_store(text, jsonb) TO service_role;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
