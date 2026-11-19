-- =============================================================================================
-- 00001660_functions_ops_alerts.sql — money and job alerts (Category 1; MR4, Decision #461).
-- The rules and deliveries are `ops.alert_rules` / `ops.alert_deliveries` / `ops.alert_seen`
-- (00000013). `ops.fn_claim_alerts` folds every new server log row a rule matches into one delivery
-- per scope and fingerprint per dedupe window, raises the dead-man switches and leases what is due;
-- the `ops-deliver-alerts` job (00005060) runs it through `POST /api/ops/cron/alerts`
-- (`OpsAlertService`), which sends and then records each outcome through
-- `ops.fn_record_alert_delivery`. Operators read the result on /admin/ledger
-- (`ops.read_alert_deliveries`). Nothing here sends anything itself. Triggers in 00001897, grants in
-- 00002510, the rules in 00005065.
-- =============================================================================================

-- #region 1. Grouping and the payload's figures
-- The fingerprint that groups a scope's rows into one alert: the most specific id the row names (a
-- wallet, a card payment, a conversion, an escrow, a chargeback), else a scheduler row's job and
-- reason, else the currency, else nothing (every row of the scope is one group). Never a run id, so
-- the same drift on two nights is one group. Internal.
CREATE OR REPLACE FUNCTION ops.fn_alert_fingerprint (p_scope text, p_data jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        p_data ->> 'wallet_id',
        p_data ->> 'payment_id',
        p_data ->> 'conversion_id',
        p_data ->> 'escrow_id',
        p_data ->> 'chargeback_id',
        CASE WHEN p_data ? 'job' THEN (p_data ->> 'job') || ':' || COALESCE(p_data ->> 'reason', '') END,
        p_data ->> 'currency',
        ''
    );
$$;

