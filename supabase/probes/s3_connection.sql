-- =============================================================================================
-- Probe: the S3 credential form's two doors (PROJECTS FL2 step 4; Decision #314).
--
--   1. fn_open_s3_connection runs as the signed-in caller: a signed-out call and a switched-off
--      provider are refused; a second open answers the same pending row, bound to auth.uid().
--   2. fn_store_s3_connection writes only the named user's own pending S3 row: another user's id
--      writes nothing; an AWS bucket stores no secret; a stored row is not stored twice; a second
--      pending row naming the same bucket and prefix is the account key's 23505; an S3-compatible
--      endpoint's sealed key pair lands in the vault.
--   3. Grants: the caller may open and never store; the service role stores; anon neither.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   deno task test:probes s3_connection
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Helpers
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'PROBE FAIL: %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

/** Whether `p_sql` raises exactly `p_state`. */
CREATE FUNCTION pg_temp.refused(p_sql text, p_state text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        RETURN v_state = p_state;
    END;
    RETURN false;
END $$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.user_at(p_offset integer) RETURNS uuid LANGUAGE sql AS $$
    SELECT p.user_id FROM org.users_public p ORDER BY p.user_id OFFSET p_offset LIMIT 1;
$$;

CREATE FUNCTION pg_temp.aws_config() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'region', 'eu-west-2', 'bucket', 'probe-assets', 'prefix', 'briefs/', 'pathStyle', false,
        'roleArn', 'arn:aws:iam::123456789012:role/probe'
    );
$$;

-- A key pair as token-vault.ts seals it; the bytes mean nothing to SQL, only their columns do.
CREATE FUNCTION pg_temp.keys() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'key_id', 'env:00000000', 'wrapped_dek', '\xd0', 'wrapped_dek_nonce', '\xd1',
        'access_token_cipher', '\xaa', 'nonce', '\xa1',
        'api_secret_cipher', '\xcc', 'api_secret_nonce', '\xc1'
    );
$$;
-- #endregion

-- #region 1. Opening is the caller's own
DO $$
DECLARE
    v_ada uuid := pg_temp.user_at(0);
    v_first uuid;
    v_again uuid;
    c integrations.user_connections;
BEGIN
    DELETE FROM integrations.user_connections WHERE provider_slug = 's3' AND user_id = v_ada;

    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(
        pg_temp.refused('SELECT integrations.fn_open_s3_connection()', '42501'),
        'a signed-out caller opens nothing');

    PERFORM pg_temp.as_user(v_ada);
    UPDATE integrations.providers SET is_enabled = false WHERE slug = 's3';
    PERFORM pg_temp.check(
        pg_temp.refused('SELECT integrations.fn_open_s3_connection()', '55000'),
        'a switched-off provider opens nothing');
    UPDATE integrations.providers SET is_enabled = true WHERE slug = 's3';

    v_first := integrations.fn_open_s3_connection();
    v_again := integrations.fn_open_s3_connection();
    SELECT * INTO c FROM integrations.user_connections WHERE id = v_first;
    PERFORM pg_temp.check(v_first = v_again, 'a second open answers the same pending row');
    PERFORM pg_temp.check(
        c.user_id = v_ada AND c.provider_slug = 's3' AND c.status = 'pending'
        AND c.external_account_id IS NULL AND c.granted_kinds = '{}',
        'the pending row is bound to auth.uid() and grants nothing yet');
END $$;
-- #endregion

-- #region 2. Storing writes only the named user's own pending row
DO $$
DECLARE
    v_ada uuid := pg_temp.user_at(0);
    v_bob uuid := pg_temp.user_at(1);
    v_id uuid;
    v_second uuid;
    v_compatible uuid;
    c integrations.user_connections;
BEGIN
    SELECT id INTO v_id FROM integrations.user_connections
     WHERE provider_slug = 's3' AND user_id = v_ada AND status = 'pending';

    PERFORM pg_temp.check(
        NOT integrations.fn_store_s3_connection(
            v_id, v_bob, 'aws/probe-assets/briefs/', 'probe-assets/briefs/', pg_temp.aws_config(), NULL),
        'another user''s id stores nothing');
    PERFORM pg_temp.check(
        (SELECT status FROM integrations.user_connections WHERE id = v_id) = 'pending',
        'the row stays pending after a refused store');

    PERFORM pg_temp.check(
        integrations.fn_store_s3_connection(
            v_id, v_ada, 'aws/probe-assets/briefs/', 'probe-assets/briefs/', pg_temp.aws_config(), NULL),
        'the owner''s pending AWS row is stored');
    SELECT * INTO c FROM integrations.user_connections WHERE id = v_id;
    PERFORM pg_temp.check(
        c.status = 'active' AND c.granted_kinds = ARRAY['storage']::integrations.provider_kind[]
        AND c.config ->> 'roleArn' = 'arn:aws:iam::123456789012:role/probe'
        AND c.external_account_label = 'probe-assets/briefs/' AND c.connected_at IS NOT NULL,
        'an AWS row is active for files with its addressing');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.connection_secrets WHERE connection_id = v_id),
        'an AWS bucket stores no key: it is reached by its role');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.connection_audit
                 WHERE connection_id = v_id AND action = 'connected'),
        'the store writes its audit line');
    PERFORM pg_temp.check(
        NOT integrations.fn_store_s3_connection(
            v_id, v_ada, 'aws/other/', 'other', pg_temp.aws_config(), NULL),
        'a stored row is not stored twice');

    PERFORM pg_temp.as_user(v_ada);
    v_second := integrations.fn_open_s3_connection();
    PERFORM pg_temp.check(v_second <> v_id, 'with one bucket stored, a new open is a new pending row');
    PERFORM pg_temp.check(
        pg_temp.refused(format(
            'SELECT integrations.fn_store_s3_connection(%L, %L, %L, %L, %L, NULL)',
            v_second, v_ada, 'aws/probe-assets/briefs/', 'probe-assets/briefs/', pg_temp.aws_config()),
            '23505'),
        'the same bucket and prefix twice is the account key''s 23505');

    v_compatible := v_second;
    PERFORM pg_temp.check(
        integrations.fn_store_s3_connection(
            v_compatible, v_ada, 'https://minio.example.test/probe-assets/', 'probe-assets',
            jsonb_build_object('endpoint', 'https://minio.example.test', 'region', 'auto',
                'bucket', 'probe-assets', 'prefix', '', 'pathStyle', true),
            pg_temp.keys()),
        'an S3-compatible row is stored with its key pair');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.connection_secrets
                 WHERE connection_id = v_compatible AND api_secret_cipher IS NOT NULL
                   AND access_token_cipher IS NOT NULL AND refresh_token_cipher IS NULL),
        'its sealed key pair is in the vault, with no refresh token for the refresh job to claim');
END $$;
-- #endregion

-- #region 3. Grants
DO $$
BEGIN
    PERFORM pg_temp.check(
        has_function_privilege('authenticated', 'integrations.fn_open_s3_connection()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'integrations.fn_open_s3_connection()', 'EXECUTE'),
        'a signed-in caller opens; anon does not');
    PERFORM pg_temp.check(
        has_function_privilege('service_role',
            'integrations.fn_store_s3_connection(uuid, uuid, text, text, jsonb, jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated',
            'integrations.fn_store_s3_connection(uuid, uuid, text, text, jsonb, jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('anon',
            'integrations.fn_store_s3_connection(uuid, uuid, text, text, jsonb, jsonb)', 'EXECUTE'),
        'only the service role stores');
END $$;
-- #endregion

ROLLBACK;
