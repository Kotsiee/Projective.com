-- =============================================================================================
-- Probe: a business context is always a client context (Decision #230 (a), BUSINESSES_AUDIT BF4)
-- and the account facts the sidebar reads (BF3) — public.custom_access_token_hook's
-- `active_context` claim.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_context_flags.sql
--
-- Fixture (seeded data, adjusted inside the transaction): F, a freelancer with no business (seed
-- `lenamueller`), seated as a member of the seeded business B (`atlaslabs`); O, B's owner on the free
-- plan (`danielokafor`, `businesses_owned` 1 of 1). On a hook that copies the person's persona into a
-- business context, case 2 fails: the freelancer acting as the business mints `isClient = false`.
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- #region Helpers
-- The `active_context` claim the hook mints for p_user right now.
CREATE FUNCTION pg_temp.ctx(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT public.custom_access_token_hook(jsonb_build_object('user_id', p_user, 'claims', '{}'::jsonb))
           #> '{claims,app_metadata,active_context}';
$$;

-- Assert that every key of p_expected appears in p_actual with the same value.
CREATE FUNCTION pg_temp.expect(p_label text, p_actual jsonb, p_expected jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_actual IS NULL OR NOT (p_actual @> p_expected) THEN
        RAISE EXCEPTION 'FAIL %: expected % in %', p_label, p_expected, p_actual;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END;
$$;
-- #endregion

DO $$
DECLARE
    v_f uuid;
    v_o uuid;
    v_b uuid;
    v_member_role uuid;
BEGIN
    -- #region Fixture
    SELECT user_id INTO STRICT v_f FROM org.users_public WHERE username = 'lenamueller';
    SELECT user_id INTO STRICT v_o FROM org.users_public WHERE username = 'danielokafor';
    SELECT id INTO STRICT v_b FROM org.business_profiles WHERE slug = 'atlaslabs';
    SELECT id INTO STRICT v_member_role FROM org.business_roles WHERE business_id = v_b AND preset = 'member';

    UPDATE org.users_public SET is_freelancer = true, is_operator = false WHERE user_id = v_f;
    DELETE FROM security.session_context WHERE user_id IN (v_f, v_o);
    -- #endregion

    -- #region 1. The freelancer, personally, before any membership
    PERFORM pg_temp.expect(
        '1 freelancer personal: seller, no business, headroom to create one',
        pg_temp.ctx(v_f),
        '{"type":"personal","isFreelancer":true,"isClient":false,"belongsToBusiness":false,"businessHeadroom":true}'
    );
    -- #endregion

    -- #region 2. Seated in B and switched into it: the context is a client's
    INSERT INTO org.business_members (business_id, user_id, role_id, status)
    VALUES (v_b, v_f, v_member_role, 'active');
    INSERT INTO security.session_context (user_id, active_profile_type, active_profile_id)
    VALUES (v_f, 'business', v_b);
    PERFORM pg_temp.expect(
        '2 freelancer acting as a business: isClient true, isFreelancer false',
        pg_temp.ctx(v_f),
        '{"type":"business","isClient":true,"isFreelancer":false,"belongsToBusiness":true}'
    );
    -- #endregion

    -- #region 3. Switched back: the person's own persona returns
    UPDATE security.session_context SET active_profile_type = NULL, active_profile_id = NULL
     WHERE user_id = v_f;
    PERFORM pg_temp.expect(
        '3 switched back to personal: the freelancer flags are restored, the membership stays',
        pg_temp.ctx(v_f),
        '{"type":"personal","isFreelancer":true,"isClient":false,"belongsToBusiness":true}'
    );
    -- #endregion

    -- #region 4. The owner at the free plan's cap: a member without create headroom
    PERFORM pg_temp.expect(
        '4 owner at businesses_owned 1/1: belongs, no headroom',
        pg_temp.ctx(v_o),
        '{"belongsToBusiness":true,"businessHeadroom":false}'
    );
    -- #endregion

    -- #region 5. An archived business is no membership, and frees the owner's slot
    UPDATE org.business_profiles SET status = 'archived' WHERE id = v_b;
    PERFORM pg_temp.expect(
        '5a a seat in an archived business is not a business membership',
        pg_temp.ctx(v_f),
        '{"belongsToBusiness":false}'
    );
    PERFORM pg_temp.expect(
        '5b archiving the owner''s only business frees the slot',
        pg_temp.ctx(v_o),
        '{"businessHeadroom":true}'
    );
    -- #endregion
END;
$$;

ROLLBACK;
