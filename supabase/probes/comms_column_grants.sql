-- =============================================================================================
-- Probe: column-scoped UPDATE on comms (00002520 §2). A recipient can mark their own notification
-- read / seen / archived but cannot rewrite its title, body or action_url; a sender can edit their
-- own stage message's body but cannot clear its PII mask.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/comms_column_grants.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_user uuid;
    v_note uuid;
    v_msg uuid;
    v_sender uuid;
BEGIN
    SELECT u.user_id INTO v_user FROM org.users_public u ORDER BY u.user_id LIMIT 1;
    IF v_user IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no seeded user (deno task db:reset)'; END IF;

    -- system.maintenance routes to in_app and is mandatory, so no preference can drop the row.
    v_note := comms.fn_notify(v_user, 'system.maintenance', 'Probe title', 'Probe body',
        p_action_url => '/settings');
    IF v_note IS NULL THEN RAISE EXCEPTION 'FAIL fixture: fn_notify returned no row'; END IF;

    SELECT m.id, m.sender_user_id INTO v_msg, v_sender FROM comms.project_messages m
    WHERE m.deleted_at IS NULL ORDER BY m.id LIMIT 1;

    PERFORM set_config('probe.user', v_user::text, true);
    PERFORM set_config('probe.note', v_note::text, true);
    PERFORM set_config('probe.msg', COALESCE(v_msg::text, ''), true);
    PERFORM set_config('probe.sender', COALESCE(v_sender::text, ''), true);
END $$;
-- #endregion

-- #region 1. The recipient
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.user'), 'role', 'authenticated')::text, true);

DO $$
DECLARE v_note uuid := current_setting('probe.note')::uuid;
BEGIN
    BEGIN
        UPDATE comms.notifications SET title = 'Payout failed — re-enter your bank details' WHERE id = v_note;
        RAISE EXCEPTION 'FAIL recipient rewrote their own notification title';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS title rewrite refused [%]', SQLERRM;
    END;

    BEGIN
        UPDATE comms.notifications SET body = 'x', action_url = 'https://evil.example' WHERE id = v_note;
        RAISE EXCEPTION 'FAIL recipient rewrote their own notification body / action_url';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS body / action_url rewrite refused [%]', SQLERRM;
    END;

    IF comms.mark_notifications_read(ARRAY[v_note]) <> 1 THEN
        RAISE EXCEPTION 'FAIL mark_notifications_read did not mark the row';
    END IF;
    IF comms.archive_notifications(ARRAY[v_note]) <> 1 THEN
        RAISE EXCEPTION 'FAIL archive_notifications did not archive the row';
    END IF;
    PERFORM comms.mark_notifications_seen();
    RAISE NOTICE 'PASS read / seen / archive RPCs still work';
END $$;

RESET ROLE;

DO $$
BEGIN
    IF (SELECT title FROM comms.notifications WHERE id = current_setting('probe.note')::uuid) <> 'Probe title' THEN
        RAISE EXCEPTION 'FAIL notification title changed';
    END IF;
    RAISE NOTICE 'PASS stored title is unchanged';
END $$;
-- #endregion

-- #region 2. A stage-message sender
SELECT set_config('request.jwt.claims',
    json_build_object('sub', NULLIF(current_setting('probe.sender'), ''), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
    IF current_setting('probe.msg') = '' THEN
        RAISE NOTICE 'SKIP no seeded stage message';
        RETURN;
    END IF;
    BEGIN
        UPDATE comms.project_messages SET pii_masked = false, pii_categories = '{}'
        WHERE id = current_setting('probe.msg')::uuid;
        RAISE EXCEPTION 'FAIL sender cleared their own message''s PII mask';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS PII-mask rewrite refused [%]', SQLERRM;
    END;
    BEGIN
        UPDATE comms.project_messages SET created_at = now() - interval '1 year'
        WHERE id = current_setting('probe.msg')::uuid;
        RAISE EXCEPTION 'FAIL sender backdated their own message';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS created_at rewrite refused [%]', SQLERRM;
    END;
    UPDATE comms.project_messages SET body = body, edited_at = now()
    WHERE id = current_setting('probe.msg')::uuid;
    RAISE NOTICE 'PASS body edit still permitted';
END $$;

RESET ROLE;
-- #endregion

ROLLBACK;
