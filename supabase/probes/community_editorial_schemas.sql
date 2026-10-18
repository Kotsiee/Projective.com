-- =============================================================================================
-- Probe: the `editorial` and `community` schemas and the moved newsletter opt-in (Decision #274).
--
--   1. Both schemas exist and every client role holds USAGE on both. RLS is on for every table of
--      both. No client role holds TRUNCATE on any table of either; on any `editorial` relation no
--      client role holds INSERT, UPDATE or DELETE (table- or column-level), and `editorial` carries
--      no policy other than FOR SELECT. Every function a client role may EXECUTE in either schema is
--      LISTED (INFO, not a failure), so a surface region's grant is visible in the run.
--   2. comms.newsletter_subscriptions is gone; community.newsletter_subscriptions has RLS on, NO
--      policy, and no privilege for `anon` or `authenticated` — signed out or in, a client can
--      neither read nor write it, and cannot call its writer.
--   3. community.subscribe_newsletter, as the service role: created → unchanged → topic_added →
--      unchanged → resubscribed → resubscribed, the address lowercased, the topic set sorted and
--      distinct, an unchanged repeat writing nothing, and a re-subscribe of an unsubscribed
--      address recording a pending request while the opt-out (unsubscribed_at, its reason) stays.
--   4. The CHECKs and the address guard: an unknown topic or source, an empty set, a NULL element,
--      an over-long address and a pending re-subscribe on a subscribed row are refused (23514);
--      the writer refuses a malformed, blank, NULL or over-long address (22023).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/community_editorial_schemas.sql
--
-- Every expected refusal is asserted: a statement that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS
-- notices. Needs no seed rows: the probe address is its own fixture.
-- =============================================================================================

BEGIN;

-- #region 1. Catalog assertions (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    v_role text;
    v_schema text;
    v_priv text;
    r record;
BEGIN
    FOREACH v_schema IN ARRAY ARRAY['editorial', 'community'] LOOP
        IF to_regnamespace(v_schema) IS NULL THEN
            RAISE EXCEPTION 'FAIL schema % does not exist', v_schema;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF NOT has_schema_privilege(v_role, v_schema, 'USAGE') THEN
                v_fail := v_fail || format('%s lacks USAGE on %s', v_role, v_schema);
            END IF;
        END LOOP;
    END LOOP;

    IF to_regclass('comms.newsletter_subscriptions') IS NOT NULL THEN
        v_fail := v_fail || 'comms.newsletter_subscriptions still exists'::text;
    END IF;
    IF to_regclass('community.newsletter_subscriptions') IS NULL THEN
        RAISE EXCEPTION 'FAIL community.newsletter_subscriptions does not exist';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'community.newsletter_subscriptions'::regclass) THEN
        v_fail := v_fail || 'RLS is off on community.newsletter_subscriptions'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'community' AND tablename = 'newsletter_subscriptions') THEN
        v_fail := v_fail || 'community.newsletter_subscriptions has a policy'::text;
    END IF;

    -- No client privilege of any kind on the subscriber list, table- or column-level.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF has_table_privilege(v_role, 'community.newsletter_subscriptions', v_priv) THEN
                v_fail := v_fail || format('%s holds %s on community.newsletter_subscriptions', v_role, v_priv);
            END IF;
        END LOOP;
        FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
            IF has_any_column_privilege(v_role, 'community.newsletter_subscriptions', v_priv) THEN
                v_fail := v_fail || format('%s holds column %s on community.newsletter_subscriptions', v_role, v_priv);
            END IF;
        END LOOP;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
        IF NOT has_table_privilege('service_role', 'community.newsletter_subscriptions', v_priv) THEN
            v_fail := v_fail || format('service_role lacks %s on community.newsletter_subscriptions', v_priv);
        END IF;
    END LOOP;

    -- TRUNCATE is never a client privilege in either schema, whatever a region grants.
    FOR r IN
        SELECT c.oid::regclass AS rel, rl.rolname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS rl (rolname)
        WHERE n.nspname IN ('editorial', 'community') AND c.relkind IN ('r', 'p', 'v', 'm')
            AND has_table_privilege(rl.rolname, c.oid, 'TRUNCATE')
    LOOP
        v_fail := v_fail || format('%s holds TRUNCATE on %s', r.rolname, r.rel);
    END LOOP;

    -- Editorial is read-only to clients, whatever a region adds: rows arrive through the generated
    -- seed migrations and the service role, so no client role writes a relation there (table- or
    -- column-level) and no policy there is anything but FOR SELECT.
    FOR r IN
        SELECT c.oid::regclass AS rel, rl.rolname, pv.priv
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS rl (rolname)
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS pv (priv)
        WHERE n.nspname = 'editorial' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND (
                has_table_privilege(rl.rolname, c.oid, pv.priv)
                OR (pv.priv <> 'DELETE' AND has_any_column_privilege(rl.rolname, c.oid, pv.priv))
            )
    LOOP
        v_fail := v_fail || format('%s holds %s on %s (editorial is read-only to clients)', r.rolname, r.priv, r.rel);
    END LOOP;
    FOR r IN
        SELECT format('%I.%I', schemaname, tablename) AS rel, policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'editorial' AND cmd <> 'SELECT'
    LOOP
        v_fail := v_fail || format('editorial policy %s on %s is FOR %s (only FOR SELECT is allowed)', r.policyname, r.rel, r.cmd);
    END LOOP;

    -- RLS on every table of both schemas.
    FOR r IN
        SELECT c.oid::regclass AS rel
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('editorial', 'community') AND c.relkind IN ('r', 'p')
            AND NOT c.relrowsecurity
    LOOP
        v_fail := v_fail || format('RLS is off on %s', r.rel);
    END LOOP;

    -- The writer: service role only.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF has_function_privilege(v_role, 'community.subscribe_newsletter(text,text,text)', 'EXECUTE') THEN
            v_fail := v_fail || format('%s may EXECUTE community.subscribe_newsletter', v_role);
        END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', 'community.subscribe_newsletter(text,text,text)', 'EXECUTE') THEN
        v_fail := v_fail || 'service_role may not EXECUTE community.subscribe_newsletter'::text;
    END IF;

    -- Deny by default: list every function in either schema a client role can execute, so a grant a
    -- surface region adds is visible here (and must be intended).
    FOR r IN
        SELECT p.oid::regprocedure AS fn, rl.rolname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS rl (rolname)
        WHERE n.nspname IN ('editorial', 'community')
            AND has_function_privilege(rl.rolname, p.oid, 'EXECUTE')
    LOOP
        RAISE NOTICE 'INFO % may EXECUTE % (granted by a surface region)', r.rolname, r.fn;
    END LOOP;

    IF to_regclass('community.idx_newsletter_subscriptions_topics_sendable') IS NULL THEN
        v_fail := v_fail || 'idx_newsletter_subscriptions_topics_sendable is missing'::text;
    END IF;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n     ');
    END IF;
    RAISE NOTICE 'PASS schemas, USAGE, RLS, no TRUNCATE, editorial read-only, newsletter closed, writer granted to service_role only';
