-- =============================================================================================
-- Probe: the public profile directory names who a Message reaches (Decision #422 (b)) —
-- org.profiles_index.contact_handle / contact_name is a team's or a business's OWNER, the same
-- `contact` org.get_profile_view answers (#244 (C)), and NULL for a person, who is their own
-- recipient. A guest can read it: the discovery catalogue loads the view with the anon client and
-- builds every card's Message row and a brief's Message client from these two columns.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/explore_owner_contact.sql
--
-- Fixture (seeded): every active public or unlisted team and business in the directory, and the
-- people beside them. Every case runs and reports; a clean run prints only PASS notices, and any FAIL
-- aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        INSERT INTO probe_fails VALUES (p_label);
        RAISE NOTICE 'FAIL % — %', p_label, p_why;
    END IF;
END $$;
-- #endregion

-- #region 0. The columns exist (before Decision #422 (b) they did not, and every case below errors)
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'org' AND table_name = 'profiles_index'
           AND column_name IN ('contact_handle', 'contact_name')) <> 2 THEN
        RAISE EXCEPTION 'PROBE FAIL: org.profiles_index has no contact_handle / contact_name';
    END IF;
    RAISE NOTICE 'PASS the view projects contact_handle and contact_name';
END $$;
-- #endregion

-- #region 1. A team's and a business's contact is its owner, as the profile read names them
DO $$
DECLARE
    v_rows int;
    v_drift text;
BEGIN
    SELECT count(*),
           string_agg(format('%s %s: view=%s/%s owner=%s/%s', v.entity_type, v.handle,
                             v.contact_handle, v.contact_name, o.username, o.full_name), '; ')
             FILTER (WHERE v.contact_handle IS DISTINCT FROM o.username
                        OR v.contact_name IS DISTINCT FROM o.full_name)
      INTO v_rows, v_drift
      FROM org.profiles_index v
      JOIN LATERAL (
          SELECT up.username,
                 NULLIF(btrim(concat_ws(' ', up.first_name, up.last_name)), '') AS full_name
            FROM org.users_public up
           WHERE up.user_id = CASE v.entity_type
                   WHEN 'team' THEN (SELECT t.owner_user_id FROM org.teams t WHERE t.id = v.entity_id)
                   ELSE (SELECT b.owner_user_id FROM org.business_profiles b WHERE b.id = v.entity_id)
                 END
      ) o ON true
     WHERE v.entity_type IN ('team', 'business');
    PERFORM pg_temp.check('teams and businesses: contact = the owner''s handle and name',
        v_rows > 0 AND v_drift IS NULL, format('%s rows; %s', v_rows, COALESCE(v_drift, 'no rows')));
END $$;

DO $$
DECLARE
    v_drift text;
BEGIN
    SELECT string_agg(format('%s: view=%s/%s profile=%s/%s', v.handle, v.contact_handle,
                             v.contact_name, p -> 'contact' ->> 'handle', p -> 'contact' ->> 'name'), '; ')
      INTO v_drift
      FROM org.profiles_index v
      CROSS JOIN LATERAL org.get_profile_view(v.handle) p
     WHERE v.entity_type IN ('team', 'business')
       AND (v.contact_handle IS DISTINCT FROM p -> 'contact' ->> 'handle'
         OR v.contact_name IS DISTINCT FROM p -> 'contact' ->> 'name');
    PERFORM pg_temp.check('the directory and org.get_profile_view name the same contact',
        v_drift IS NULL, v_drift);
END $$;

SELECT pg_temp.check('the seeded teams and businesses each name an owner',
    NOT EXISTS (SELECT 1 FROM org.profiles_index
                 WHERE entity_type IN ('team', 'business') AND contact_handle IS NULL),
    (SELECT string_agg(handle, ', ') FROM org.profiles_index
      WHERE entity_type IN ('team', 'business') AND contact_handle IS NULL));
-- #endregion

-- #region 2. A person is their own recipient
SELECT pg_temp.check('a user or freelancer carries no contact',
    NOT EXISTS (SELECT 1 FROM org.profiles_index
                 WHERE entity_type IN ('user', 'freelancer')
                   AND (contact_handle IS NOT NULL OR contact_name IS NOT NULL)),
    (SELECT string_agg(handle, ', ') FROM org.profiles_index
      WHERE entity_type IN ('user', 'freelancer') AND contact_handle IS NOT NULL));
-- #endregion

-- #region 3. A guest reads it, as the discovery catalogue does
CREATE FUNCTION pg_temp.contacts() RETURNS text LANGUAGE sql AS $$
    SELECT COALESCE(string_agg(v.handle || '=' || COALESCE(v.contact_handle, '-'), ',' ORDER BY v.handle), '')
      FROM org.profiles_index v
     WHERE v.entity_type IN ('team', 'business');
$$;

SET LOCAL ROLE anon;
SELECT set_config('probe.guest_contacts', COALESCE((
    SELECT string_agg(v.handle || '=' || COALESCE(v.contact_handle, '-'), ',' ORDER BY v.handle)
      FROM org.profiles_index v
     WHERE v.entity_type IN ('team', 'business')
), ''), true);
RESET ROLE;

SELECT pg_temp.check('a guest sees each team''s and business''s contact',
    pg_temp.contacts() <> '' AND current_setting('probe.guest_contacts') = pg_temp.contacts(),
    format('guest %s; owner %s', current_setting('probe.guest_contacts'), pg_temp.contacts()));
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'explore_owner_contact: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'explore_owner_contact: all cases passed';
END $$;

ROLLBACK;
