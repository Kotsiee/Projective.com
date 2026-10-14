-- =============================================================================================
-- Probe: what a listing's first publish fixes (Decision #217, work order C13) — save_listing lets a
-- never-published draft change its currency (mirrored onto its blueprint) and reshape its buyer
-- questions freely; once `published_at` is set, even back in draft, the currency is fixed and the
-- questions keep their ids, order and kinds while their wording and options still change
-- (00001170, ServiceCreation.md §1.1).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/catalogue_publish_locks.sql
--
-- Every expected refusal is asserted by its SQLSTATE and DETAIL inside its own exception block. A clean
-- run prints only PASS notices. The seller comes from the seed.
-- =============================================================================================

BEGIN;

-- #region 0. Fixture (as postgres) — an adult seller who owns a personal listing
DO $$
DECLARE
    v_seller uuid;
BEGIN
    SELECT l.owner_user_id INTO v_seller
      FROM catalogue.listings l
     WHERE l.owner_team_id IS NULL AND l.kind = 'service' AND NOT org.fn_is_minor(l.owner_user_id)
     ORDER BY l.id LIMIT 1;
    IF v_seller IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no adult seller with a personal service'; END IF;
    PERFORM set_config('probe.seller', v_seller::text, true);
    RAISE NOTICE 'fixture seller=%', v_seller;
END $$;
-- #endregion

-- #region 1. A never-published draft changes its currency and reshapes its questions
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_listing uuid;
    v_currency text;
    v_intake jsonb;
BEGIN
    v_listing := (catalogue.create_listing('service', 'Probe locks', 'one_off', NULL, 'USD') ->> 'listing_id')::uuid;
    PERFORM set_config('probe.listing', v_listing::text, true);

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'jpy', 'amount_cents', 5000));
    SELECT b.currency INTO v_currency FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    IF (SELECT currency FROM catalogue.listings WHERE id = v_listing) <> 'JPY' OR v_currency <> 'JPY' THEN
        RAISE EXCEPTION 'FAIL draft currency change: listing=% blueprint=%',
            (SELECT currency FROM catalogue.listings WHERE id = v_listing), v_currency;
    END IF;

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'EURO'));
        RAISE EXCEPTION 'FAIL a four-letter currency accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL bad currency: % %', SQLSTATE, SQLERRM; END IF;
    END;

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake', jsonb_build_array(
        jsonb_build_object('id', 'q1', 'kind', 'text', 'label', 'Deadline?', 'required', true,
            'options', '[]'::jsonb, 'multiple', false, 'slider', false),
        jsonb_build_object('id', 'q2', 'kind', 'radio', 'label', 'Style', 'required', false,
            'options', jsonb_build_array(jsonb_build_object('value', 'flat', 'label', 'Flat')),
            'multiple', false, 'slider', false))));
    SELECT b.intake_fields INTO v_intake FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake',
        jsonb_build_array(v_intake -> 1, v_intake -> 0)));
    IF (SELECT b.intake_fields -> 0 ->> 'id' FROM marketplace.service_blueprints b
          JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing) <> 'q2' THEN
        RAISE EXCEPTION 'FAIL a never-published draft could not reorder its questions';
    END IF;

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake', jsonb_build_object('id', 'q1')));
        RAISE EXCEPTION 'FAIL questions that are not a list accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL non-list intake: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS a never-published draft changes its currency (mirrored) and reorders its questions';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. First publish, then back to draft — published_at is what the locks read
DO $$
BEGIN
    UPDATE catalogue.listings SET published_at = now() - interval '1 day'
     WHERE id = current_setting('probe.listing')::uuid;
END $$;
-- #endregion

-- #region 3. After a first publish: the currency is fixed, the questions keep their shape
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_listing uuid := current_setting('probe.listing')::uuid;
    v_intake jsonb;
    v_detail text;
BEGIN
    IF (SELECT status FROM catalogue.listings WHERE id = v_listing) <> 'draft' THEN
        RAISE EXCEPTION 'FAIL fixture: the probe listing should still be a draft';
    END IF;

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'EUR'));
        RAISE EXCEPTION 'FAIL a published listing changed its currency';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        IF SQLSTATE <> '22023' OR v_detail <> 'currency' THEN
            RAISE EXCEPTION 'FAIL fixed currency: % % (%)', SQLSTATE, SQLERRM, v_detail;
        END IF;
    END;
    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'JPY', 'amount_cents', 6000));
    RAISE NOTICE 'PASS once published the currency is refused (22023 currency) unless it is unchanged';

    SELECT b.intake_fields INTO v_intake FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;

    -- reordered · one added · one removed · a kind changed · an id renamed
    FOR v_detail IN SELECT unnest(ARRAY['reorder', 'add', 'remove', 'kind', 'rename']) LOOP
        BEGIN
            PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake', CASE v_detail
                WHEN 'reorder' THEN jsonb_build_array(v_intake -> 1, v_intake -> 0)
                WHEN 'add' THEN v_intake || jsonb_build_array(jsonb_build_object('id', 'q3', 'kind', 'text', 'label', 'More?'))
                WHEN 'remove' THEN jsonb_build_array(v_intake -> 0)
                WHEN 'kind' THEN jsonb_set(v_intake, '{0,kind}', '"textarea"')
                ELSE jsonb_set(v_intake, '{0,id}', '"q9"')
            END));
            RAISE EXCEPTION 'FAIL a published listing accepted a question %', v_detail;
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> '22023' THEN
                RAISE EXCEPTION 'FAIL question %: % %', v_detail, SQLSTATE, SQLERRM;
            END IF;
        END;
    END LOOP;

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake',
        jsonb_set(jsonb_set(v_intake, '{0,label}', '"What is the deadline?"'),
                  '{1,options}', jsonb_build_array(
                      jsonb_build_object('value', 'flat', 'label', 'Flat colour'),
                      jsonb_build_object('value', 'line', 'label', 'Line art')))));
    IF (SELECT jsonb_array_length(b.intake_fields -> 1 -> 'options') FROM marketplace.service_blueprints b
          JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing) <> 2 THEN
        RAISE EXCEPTION 'FAIL rewording and a new option were not saved';
    END IF;
    RAISE NOTICE 'PASS once published the questions keep ids, order and kinds (22023 intake); wording and options save';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
