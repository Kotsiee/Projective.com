-- =============================================================================================
-- Probe: moving the sign-in address (Decision #451, ST1) — org.prepare_sign_in_change and
-- org.record_sign_in_change (00001050), their grants (00002510), the audit index (00004002) and the
-- account.sign_in_changed catalogue row (00005010).
--
--   * prepare refuses, in order: a row that is not the caller's, the current sign-in address, an
--     unconfirmed address, another account's sign-in address (generically), a scheduled deletion, an
--     account with no password, and a third move inside three days (DETAIL = when the next is allowed).
--   * record refuses unless GoTrue already holds the address (auth.users.email), so a direct call
--     records nothing that did not happen; once it does, it writes one audit row (ids only) and one
--     critical in-app notice per move, a repeat call is a no-op, and makePrimary moves the primary.
--   * Both doors are the signed-in caller's: authenticated executes them, anon does not.
--
-- The service's GoTrue admin update is simulated here by writing auth.users.email directly.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/sign_in_change.sql
--
-- Fixture: two seeded adults with a password, a profile and their sign-in row, neither scheduled for
-- deletion; two secondary addresses for the first are filed here. A clean run prints only PASS notices.
-- =============================================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'PROBE FAIL % — got %', p_label, p_got;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- The refusal `p_sql` raises (its message), with its DETAIL when it has one; 'none' when it succeeds.
CREATE FUNCTION pg_temp.refusal(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text;
BEGIN
    EXECUTE p_sql;
    RETURN 'none';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN SQLERRM || COALESCE('|' || NULLIF(v_detail, ''), '');
END $$;

CREATE TEMP TABLE probe_fixture AS
WITH adults AS (
    SELECT u.id, u.email,
           (SELECT e.id FROM org.user_emails e WHERE e.user_id = u.id AND lower(e.email) = lower(u.email)) AS sign_in_row
      FROM auth.users u
      JOIN org.users_public p ON p.user_id = u.id
     WHERE COALESCE(u.encrypted_password, '') <> ''
       AND u.email_confirmed_at IS NOT NULL
       AND NOT u.is_sso_user
       AND NOT EXISTS (SELECT 1 FROM org.deletion_requests d WHERE d.user_id = u.id AND d.status = 'scheduled')
       AND NOT EXISTS (SELECT 1 FROM security.audit_logs a WHERE a.user_id = u.id AND a.action = 'user.sign_in_changed')
       AND (SELECT count(*) FROM org.user_emails e WHERE e.user_id = u.id) <= 3
     ORDER BY u.email
     LIMIT 2
)
SELECT (array_agg(id ORDER BY email))[1] AS x,
       (array_agg(email ORDER BY email))[1] AS x_email,
       (array_agg(sign_in_row ORDER BY email))[1] AS x_row,
       (array_agg(id ORDER BY email))[2] AS y,
       (array_agg(email ORDER BY email))[2] AS y_email
  FROM adults;

DO $$
DECLARE f probe_fixture%ROWTYPE;
BEGIN
    SELECT * INTO f FROM probe_fixture;
    PERFORM pg_temp.check('two seeded adults with a sign-in row', f.x IS NOT NULL AND f.y IS NOT NULL AND f.x_row IS NOT NULL, row_to_json(f)::text);
    INSERT INTO org.user_emails (id, user_id, email, is_primary, verified_at) VALUES
        ('51e0c1a0-0000-4000-8000-000000000001', f.x, 'st1.probe.home@probe.example', false, now()),
        ('51e0c1a0-0000-4000-8000-000000000002', f.x, 'st1.probe.pending@probe.example', false, NULL),
        ('51e0c1a0-0000-4000-8000-000000000003', f.x, f.y_email, false, now());
END $$;

-- #region Grants, index, catalogue
DO $$ BEGIN
    PERFORM pg_temp.check('prepare: authenticated executes, anon does not',
        has_function_privilege('authenticated', 'org.prepare_sign_in_change(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'org.prepare_sign_in_change(uuid)', 'EXECUTE'), 'grants');
    PERFORM pg_temp.check('record: authenticated executes, anon does not',
        has_function_privilege('authenticated', 'org.record_sign_in_change(uuid, uuid, boolean)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'org.record_sign_in_change(uuid, uuid, boolean)', 'EXECUTE'), 'grants');
    PERFORM pg_temp.check('the per-person audit index exists',
        EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_user_action'), 'missing');
    PERFORM pg_temp.check('account.sign_in_changed is critical, required, in-app, unaudited',
        EXISTS (SELECT 1 FROM comms.notification_types
                 WHERE key = 'account.sign_in_changed' AND urgency = 'critical' AND mandatory
                   AND default_channels = ARRAY['in_app']::comms.notification_channel[] AND NOT audit), 'catalogue row');
END $$;
-- #endregion

-- #region prepare refusals
DO $$
DECLARE f probe_fixture%ROWTYPE; v text;
BEGIN
    SELECT * INTO f FROM probe_fixture;
    PERFORM pg_temp.act(f.x);

    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-0000000000ff')$q$);
    PERFORM pg_temp.check('prepare: an id that is not the caller''s is email_not_found', v = 'email_not_found', v);
    v := pg_temp.refusal(format('SELECT org.prepare_sign_in_change(%L)', f.x_row));
    PERFORM pg_temp.check('prepare: the current sign-in address is sign_in_already', v = 'sign_in_already', v);
    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000002')$q$);
    PERFORM pg_temp.check('prepare: an unconfirmed address is sign_in_unverified', v = 'sign_in_unverified', v);
    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000003')$q$);
    PERFORM pg_temp.check('prepare: another account''s sign-in address is the generic sign_in_unavailable', v = 'sign_in_unavailable', v);

    PERFORM pg_temp.check('prepare: a confirmed secondary returns (target, current)',
        (SELECT target_email = 'st1.probe.home@probe.example' AND current_email = f.x_email
           FROM org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000001')), 'mismatch');

    PERFORM pg_temp.act(f.y);
    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000001')$q$);
    PERFORM pg_temp.check('prepare: another person''s row is email_not_found', v = 'email_not_found', v);
END $$;
-- #endregion

-- #region record
DO $$
DECLARE f probe_fixture%ROWTYPE; v text;
BEGIN
    SELECT * INTO f FROM probe_fixture;
    PERFORM pg_temp.act(f.x);

    v := pg_temp.refusal(format('SELECT org.record_sign_in_change(%L, %L, true)', '51e0c1a0-0000-4000-8000-000000000001', f.x_row));
    PERFORM pg_temp.check('record: refused before GoTrue holds the address', v = 'sign_in_unavailable', v);

    UPDATE auth.users SET email = 'st1.probe.home@probe.example' WHERE id = f.x;

    v := pg_temp.refusal($q$SELECT org.record_sign_in_change('51e0c1a0-0000-4000-8000-000000000001', '51e0c1a0-0000-4000-8000-0000000000ff', true)$q$);
    PERFORM pg_temp.check('record: a previous row that is not the caller''s is email_not_found', v = 'email_not_found', v);

    PERFORM org.record_sign_in_change('51e0c1a0-0000-4000-8000-000000000001', f.x_row, true);
    PERFORM org.record_sign_in_change('51e0c1a0-0000-4000-8000-000000000001', f.x_row, true);

    PERFORM pg_temp.check('record: one audit row for the move, a repeat call is a no-op',
        (SELECT count(*) = 1 FROM security.audit_logs WHERE user_id = f.x AND action = 'user.sign_in_changed'), 'count');
    PERFORM pg_temp.check('record: the audit row carries ids, never addresses',
        (SELECT metadata = jsonb_build_object('previous_email_id', f.x_row, 'made_primary', true)
           FROM security.audit_logs WHERE user_id = f.x AND action = 'user.sign_in_changed'), 'metadata');
    PERFORM pg_temp.check('record: no second (notification) audit row',
        NOT EXISTS (SELECT 1 FROM security.audit_logs WHERE user_id = f.x AND action = 'notification.account.sign_in_changed'), 'present');
    PERFORM pg_temp.check('record: one critical in-app notice',
        (SELECT count(*) = 1 FROM comms.notifications
          WHERE user_id = f.x AND type = 'account.sign_in_changed' AND urgency = 'critical'
            AND channels = ARRAY['in_app']::comms.notification_channel[]), 'count');
    PERFORM pg_temp.check('record: makePrimary moved the primary',
        (SELECT is_primary FROM org.user_emails WHERE id = '51e0c1a0-0000-4000-8000-000000000001')
        AND NOT EXISTS (SELECT 1 FROM org.user_emails WHERE user_id = f.x AND is_primary AND id <> '51e0c1a0-0000-4000-8000-000000000001'), 'primary');
    PERFORM pg_temp.check('get_my_emails: the new address signs in, the old one is a confirmed secondary',
        (SELECT is_sign_in FROM org.get_my_emails() WHERE id = '51e0c1a0-0000-4000-8000-000000000001')
        AND (SELECT NOT is_sign_in AND verified_at IS NOT NULL FROM org.get_my_emails() WHERE id = f.x_row), 'flags');
END $$;
-- #endregion

-- #region The limit, no password, a scheduled deletion
DO $$
DECLARE f probe_fixture%ROWTYPE; v text;
BEGIN
    SELECT * INTO f FROM probe_fixture;
    PERFORM pg_temp.act(f.x);

    PERFORM pg_temp.check('prepare: a second move inside three days is allowed',
        (SELECT current_email = 'st1.probe.home@probe.example' FROM org.prepare_sign_in_change(f.x_row)), 'refused');
    UPDATE auth.users SET email = f.x_email WHERE id = f.x;
    PERFORM org.record_sign_in_change(f.x_row, '51e0c1a0-0000-4000-8000-000000000001', false);

    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000001')$q$);
    PERFORM pg_temp.check('prepare: a third move inside three days is sign_in_limit with when',
        split_part(v, '|', 1) = 'sign_in_limit'
        AND split_part(v, '|', 2) ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
        AND split_part(v, '|', 2)::timestamptz BETWEEN now() + interval '3 days' - interval '1 minute'
                                                   AND now() + interval '3 days' + interval '1 minute', v);

    UPDATE auth.users SET encrypted_password = '' WHERE id = f.x;
    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000001')$q$);
    PERFORM pg_temp.check('prepare: an account with no password is password_required', v = 'password_required', v);

    INSERT INTO org.deletion_requests (user_id, scope, scheduled_for) VALUES (f.x, 'account', now() + interval '30 days');
    v := pg_temp.refusal($q$SELECT org.prepare_sign_in_change('51e0c1a0-0000-4000-8000-000000000001')$q$);
    PERFORM pg_temp.check('prepare: an account scheduled for deletion is account_closing', v = 'account_closing', v);
END $$;
-- #endregion

ROLLBACK;