END $$;
-- #endregion

-- #region 2. Signed-out and signed-in clients are refused at the privilege, before RLS
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT count(*) FROM community.newsletter_subscriptions',
        'INSERT INTO community.newsletter_subscriptions (email) VALUES (''probe-anon@example.com'')',
        'SELECT community.subscribe_newsletter(''probe-anon@example.com'', ''footer'', ''general'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon ran: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]: %', SQLSTATE, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT count(*) FROM community.newsletter_subscriptions',
        'INSERT INTO community.newsletter_subscriptions (email) VALUES (''probe-auth@example.com'')',
        'UPDATE community.newsletter_subscriptions SET topics = ARRAY[''general'']',
        'SELECT community.subscribe_newsletter(''probe-auth@example.com'', ''footer'', ''general'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL authenticated ran: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS authenticated refused [%]: %', SQLSTATE, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 3. The writer's four outcomes (as the service role)
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_out jsonb;
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_touched timestamptz;
BEGIN
    v_out := community.subscribe_newsletter('  Probe.Person@Example.COM ', 'footer', 'general');
    IF v_out->>'outcome' <> 'created' OR (v_out->>'already_subscribed')::boolean
        OR v_out->>'email' <> 'probe.person@example.com' OR v_out->>'topic' <> 'general' THEN
        RAISE EXCEPTION 'FAIL first subscribe: %', v_out;
    END IF;
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe.person@example.com';
    IF v_row.topics <> ARRAY['general'] OR v_row.source <> 'footer' OR v_row.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL created row: topics=% source=% confirmed=%', v_row.topics, v_row.source, v_row.confirmed_at;
    END IF;
    RAISE NOTICE 'PASS created: %', v_out;

    -- Make a repeat's no-write observable: backdate the row, then expect updated_at untouched.
    UPDATE community.newsletter_subscriptions SET updated_at = '2000-01-01T00:00:00Z'
    WHERE id = v_row.id;
    v_out := community.subscribe_newsletter('probe.person@example.com', 'landing', 'general');
    SELECT updated_at INTO v_touched FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'unchanged' OR NOT (v_out->>'already_subscribed')::boolean
        OR v_touched <> '2000-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'FAIL repeat subscribe: % (updated_at %)', v_out, v_touched;
    END IF;
    RAISE NOTICE 'PASS unchanged, nothing written: %', v_out;

    v_out := community.subscribe_newsletter('PROBE.person@example.com', 'landing', 'changelog');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'topic_added' OR (v_out->>'already_subscribed')::boolean
        OR v_row.topics <> ARRAY['changelog', 'general'] OR v_row.source <> 'footer'
        OR v_row.updated_at = '2000-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'FAIL topic add: % topics=% source=%', v_out, v_row.topics, v_row.source;
    END IF;
    RAISE NOTICE 'PASS topic_added, set sorted, first source kept: %', v_row.topics;

    v_out := community.subscribe_newsletter('probe.person@example.com', 'footer', 'changelog');
    IF v_out->>'outcome' <> 'unchanged' THEN
        RAISE EXCEPTION 'FAIL repeat topic: %', v_out;
    END IF;
    IF (SELECT count(*) FROM community.newsletter_subscriptions WHERE email = 'probe.person@example.com') <> 1 THEN
        RAISE EXCEPTION 'FAIL more than one row for one address';
    END IF;
    RAISE NOTICE 'PASS one row per address after four subscribes';

    -- The owner confirmed, then unsubscribed. A re-subscribe from the public form must not undo the
    -- opt-out: it records a pending request and leaves every other column as it was.
    UPDATE community.newsletter_subscriptions
    SET unsubscribed_at = '2026-01-02T03:04:05Z', unsubscribed_reason = 'probe',
        confirmed_at = '2026-01-01T00:00:00Z', updated_at = '2000-01-01T00:00:00Z'
    WHERE id = v_row.id;
    v_out := community.subscribe_newsletter('probe.person@example.com', 'explore', 'general');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'resubscribed' OR (v_out->>'already_subscribed')::boolean
        OR v_row.unsubscribed_at IS DISTINCT FROM '2026-01-02T03:04:05Z'::timestamptz
        OR v_row.unsubscribed_reason IS DISTINCT FROM 'probe'
        OR v_row.confirmed_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR v_row.topics <> ARRAY['changelog', 'general'] OR v_row.source <> 'footer'
        OR v_row.resubscribe_topics IS DISTINCT FROM ARRAY['general']
        OR v_row.resubscribe_requested_at IS NULL
        OR v_row.updated_at = '2000-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'FAIL resubscribe: % unsub=% reason=% confirmed=% topics=% pending=% at=%',
            v_out, v_row.unsubscribed_at, v_row.unsubscribed_reason, v_row.confirmed_at,
            v_row.topics, v_row.resubscribe_topics, v_row.resubscribe_requested_at;
    END IF;
    IF v_row.confirmed_at IS NOT NULL AND v_row.unsubscribed_at IS NULL THEN
        RAISE EXCEPTION 'FAIL a re-subscribe request made the row send-eligible';
    END IF;
    RAISE NOTICE 'PASS resubscribed: opt-out kept, request pending %, still unsendable', v_row.resubscribe_topics;

    v_out := community.subscribe_newsletter('probe.person@example.com', 'footer', 'changelog');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'resubscribed' OR (v_out->>'already_subscribed')::boolean
        OR v_row.resubscribe_topics IS DISTINCT FROM ARRAY['changelog', 'general']
        OR v_row.unsubscribed_at IS DISTINCT FROM '2026-01-02T03:04:05Z'::timestamptz THEN
        RAISE EXCEPTION 'FAIL second resubscribe: % pending=% unsub=%',
            v_out, v_row.resubscribe_topics, v_row.unsubscribed_at;
    END IF;
    RAISE NOTICE 'PASS a second request joins the pending set, sorted: %', v_row.resubscribe_topics;

    v_out := community.subscribe_newsletter('probe.defaults@example.com', NULL, NULL);
    IF v_out->>'outcome' <> 'created' OR v_out->>'topic' <> 'general' THEN
        RAISE EXCEPTION 'FAIL NULL topic/source defaults: %', v_out;
    END IF;
    RAISE NOTICE 'PASS NULL source/topic fall back to footer/general';

    -- 254 characters is the longest address accepted (RFC 5321); section 4 refuses 255.
    v_out := community.subscribe_newsletter(repeat('a', 242) || '@example.com', 'footer', 'general');
    IF v_out->>'outcome' <> 'created' OR char_length(v_out->>'email') <> 254 THEN
        RAISE EXCEPTION 'FAIL a 254-character address: %', left(v_out::text, 160);
    END IF;
    RAISE NOTICE 'PASS a 254-character address is accepted';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. The topic and source CHECKs, and the address guard
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'INSERT INTO community.newsletter_subscriptions (email, topics) VALUES (''probe-c1@example.com'', ARRAY[''weekly''])',
        'INSERT INTO community.newsletter_subscriptions (email, topics) VALUES (''probe-c2@example.com'', ''{}''::text[])',
        'INSERT INTO community.newsletter_subscriptions (email, topics) VALUES (''probe-c3@example.com'', ARRAY[NULL]::text[])',
        'INSERT INTO community.newsletter_subscriptions (email, topics) VALUES (''probe-c4@example.com'', ARRAY[''general'', NULL])',
        'INSERT INTO community.newsletter_subscriptions (email, source) VALUES (''probe-c5@example.com'', ''nowhere'')',
        'INSERT INTO community.newsletter_subscriptions (email) VALUES (''Probe-C6@Example.com'')',
        'SELECT community.subscribe_newsletter(''probe-c7@example.com'', ''footer'', ''weekly'')',
        'SELECT community.subscribe_newsletter(''probe-c8@example.com'', ''nowhere'', ''general'')',
        format('INSERT INTO community.newsletter_subscriptions (email) VALUES (%L)',
            repeat('a', 243) || '@example.com'),
        'INSERT INTO community.newsletter_subscriptions (email, resubscribe_topics, resubscribe_requested_at) VALUES (''probe-c9@example.com'', ARRAY[''general''], now())',
        'INSERT INTO community.newsletter_subscriptions (email, unsubscribed_at, resubscribe_topics) VALUES (''probe-c10@example.com'', now(), ARRAY[''general''])',
        'INSERT INTO community.newsletter_subscriptions (email, unsubscribed_at, resubscribe_topics, resubscribe_requested_at) VALUES (''probe-c11@example.com'', now(), ARRAY[''weekly''], now())',
        'INSERT INTO community.newsletter_subscriptions (email, unsubscribed_at, resubscribe_topics, resubscribe_requested_at) VALUES (''probe-c12@example.com'', now(), ''{}''::text[], now())'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL accepted: %', left(v_sql, 160);
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS refused [%]: %', SQLSTATE, left(v_sql, 160);
        END;
    END LOOP;

    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT community.subscribe_newsletter(''not-an-address'', ''footer'', ''general'')',
        'SELECT community.subscribe_newsletter(''   '', ''footer'', ''general'')',
        'SELECT community.subscribe_newsletter(NULL, ''footer'', ''general'')',
        format('SELECT community.subscribe_newsletter(%L, ''footer'', ''general'')',
            repeat('a', 243) || '@example.com'),
        format('SELECT community.subscribe_newsletter(%L, ''footer'', ''general'')',
            repeat('a', 6400) || '@example.com')
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL accepted: %', left(v_sql, 160);
        EXCEPTION WHEN invalid_parameter_value THEN
            RAISE NOTICE 'PASS refused [%]: %', SQLSTATE, left(v_sql, 160);
        END;
    END LOOP;
END $$;
-- #endregion

-- #region [editorial.shared] a readable editorial slug is permanent (Decision #274 (k))
CREATE TABLE editorial.probe_slug_guard (slug text PRIMARY KEY, title text NOT NULL);
CREATE TRIGGER trg_probe_slug_guard_slug_immutable BEFORE UPDATE OF slug ON editorial.probe_slug_guard
    FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();

DO $$
BEGIN
    INSERT INTO editorial.probe_slug_guard VALUES ('how-stage-funding-works', 'Before');
    UPDATE editorial.probe_slug_guard SET title = 'After' WHERE slug = 'how-stage-funding-works';
    INSERT INTO editorial.probe_slug_guard VALUES ('how-stage-funding-works', 'Upserted')
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title;
    RAISE NOTICE 'PASS a title edit and a by-slug upsert leave the slug alone';
    BEGIN
        UPDATE editorial.probe_slug_guard SET slug = 'stage-funding' WHERE slug = 'how-stage-funding-works';
        RAISE EXCEPTION 'FAIL a published editorial slug changed';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a slug change is refused [%]', SQLSTATE;
    END;
END $$;
-- #endregion

ROLLBACK;
