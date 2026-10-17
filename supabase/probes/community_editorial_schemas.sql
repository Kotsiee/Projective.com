-- =============================================================================================
-- Probe: the `editorial` and `community` schemas and the moved newsletter opt-in (Decision #274).
--
--   1. Both schemas exist, every client role holds USAGE on both, and no client role holds a
--      table privilege or an EXECUTE grant there that a surface region did not name.
--   2. comms.newsletter_subscriptions is gone; community.newsletter_subscriptions has RLS on, NO
--      policy, and no privilege for `anon` or `authenticated` — signed out or in, a client can
--      neither read nor write it, and cannot call its writer.
--   3. community.subscribe_newsletter, as the service role: created → unchanged → topic_added →
--      unchanged → resubscribed, the address lowercased, the topic set sorted and distinct, and an
--      unchanged repeat writing nothing.
--   4. The topic CHECK: an unknown topic, an empty set and a NULL element are refused (23514), as
--      are an unknown source and a malformed address (22023).
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

    -- No client privilege of any kind on the subscriber list.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF has_table_privilege(v_role, 'community.newsletter_subscriptions', v_priv) THEN
                v_fail := v_fail || format('%s holds %s on community.newsletter_subscriptions', v_role, v_priv);
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
    RAISE NOTICE 'PASS schemas, USAGE, RLS, no policy, no client privilege, writer granted to service_role only';
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

    UPDATE community.newsletter_subscriptions
    SET unsubscribed_at = now(), unsubscribed_reason = 'probe', confirmed_at = now()
    WHERE id = v_row.id;
    v_out := community.subscribe_newsletter('probe.person@example.com', 'explore', 'changelog');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'resubscribed' OR (v_out->>'already_subscribed')::boolean
        OR v_row.topics <> ARRAY['changelog'] OR v_row.unsubscribed_at IS NOT NULL
        OR v_row.unsubscribed_reason IS NOT NULL OR v_row.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL resubscribe: % topics=% unsub=% confirmed=%',
            v_out, v_row.topics, v_row.unsubscribed_at, v_row.confirmed_at;
    END IF;
    RAISE NOTICE 'PASS resubscribed with only the requested topic, re-confirmation required';

    v_out := community.subscribe_newsletter('probe.defaults@example.com', NULL, NULL);
    IF v_out->>'outcome' <> 'created' OR v_out->>'topic' <> 'general' THEN
        RAISE EXCEPTION 'FAIL NULL topic/source defaults: %', v_out;
    END IF;
    RAISE NOTICE 'PASS NULL source/topic fall back to footer/general';
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
        'SELECT community.subscribe_newsletter(''probe-c8@example.com'', ''nowhere'', ''general'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL accepted: %', v_sql;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS refused [%]: %', SQLSTATE, v_sql;
        END;
    END LOOP;

    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT community.subscribe_newsletter(''not-an-address'', ''footer'', ''general'')',
        'SELECT community.subscribe_newsletter(''   '', ''footer'', ''general'')',
        'SELECT community.subscribe_newsletter(NULL, ''footer'', ''general'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL accepted: %', v_sql;
        EXCEPTION WHEN invalid_parameter_value THEN
            RAISE NOTICE 'PASS refused [%]: %', SQLSTATE, v_sql;
        END;
    END LOOP;
END $$;
-- #endregion

ROLLBACK;
