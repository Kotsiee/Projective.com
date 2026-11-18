-- =============================================================================================
-- Probe: promoted placements — marketplace.promote_listing, stop_listing_promotion,
-- get_listing_promotion and the retired discovery_boost entitlement (00001176, Decision #454).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/promoted_placements.sql
--
-- Every expected refusal is asserted by its SQLSTATE. Fixtures are discovered from the seed
-- (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- An adult entitled person with two published personal listings; an adult unentitled person with one;
-- an adult stranger who manages neither; an entitled team with two published listings and the member
-- who created them.
DO $$
DECLARE
    v_pro uuid;
    v_pro_a uuid;
    v_pro_b uuid;
    v_free uuid;
    v_free_listing uuid;
    v_stranger uuid;
    v_team uuid;
    v_team_member uuid;
    v_team_a uuid;
    v_team_b uuid;
BEGIN
    SELECT l.owner_user_id INTO v_pro
      FROM catalogue.listings l
     WHERE l.owner_team_id IS NULL AND l.status = 'published'
       AND finance.fn_has_entitlement('user', l.owner_user_id, 'promoted_placement')
       AND NOT org.fn_is_minor(l.owner_user_id)
     GROUP BY l.owner_user_id HAVING count(*) >= 2
     ORDER BY l.owner_user_id LIMIT 1;
    SELECT l.id INTO v_pro_a FROM catalogue.listings l
     WHERE l.owner_user_id = v_pro AND l.owner_team_id IS NULL AND l.status = 'published' ORDER BY l.id LIMIT 1;
    SELECT l.id INTO v_pro_b FROM catalogue.listings l
     WHERE l.owner_user_id = v_pro AND l.owner_team_id IS NULL AND l.status = 'published' AND l.id <> v_pro_a
     ORDER BY l.id LIMIT 1;

    SELECT l.owner_user_id, l.id INTO v_free, v_free_listing
      FROM catalogue.listings l
     WHERE l.owner_team_id IS NULL AND l.status = 'published'
       AND NOT finance.fn_has_entitlement('user', l.owner_user_id, 'promoted_placement')
       AND NOT org.fn_is_minor(l.owner_user_id)
     ORDER BY l.owner_user_id, l.id LIMIT 1;

    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_pro, v_free) AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM catalogue.listings l WHERE l.owner_user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;

    SELECT l.owner_team_id, l.owner_user_id INTO v_team, v_team_member
      FROM catalogue.listings l
     WHERE l.owner_team_id IS NOT NULL AND l.status = 'published'
       AND finance.fn_has_entitlement('team', l.owner_team_id, 'promoted_placement')
       AND NOT org.fn_is_minor(l.owner_user_id)
     GROUP BY l.owner_team_id, l.owner_user_id HAVING count(*) >= 2
     ORDER BY l.owner_team_id LIMIT 1;
    SELECT l.id INTO v_team_a FROM catalogue.listings l
     WHERE l.owner_team_id = v_team AND l.status = 'published' ORDER BY l.id LIMIT 1;
    SELECT l.id INTO v_team_b FROM catalogue.listings l
     WHERE l.owner_team_id = v_team AND l.status = 'published' AND l.id <> v_team_a ORDER BY l.id LIMIT 1;

    IF v_pro_b IS NULL OR v_free_listing IS NULL OR v_stranger IS NULL OR v_team_b IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: pro=% pro_b=% free=% stranger=% team=% team_b=%',
            v_pro, v_pro_b, v_free, v_stranger, v_team, v_team_b;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_team_member, 'role', 'authenticated')::text, true);
    IF NOT catalogue.fn_manages_listing(v_team_a) THEN
        RAISE EXCEPTION 'FAIL fixture: the team listing''s creator % cannot manage it', v_team_member;
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);

    -- Start the person's slot empty; the team keeps whatever the seed left live.
    UPDATE marketplace.promoted_placements pp SET cancelled_at = now()
      FROM catalogue.listings l
     WHERE l.owner_user_id = v_pro AND l.owner_team_id IS NULL
       AND pp.entity_id = COALESCE(l.service_blueprint_id, l.product_id)
       AND pp.cancelled_at IS NULL AND pp.starts_at <= now() AND pp.ends_at > now();

    PERFORM set_config('probe.pro', v_pro::text, true);
    PERFORM set_config('probe.pro_a', v_pro_a::text, true);
    PERFORM set_config('probe.pro_b', v_pro_b::text, true);
    PERFORM set_config('probe.free', v_free::text, true);
    PERFORM set_config('probe.free_listing', v_free_listing::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    PERFORM set_config('probe.team', v_team::text, true);
    PERFORM set_config('probe.team_member', v_team_member::text, true);
    PERFORM set_config('probe.team_a', v_team_a::text, true);
    PERFORM set_config('probe.team_b', v_team_b::text, true);
    RAISE NOTICE 'fixture pro=% free=% stranger=% team=% member=%', v_pro, v_free, v_stranger, v_team, v_team_member;
END $$;
-- #endregion

-- #region 1. Grants — no guest door, no client call to the internals
SET LOCAL ROLE anon;
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT marketplace.promote_listing(%L, ''explore_home'')', current_setting('probe.pro_a')),
        format('SELECT marketplace.stop_listing_promotion(%L)', current_setting('probe.pro_a')),
        format('SELECT marketplace.get_listing_promotion(%L)', current_setting('probe.pro_a'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused: %', v_sql;
        END;
    END LOOP;
    BEGIN
        INSERT INTO marketplace.promoted_placements (sponsor_user_id, entity_type, entity_id, ends_at)
        VALUES (current_setting('probe.pro')::uuid, 'product', gen_random_uuid(), now() + interval '1 day');
        RAISE EXCEPTION 'FAIL anon wrote the ledger';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS anon cannot write the ledger';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.pro'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM marketplace.fn_live_listing_promotions(NULL, current_setting('probe.pro')::uuid);
        RAISE EXCEPTION 'FAIL authenticated called the live lookup';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the live lookup is internal';
    END;
    BEGIN
        PERFORM marketplace.fn_promotion_flight();
        RAISE EXCEPTION 'FAIL authenticated called the flight length';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the flight length is internal';
    END;
    BEGIN
        INSERT INTO marketplace.promoted_placements (sponsor_user_id, entity_type, entity_id, ends_at)
        VALUES (current_setting('probe.pro')::uuid, 'product', gen_random_uuid(), now() + interval '1 day');
        RAISE EXCEPTION 'FAIL a seller wrote the ledger directly';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a seller cannot write the ledger directly';
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. Refusals
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.free'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM marketplace.promote_listing(current_setting('probe.free_listing')::uuid, 'explore_home');
        RAISE EXCEPTION 'FAIL a seller without the entitlement promoted';
    EXCEPTION WHEN SQLSTATE 'PK402' THEN
        RAISE NOTICE 'PASS no entitlement refused PK402 (%)', SQLERRM;
    END;
    IF (marketplace.get_listing_promotion(current_setting('probe.free_listing')::uuid) ->> 'entitled')::boolean THEN
        RAISE EXCEPTION 'FAIL the read calls an unentitled seller entitled';
    END IF;
    RAISE NOTICE 'PASS the read reports entitled=false';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM marketplace.promote_listing(current_setting('probe.pro_a')::uuid, 'explore_home');
        RAISE EXCEPTION 'FAIL a stranger promoted someone else''s listing';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        RAISE NOTICE 'PASS a stranger refused 42501';
    END;
    BEGIN
        PERFORM marketplace.get_listing_promotion(current_setting('probe.pro_a')::uuid);
        RAISE EXCEPTION 'FAIL a stranger read another seller''s promotion';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        RAISE NOTICE 'PASS a stranger cannot read it';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.pro'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_surface text;
BEGIN
    FOREACH v_surface IN ARRAY ARRAY['view_rail', 'sidebar', NULL] LOOP
        BEGIN
            PERFORM marketplace.promote_listing(current_setting('probe.pro_a')::uuid, v_surface);
            RAISE EXCEPTION 'FAIL surface % accepted', v_surface;
        EXCEPTION WHEN SQLSTATE '22023' THEN
            RAISE NOTICE 'PASS surface % refused 22023', v_surface;
        END;
    END LOOP;
    BEGIN
        PERFORM marketplace.promote_listing(gen_random_uuid(), 'explore_home');
        RAISE EXCEPTION 'FAIL an unknown listing promoted';
    EXCEPTION WHEN SQLSTATE 'PB404' THEN
        RAISE NOTICE 'PASS unknown listing refused PB404';
    END;
    BEGIN
        PERFORM marketplace.stop_listing_promotion(current_setting('probe.pro_a')::uuid);
        RAISE EXCEPTION 'FAIL stopped a promotion that is not running';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS nothing to stop refused PC409';
    END;
END $$;
RESET ROLE;

UPDATE catalogue.listings SET status = 'paused' WHERE id = current_setting('probe.pro_b')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.pro'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM marketplace.promote_listing(current_setting('probe.pro_b')::uuid, 'explore_home');
        RAISE EXCEPTION 'FAIL an unpublished listing promoted';
    EXCEPTION WHEN SQLSTATE 'PG422' THEN
        RAISE NOTICE 'PASS unpublished refused PG422';
    END;
END $$;
RESET ROLE;
UPDATE catalogue.listings SET status = 'published' WHERE id = current_setting('probe.pro_b')::uuid;
-- #endregion

-- #region 3. One live 7-day flight, charged nothing; stop; promote again
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.pro'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
    v_row marketplace.promoted_placements;
    v_read jsonb;
BEGIN
    v_out := marketplace.promote_listing(current_setting('probe.pro_a')::uuid, 'explore_results');
    PERFORM set_config('probe.placement_a', v_out ->> 'placement_id', true);
    SELECT * INTO v_row FROM marketplace.promoted_placements WHERE id = (v_out ->> 'placement_id')::uuid;
    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'FAIL the promoted placement is not readable by its sponsor';
    END IF;
    IF v_row.ends_at - v_row.starts_at <> interval '7 days' OR v_row.spend_cents <> 0
        OR v_row.surface <> 'explore_results' OR v_row.sponsor_user_id <> current_setting('probe.pro')::uuid THEN
        RAISE EXCEPTION 'FAIL the placement row is wrong: %', row_to_json(v_row);
    END IF;
    RAISE NOTICE 'PASS a 7-day explore_results flight, spend 0, sponsored by the caller';

    v_read := marketplace.get_listing_promotion(current_setting('probe.pro_a')::uuid);
    IF NOT (v_read ->> 'entitled')::boolean OR v_read -> 'live' ->> 'placement_id' <> v_out ->> 'placement_id'
        OR (v_read ->> 'flight_days')::integer <> 7 OR v_read -> 'elsewhere' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'FAIL the read of the promoted listing: %', v_read;
    END IF;
    v_read := marketplace.get_listing_promotion(current_setting('probe.pro_b')::uuid);
    IF v_read -> 'live' <> 'null'::jsonb OR (v_read -> 'elsewhere' ->> 'listing_id')::uuid <> current_setting('probe.pro_a')::uuid THEN
        RAISE EXCEPTION 'FAIL the other listing does not see the live slot elsewhere: %', v_read;
    END IF;
    RAISE NOTICE 'PASS the read reports the live slot here and elsewhere';

    BEGIN
        PERFORM marketplace.promote_listing(current_setting('probe.pro_b')::uuid, 'explore_home');
        RAISE EXCEPTION 'FAIL a second live placement for one seller';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS one live placement per seller: PC409 (%)', SQLERRM;
    END;
    BEGIN
        PERFORM marketplace.promote_listing(current_setting('probe.pro_a')::uuid, 'explore_home');
        RAISE EXCEPTION 'FAIL the same listing promoted twice';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS the same listing cannot stack a second surface';
    END;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF NOT (SELECT promoted FROM catalogue.listings WHERE id = current_setting('probe.pro_a')::uuid) THEN
        RAISE EXCEPTION 'FAIL the console flag was not set';
    END IF;
    RAISE NOTICE 'PASS the console flag follows the promotion';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM marketplace.stop_listing_promotion(current_setting('probe.pro_a')::uuid);
        RAISE EXCEPTION 'FAIL a stranger stopped someone else''s promotion';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        RAISE NOTICE 'PASS a stranger cannot stop it';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.pro'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := marketplace.stop_listing_promotion(current_setting('probe.pro_a')::uuid);
    IF (v_out ->> 'stopped')::integer <> 1 THEN
        RAISE EXCEPTION 'FAIL stop answered %', v_out;
    END IF;
    v_out := marketplace.promote_listing(current_setting('probe.pro_b')::uuid, 'explore_home');
    IF v_out ->> 'placement_id' IS NULL THEN
        RAISE EXCEPTION 'FAIL the slot did not free after a stop';
    END IF;
    RAISE NOTICE 'PASS a stopped slot frees for another listing';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_row marketplace.promoted_placements;
BEGIN
    SELECT * INTO v_row FROM marketplace.promoted_placements WHERE id = current_setting('probe.placement_a')::uuid;
    IF v_row.cancelled_at IS NULL THEN
        RAISE EXCEPTION 'FAIL the stopped placement was not kept with its cancellation';
    END IF;
    IF (SELECT promoted FROM catalogue.listings WHERE id = current_setting('probe.pro_a')::uuid) THEN
        RAISE EXCEPTION 'FAIL the console flag outlived the stop';
    END IF;
    RAISE NOTICE 'PASS a stop keeps the row and clears the console flag';
END $$;
-- #endregion

-- #region 4. A team's one slot is the team's, across its listings
UPDATE marketplace.promoted_placements pp SET cancelled_at = now()
  FROM catalogue.listings l
 WHERE l.owner_team_id = current_setting('probe.team')::uuid
   AND pp.entity_type = l.kind::text AND pp.entity_id = COALESCE(l.service_blueprint_id, l.product_id)
   AND pp.cancelled_at IS NULL AND pp.starts_at <= now() AND pp.ends_at > now();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.team_member'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_read jsonb;
BEGIN
    v_read := marketplace.get_listing_promotion(current_setting('probe.team_a')::uuid);
    IF v_read ->> 'subject' <> 'team' OR NOT (v_read ->> 'entitled')::boolean OR v_read -> 'live' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'FAIL the team listing read: %', v_read;
    END IF;
    PERFORM marketplace.promote_listing(current_setting('probe.team_a')::uuid, 'explore_home');
    BEGIN
        PERFORM marketplace.promote_listing(current_setting('probe.team_b')::uuid, 'explore_results');
        RAISE EXCEPTION 'FAIL a team ran two live placements';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS a team holds one live placement across its listings';
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 5. A comped entitlement allocates the slot; discovery_boost is retired
INSERT INTO finance.entitlement_grants (subject_type, subject_id, entitlement_key, flag_value, reason)
VALUES ('user', current_setting('probe.free')::uuid, 'promoted_placement', true, 'probe');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.free'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := marketplace.promote_listing(current_setting('probe.free_listing')::uuid, 'explore_home');
    IF v_out ->> 'placement_id' IS NULL THEN
        RAISE EXCEPTION 'FAIL a granted entitlement did not allocate the slot';
    END IF;
    RAISE NOTICE 'PASS an entitlement grant allocates the slot';
END $$;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM finance.plan_entitlements
         WHERE entitlement_key = 'discovery_boost' AND flag_value IS TRUE
    ) THEN
        RAISE EXCEPTION 'FAIL a plan still grants the retired discovery_boost flag';
    END IF;
    RAISE NOTICE 'PASS no plan grants discovery_boost';
END $$;
-- #endregion

ROLLBACK;
