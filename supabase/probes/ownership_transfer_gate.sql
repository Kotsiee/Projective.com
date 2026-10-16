-- =============================================================================================
-- Probe: org.transfer_workspace_ownership gates a TEAM successor on persona and payout-readiness
-- (Teams audit §4.3, Decision #196, Decision #228 (A)).
--
-- The team's withdrawer and its verification follow the owner (database/org/Functions.md §16), so a
-- successor who cannot be paid — or who is not a freelancer account at all — would leave the team
-- unable to withdraw. The persona gate answers first so the refusal names the real reason. A business
-- transfer is untouched.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/ownership_transfer_gate.sql
--
-- Fixture (seeded data, adjusted inside the transaction with triggers off): a team T whose owner O is
-- payout-ready, with a non-owner active member S; a business Z whose owner BO has a non-owner active
-- member BS. On a database without the gate the first case fails. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Who holds what on team T: the owner, and the role row each of O and S holds.
CREATE FUNCTION pg_temp.team_state() RETURNS text LANGUAGE sql AS $$
    SELECT format('owner %s · O role %s · S role %s',
        (SELECT t.owner_user_id FROM org.teams t WHERE t.id = pg_temp.id('team')),
        (SELECT m.role_id FROM org.team_members m WHERE m.team_id = pg_temp.id('team') AND m.user_id = pg_temp.id('O')),
        (SELECT m.role_id FROM org.team_members m WHERE m.id = pg_temp.id('S_member')));
$$;

-- Transfer team T to S as O; it must be refused with PK403 and a message starting p_prefix, and
-- nothing may have moved.
CREATE FUNCTION pg_temp.expect_refused(p_label text, p_prefix text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_before text := pg_temp.team_state();
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    BEGIN
        PERFORM org.transfer_workspace_ownership('team', pg_temp.id('team'), pg_temp.id('S_member'), false);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — the transfer went through (%)', p_label, pg_temp.team_state();
    END IF;
    IF v_state <> 'PK403' OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected PK403 %)', p_label, v_state, v_msg, p_prefix;
    END IF;
    IF pg_temp.team_state() IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'FAIL % — refused, yet state moved: % → %', p_label, v_before, pg_temp.team_state();
    END IF;
    RAISE NOTICE 'PASS % (PK403 %, nothing moved)', p_label, split_part(v_msg, ':', 1);
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_o uuid;
    v_s uuid;
    v_s_member uuid;
    v_biz uuid;
    v_bo uuid;
    v_bs_member uuid;
BEGIN
    SELECT t.id, t.owner_user_id, m.user_id, m.id INTO v_team, v_o, v_s, v_s_member
      FROM org.teams t
      JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active' AND m.user_id <> t.owner_user_id
      JOIN org.freelancer_profiles fp ON fp.user_id = m.user_id
     WHERE finance.fn_freelancer_payout_ready(t.owner_user_id)
     ORDER BY t.slug, m.user_id
     LIMIT 1;

    SELECT b.id, b.owner_user_id, m.id INTO v_biz, v_bo, v_bs_member
      FROM org.business_profiles b
      JOIN org.business_members m ON m.business_id = b.id AND m.status = 'active' AND m.user_id <> b.owner_user_id
     ORDER BY b.slug, m.user_id
     LIMIT 1;

    IF v_s_member IS NULL OR v_bs_member IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team successor %, business successor %) — deno task db:reset',
            v_s_member, v_bs_member;
    END IF;

    INSERT INTO probe_ids (k, id) VALUES
        ('team', v_team), ('O', v_o), ('S', v_s), ('S_member', v_s_member),
        ('biz', v_biz), ('BO', v_bo), ('BS_member', v_bs_member);

    SET LOCAL session_replication_role = replica;
    UPDATE org.freelancer_profiles SET kyc_status = 'pending', payout_ready = false WHERE user_id = v_s;
    UPDATE org.freelancer_profiles SET kyc_status = 'pending', payout_ready = false
     WHERE user_id = (SELECT m.user_id FROM org.business_members m WHERE m.id = v_bs_member);
    SET LOCAL session_replication_role = origin;

    RAISE NOTICE 'fixture: team % (owner %, successor %), business % (owner %, successor member %)',
        v_team, v_o, v_s, v_biz, v_bo, v_bs_member;
END $$;
-- #endregion

-- #region 4. A team successor must be payable, and a freelancer account
SELECT pg_temp.expect_refused('4 team: an unready successor is refused', 'payout_not_ready:');

DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.users_public SET is_operator = true WHERE user_id = pg_temp.id('S');
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_refused('4 team: an unready operator successor is refused for the persona first', 'persona_not_freelancer:');

DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.freelancer_profiles SET kyc_status = 'verified', payout_ready = true WHERE user_id = pg_temp.id('S');
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_refused('4 team: a payout-ready operator successor is refused', 'persona_not_freelancer:');

DO $$
DECLARE
    v_wallet uuid;
    v_new finance.vault_capability[];
    v_old finance.vault_capability[];
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.users_public SET is_operator = false WHERE user_id = pg_temp.id('S');
    SET LOCAL session_replication_role = origin;

    PERFORM pg_temp.act(pg_temp.id('O'));
    PERFORM org.transfer_workspace_ownership('team', pg_temp.id('team'), pg_temp.id('S_member'), false);
    IF (SELECT t.owner_user_id FROM org.teams t WHERE t.id = pg_temp.id('team')) IS DISTINCT FROM pg_temp.id('S') THEN
        RAISE EXCEPTION 'FAIL 4 team: a ready freelancer successor — ownership did not move (%)', pg_temp.team_state();
    END IF;

    SELECT w.id INTO v_wallet FROM finance.wallets w
     WHERE w.owner_type = 'team' AND w.owner_id = pg_temp.id('team') ORDER BY w.id LIMIT 1;
    IF v_wallet IS NOT NULL THEN
        SELECT vp.capabilities INTO v_new FROM finance.vault_permissions vp
         WHERE vp.wallet_id = v_wallet AND vp.member_user_id = pg_temp.id('S');
        SELECT vp.capabilities INTO v_old FROM finance.vault_permissions vp
         WHERE vp.wallet_id = v_wallet AND vp.member_user_id = pg_temp.id('O');
        IF NOT ('withdraw' = ANY (v_new) AND 'manage_members' = ANY (v_new))
           OR 'manage_members' = ANY (v_old) OR 'withdraw' = ANY (v_old) THEN
            RAISE EXCEPTION 'FAIL 4 team: the vault did not follow the owner (new %, old %)', v_new, v_old;
        END IF;
    END IF;
    RAISE NOTICE 'PASS 4 team: a ready freelancer successor takes ownership and the vault follows';
END $$;
-- #endregion

-- #region Business transfers are untouched
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('BO'));
    PERFORM org.transfer_workspace_ownership('business', pg_temp.id('biz'), pg_temp.id('BS_member'), false);
    IF (SELECT b.owner_user_id FROM org.business_profiles b WHERE b.id = pg_temp.id('biz'))
       IS NOT DISTINCT FROM pg_temp.id('BO') THEN
        RAISE EXCEPTION 'FAIL business: ownership did not move';
    END IF;
    RAISE NOTICE 'PASS business: an unready successor still takes a business (no team gate)';
END $$;
-- #endregion

ROLLBACK;