-- What a delivery may carry of a row: its figures (every number), its ids cut to 8 characters, and
-- the few labels that are vocabulary rather than content (currency, job, reason, kind, problem,
-- owner_type, status, outcome) when they look like a code. The message, and any other string, is left
-- behind, so a name, an email or a bank detail can never reach the webhook or the digest (MR4 step 5).
-- Internal.
CREATE OR REPLACE FUNCTION ops.fn_alert_sample (p_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.jsonb_object_agg(e.key,
               CASE WHEN pg_catalog.jsonb_typeof(e.value) = 'number' THEN e.value
                    WHEN (e.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN pg_catalog.to_jsonb(pg_catalog.left(e.value #>> '{}', 8))
                    ELSE e.value END
               ORDER BY e.key), '{}'::jsonb)
      FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(p_data) = 'object' THEN p_data ELSE '{}'::jsonb END) e
     WHERE pg_catalog.jsonb_typeof(e.value) = 'number'
        OR (pg_catalog.jsonb_typeof(e.value) = 'string'
            AND ((e.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR (e.key = ANY (ARRAY['currency', 'job', 'reason', 'kind', 'problem', 'owner_type', 'status', 'outcome'])
                     AND (e.value #>> '{}') ~ '^[A-Za-z0-9_.:-]{1,64}$')));
$$;

-- A fingerprint for a person to read: an id cut to 8 characters, anything else as it is.
CREATE OR REPLACE FUNCTION ops.fn_alert_short (p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' THEN pg_catalog.left(p_value, 8) ELSE p_value END;
$$;
-- #endregion

-- #region 2. The record is kept
-- A delivery and the claim's cursor are the record of what was sent: never deleted, for every role.
-- Bound BEFORE DELETE (per row) and BEFORE TRUNCATE (per statement) in 00001897.
CREATE OR REPLACE FUNCTION ops.fn_alert_keep ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ops: % keeps every row — % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'PL403';
END;
$$;
-- #endregion

-- #region 3. The claim
-- One pass of the alert sweep, under one advisory lock so overlapping runs take turns:
--   1. every server row of `ops.log_entries` a `level` rule matches, written since the rule existed and
--      not yet folded by it (`ops.alert_seen`), joins the delivery its group opened inside the rule's
--      dedupe window, or opens a new one (`pending`); each fold is recorded, so a re-run folds nothing
--      twice;
--   2. each `silence` rule whose scope has written no server row for `max_silence` (counted from the
--      rule's creation while it never has) opens a delivery once per window — the dead-man switch;
--   3. at most `p_limit` (1–500) pending deliveries whose next attempt is due are leased for 5 minutes
--      and returned for the service to send.
-- Returns `{folded, opened, silent, deliveries: [{id, channel, scope, fingerprint, level, count,
-- first_seen, last_seen, attempts, sample}]}`, fingerprints cut to 8 characters. Service role /
-- pg_cron only.
CREATE OR REPLACE FUNCTION ops.fn_claim_alerts (p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
    ru ops.alert_rules;
    d ops.alert_deliveries;
    v_fp text;
    v_key text;
    v_last timestamptz;
    v_since timestamptz;
    v_folded integer := 0;
    v_opened integer := 0;
    v_silent integer := 0;
    v_claimed jsonb;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops.fn_claim_alerts', 0));

    FOR r IN
        SELECT l.id, l.scope, l.level, l.created_at, l.data,
               x.id AS rule_id, x.channel, x.dedupe_window
          FROM ops.alert_rules x
          JOIN ops.log_entries l
            ON l.source = 'server'
           AND l.scope LIKE x.scope_pattern
           AND (l.level = 'error' OR (x.min_level = 'warn' AND l.level = 'warn'))
           AND l.created_at >= x.created_at
         WHERE x.enabled AND x.kind = 'level'
           AND NOT EXISTS (SELECT 1 FROM ops.alert_seen s WHERE s.log_entry_id = l.id AND s.rule_id = x.id)
         ORDER BY l.created_at, l.id
         LIMIT 5000
    LOOP
        v_fp := ops.fn_alert_fingerprint(r.scope, r.data);
        v_key := r.scope || ':' || v_fp;
        SELECT * INTO d FROM ops.alert_deliveries x
         WHERE x.rule_id = r.rule_id AND x.group_key = v_key AND x.window_ends_at > r.created_at
         ORDER BY x.created_at DESC
         LIMIT 1
           FOR UPDATE;
        IF FOUND THEN
            UPDATE ops.alert_deliveries
               SET count = count + 1,
                   last_seen = GREATEST(last_seen, r.created_at),
                   level = CASE WHEN r.level = 'error' THEN 'error' ELSE level END,
                   sample = ops.fn_alert_sample(r.data)
             WHERE id = d.id;
            v_folded := v_folded + 1;
        ELSE
            INSERT INTO ops.alert_deliveries (
                rule_id, channel, group_key, scope, fingerprint, level, first_seen, last_seen,
                window_ends_at, sample
            ) VALUES (
                r.rule_id, r.channel, v_key, r.scope, v_fp, r.level, r.created_at, r.created_at,
                r.created_at + r.dedupe_window, ops.fn_alert_sample(r.data)
            )
            RETURNING * INTO d;
            v_opened := v_opened + 1;
        END IF;
        INSERT INTO ops.alert_seen (log_entry_id, rule_id, delivery_id) VALUES (r.id, r.rule_id, d.id);
    END LOOP;

    FOR ru IN SELECT * FROM ops.alert_rules x WHERE x.enabled AND x.kind = 'silence' ORDER BY x.scope_pattern, x.channel LOOP
        SELECT pg_catalog.max(l.created_at) INTO v_last
          FROM ops.log_entries l
         WHERE l.scope = ru.scope_pattern AND l.source = 'server';
        v_since := GREATEST(COALESCE(v_last, ru.created_at), ru.created_at);
        CONTINUE WHEN pg_catalog.now() - v_since <= ru.max_silence;
        v_key := 'silence:' || ru.scope_pattern;
        SELECT * INTO d FROM ops.alert_deliveries x
         WHERE x.rule_id = ru.id AND x.group_key = v_key AND x.window_ends_at > pg_catalog.now()
         ORDER BY x.created_at DESC
         LIMIT 1
           FOR UPDATE;
        IF FOUND THEN
            UPDATE ops.alert_deliveries
               SET last_seen = pg_catalog.now(),
                   sample = pg_catalog.jsonb_build_object('silent_minutes',
                       pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.now() - v_since) / 60)::bigint)
             WHERE id = d.id;
        ELSE
            INSERT INTO ops.alert_deliveries (
                rule_id, channel, group_key, scope, fingerprint, level, first_seen, last_seen,
                window_ends_at, sample
            ) VALUES (
                ru.id, ru.channel, v_key, ru.scope_pattern, 'silence', 'error', pg_catalog.now(), pg_catalog.now(),
                pg_catalog.now() + ru.dedupe_window,
                pg_catalog.jsonb_build_object('silent_minutes',
                    pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.now() - v_since) / 60)::bigint)
            );
            v_silent := v_silent + 1;
        END IF;
    END LOOP;

    WITH due AS (
        SELECT x.id
          FROM ops.alert_deliveries x
         WHERE x.status = 'pending'
           AND x.next_attempt_at <= pg_catalog.now()
           AND (x.lease_until IS NULL OR x.lease_until < pg_catalog.now())
         ORDER BY x.next_attempt_at, x.created_at, x.id
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
           FOR UPDATE SKIP LOCKED
    ), leased AS (
        UPDATE ops.alert_deliveries x
           SET lease_until = pg_catalog.now() + interval '5 minutes'
          FROM due
         WHERE x.id = due.id
        RETURNING x.*
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', l.id,
               'channel', l.channel,
               'scope', l.scope,
               'fingerprint', ops.fn_alert_short(l.fingerprint),
               'level', l.level,
               'count', l.count,
               'first_seen', l.first_seen,
               'last_seen', l.last_seen,
               'attempts', l.attempts,
               'sample', l.sample
           ) ORDER BY l.channel, l.scope, l.first_seen), '[]'::jsonb)
      INTO v_claimed
      FROM leased l;

    RETURN pg_catalog.jsonb_build_object(
        'folded', v_folded, 'opened', v_opened, 'silent', v_silent, 'deliveries', v_claimed
    );
END;
$$;

COMMENT ON FUNCTION ops.fn_claim_alerts(integer) IS
'One pass of the alert sweep (MR4, Decision #461): folds every new server log row a level rule
matches into one delivery per scope and fingerprint per dedupe window, opens a dead-man delivery for
each silent scope, and leases up to p_limit due pending deliveries for 5 minutes. Idempotent on
ops.alert_seen. Service role / pg_cron only.';

-- One send's outcome. A success marks the delivery `sent`; a failure keeps it `pending`, counts the
-- attempt, keeps the error's code (never a body, at most 120 characters) and pushes the next attempt
-- out: 2, 4, 8 … minutes, at most 6 hours. Either way the lease is released. A delivery already
-- `sent` is answered as it is (`replayed`), so a retried record never re-opens it. Service role only.
CREATE OR REPLACE FUNCTION ops.fn_record_alert_delivery (p_delivery uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    d ops.alert_deliveries;
BEGIN
    SELECT * INTO d FROM ops.alert_deliveries x WHERE x.id = p_delivery FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ops: alert delivery % does not exist', p_delivery USING ERRCODE = 'P0002';
    END IF;
    IF d.status = 'sent' THEN
        RETURN pg_catalog.jsonb_build_object('id', d.id, 'status', d.status, 'attempts', d.attempts, 'replayed', true);
    END IF;
    IF p_ok THEN
        UPDATE ops.alert_deliveries
           SET status = 'sent', sent_at = pg_catalog.now(), attempts = attempts + 1,
               lease_until = NULL, last_error = NULL
         WHERE id = d.id
        RETURNING * INTO d;
    ELSE
        UPDATE ops.alert_deliveries
           SET attempts = attempts + 1,
               lease_until = NULL,
               last_error = pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_error), ''), 'failed'), 120),
               next_attempt_at = pg_catalog.now()
                   + LEAST(interval '1 minute' * pg_catalog.power(2, LEAST(d.attempts + 1, 12)), interval '6 hours')
         WHERE id = d.id
        RETURNING * INTO d;
    END IF;
    RETURN pg_catalog.jsonb_build_object('id', d.id, 'status', d.status, 'attempts', d.attempts,
        'next_attempt_at', d.next_attempt_at, 'replayed', false);
END;
$$;
-- #endregion

-- #region 4. The operator read
-- /admin/ledger's Alerts section: security.is_admin() only, else 42501 (the page answers 404, as
-- /admin/disputes does, Decision #212). `{as_of, pending, rules, silence, deliveries}`: the rules; for
-- each dead-man scope, when it last wrote a server row; the 50 newest deliveries with their state.
-- Fingerprints cut to 8 characters; no message. Reads only.
CREATE OR REPLACE FUNCTION ops.read_alert_deliveries ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can read alert deliveries' USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'as_of', pg_catalog.now(),
        'pending', (SELECT pg_catalog.count(*) FROM ops.alert_deliveries x WHERE x.status = 'pending'),
        'rules', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'kind', x.kind,
                       'scope', x.scope_pattern,
                       'min_level', x.min_level,
                       'max_silence_minutes', (pg_catalog.date_part('epoch', x.max_silence) / 60)::bigint,
                       'channel', x.channel,
                       'dedupe_window_minutes', (pg_catalog.date_part('epoch', x.dedupe_window) / 60)::bigint,
                       'enabled', x.enabled
                   ) ORDER BY x.kind, x.scope_pattern, x.channel)
              FROM ops.alert_rules x
        ), '[]'::jsonb),
        'silence', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'scope', s.scope,
                       'last_row_at', (SELECT pg_catalog.max(l.created_at) FROM ops.log_entries l
                                        WHERE l.scope = s.scope AND l.source = 'server')
                   ) ORDER BY s.scope)
              FROM (SELECT DISTINCT x.scope_pattern AS scope FROM ops.alert_rules x WHERE x.kind = 'silence') s
        ), '[]'::jsonb),
        'deliveries', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', d.id,
                       'channel', d.channel,
                       'scope', d.scope,
                       'fingerprint', ops.fn_alert_short(d.fingerprint),
                       'level', d.level,
                       'count', d.count,
                       'first_seen', d.first_seen,
                       'last_seen', d.last_seen,
                       'status', d.status,
                       'attempts', d.attempts,
                       'next_attempt_at', d.next_attempt_at,
                       'sent_at', d.sent_at,
                       'last_error', d.last_error
                   ) ORDER BY d.created_at DESC, d.id)
              FROM (SELECT * FROM ops.alert_deliveries x ORDER BY x.created_at DESC, x.id LIMIT 50) d
        ), '[]'::jsonb)
    );
END;
$$;
-- #endregion
