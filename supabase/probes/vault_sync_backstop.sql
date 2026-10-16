-- =============================================================================================
-- Probe: the vault projection is backstopped by triggers (Teams audit B8, Decision #226 (e)).
--
-- finance.vault_permissions is a projection of the workspace capabilities, written only by
-- org.fn_sync_vault_permissions. The workspace RPCs call it explicitly; the triggers on the member and
-- role tables re-project it for any OTHER write path, so a write that forgets the call cannot leave a
-- stale grant behind. Every write below is a DIRECT table write with no RPC and no explicit sync,
-- run as `postgres` — the role every definer write path runs as (`service_role` holds no grant on
-- `org`) — exactly the future path the backstop exists for.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/vault_sync_backstop.sql
--
-- Fixture (seeded data): a team T with a wallet and two non-owner active members A and B; a business
-- Z with a wallet and a non-owner active member C; a payout-ready freelancer N outside T. Baselines are
-- projected with an EXPLICIT org.fn_sync_vault_permissions call, so each case tests only the trigger.
-- On a database without the backstop the first case fails. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

-- The member's projection on the entity's (first) wallet; NULL when they have no row at all.
CREATE FUNCTION pg_temp.caps(p_wallet text, p_user text) RETURNS finance.vault_capability[] LANGUAGE sql AS $$
    SELECT vp.capabilities FROM finance.vault_permissions vp
     WHERE vp.wallet_id = pg_temp.id(p_wallet) AND vp.member_user_id = pg_temp.id(p_user);
$$;

CREATE FUNCTION pg_temp.row_ref(p_wallet text, p_user text) RETURNS tid LANGUAGE sql AS $$
    SELECT vp.ctid FROM finance.vault_permissions vp
     WHERE vp.wallet_id = pg_temp.id(p_wallet) AND vp.member_user_id = pg_temp.id(p_user);
$$;

CREATE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL % — %', p_label, p_detail;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_team_wallet uuid;
    v_a uuid;
    v_b uuid;
    v_biz uuid;
    v_biz_wallet uuid;
    v_c uuid;
    v_n uuid;
BEGIN
    SELECT t.id, w.id INTO v_team, v_team_wallet
      FROM org.teams t
      JOIN finance.wallets w ON w.owner_type = 'team' AND w.owner_id = t.id
     WHERE (SELECT count(*) FROM org.team_members m
             WHERE m.team_id = t.id AND m.status = 'active' AND m.user_id <> t.owner_user_id) >= 2
     ORDER BY t.slug, w.id
     LIMIT 1;
    SELECT m.user_id INTO v_a FROM org.team_members m JOIN org.teams t ON t.id = m.team_id
     WHERE m.team_id = v_team AND m.status = 'active' AND m.user_id <> t.owner_user_id
     ORDER BY m.user_id LIMIT 1;
    SELECT m.user_id INTO v_b FROM org.team_members m JOIN org.teams t ON t.id = m.team_id
     WHERE m.team_id = v_team AND m.status = 'active' AND m.user_id NOT IN (t.owner_user_id, v_a)
     ORDER BY m.user_id LIMIT 1;

    SELECT b.id, w.id INTO v_biz, v_biz_wallet
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id
     WHERE EXISTS (SELECT 1 FROM org.business_members m
                    WHERE m.business_id = b.id AND m.status = 'active' AND m.user_id <> b.owner_user_id)
     ORDER BY b.slug, w.id
     LIMIT 1;
    SELECT m.user_id INTO v_c FROM org.business_members m JOIN org.business_profiles b ON b.id = m.business_id
     WHERE m.business_id = v_biz AND m.status = 'active' AND m.user_id <> b.owner_user_id
     ORDER BY m.user_id LIMIT 1;

    SELECT fp.user_id INTO v_n FROM org.freelancer_profiles fp
      JOIN org.users_public up ON up.user_id = fp.user_id
     WHERE NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = fp.user_id)
     ORDER BY finance.fn_freelancer_payout_ready(fp.user_id) DESC, fp.user_id LIMIT 1;

    IF v_team_wallet IS NULL OR v_b IS NULL OR v_biz_wallet IS NULL OR v_c IS NULL OR v_n IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team wallet %, B %, business wallet %, C %, N %) — deno task db:reset',
            v_team_wallet, v_b, v_biz_wallet, v_c, v_n;
    END IF;

    INSERT INTO probe_ids (k, id) VALUES
        ('team', v_team), ('team_wallet', v_team_wallet), ('A', v_a), ('B', v_b),
        ('biz', v_biz), ('biz_wallet', v_biz_wallet), ('C', v_c), ('N', v_n);

    UPDATE org.team_members SET granted_capabilities = array_append(granted_capabilities, 'withdraw_funds'),
                                revoked_capabilities = array_remove(revoked_capabilities, 'withdraw_funds')
     WHERE team_id = v_team AND user_id = v_a;
    UPDATE org.business_members SET granted_capabilities = array_append(granted_capabilities, 'withdraw_funds'),
                                    revoked_capabilities = array_remove(revoked_capabilities, 'withdraw_funds')
     WHERE business_id = v_biz AND user_id = v_c;
    PERFORM org.fn_sync_vault_permissions('team', v_team, NULL);
    PERFORM org.fn_sync_vault_permissions('business', v_biz, NULL);

    RAISE NOTICE 'fixture: team % (A %, B %), business % (C %), outsider N %', v_team, v_a, v_b, v_biz, v_c, v_n;
END $$;

SELECT pg_temp.expect('baseline: A holds withdraw on the team wallet',
    'withdraw' = ANY (pg_temp.caps('team_wallet', 'A')), format('A projects to %s', pg_temp.caps('team_wallet', 'A')));
SELECT pg_temp.expect('baseline: C holds withdraw on the business wallet',
    'withdraw' = ANY (pg_temp.caps('biz_wallet', 'C')), format('C projects to %s', pg_temp.caps('biz_wallet', 'C')));
-- #endregion

-- #region 1. An override written directly is re-projected
UPDATE org.team_members SET revoked_capabilities = array_append(revoked_capabilities, 'withdraw_funds')
 WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('A');
UPDATE org.business_members SET revoked_capabilities = array_append(revoked_capabilities, 'withdraw_funds')
 WHERE business_id = pg_temp.id('biz') AND user_id = pg_temp.id('C');

SELECT pg_temp.expect('1 team: a direct revoke of withdraw_funds drops withdraw from the vault',
    NOT ('withdraw' = ANY (pg_temp.caps('team_wallet', 'A'))),
    format('A still projects to %s — the vault grant is stale', pg_temp.caps('team_wallet', 'A')));
SELECT pg_temp.expect('1 business: a direct revoke of withdraw_funds drops withdraw from the vault',
    NOT ('withdraw' = ANY (pg_temp.caps('biz_wallet', 'C'))),
    format('C still projects to %s — the vault grant is stale', pg_temp.caps('biz_wallet', 'C')));

DO $$
DECLARE
    v_before tid := pg_temp.row_ref('team_wallet', 'A');
BEGIN
    UPDATE org.team_members SET role_id = role_id WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('A');
    PERFORM pg_temp.expect('1 idempotent: a write that changes nothing leaves the projection row untouched',
        pg_temp.row_ref('team_wallet', 'A') = v_before,
        format('row moved %s → %s (rewritten although the projection matched)', v_before, pg_temp.row_ref('team_wallet', 'A')));
END $$;

INSERT INTO org.team_members (team_id, user_id, role_id)
SELECT pg_temp.id('team'), pg_temp.id('N'), r.id FROM org.team_roles r
 WHERE r.team_id = pg_temp.id('team') AND r.preset = 'member';

SELECT pg_temp.expect('1 insert: a member seated directly is projected onto the wallet',
    pg_temp.caps('team_wallet', 'N') = ARRAY['view']::finance.vault_capability[],
    format('N projects to %s (expected {view})', COALESCE(pg_temp.caps('team_wallet', 'N')::text, 'no row')));
-- #endregion

-- #region 2. A custom role edit re-projects every holder
DO $$
DECLARE
    v_team_role uuid;
    v_biz_role uuid;
BEGIN
    INSERT INTO org.team_roles (team_id, name, summary, preset, base_preset, capabilities)
    VALUES (pg_temp.id('team'), 'Probe treasurer', '', NULL, 'member', ARRAY['spend_funds', 'withdraw_funds']::org.workspace_capability[])
    RETURNING id INTO v_team_role;
    INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset, capabilities)
    VALUES (pg_temp.id('biz'), 'Probe treasurer', '', NULL, 'member', ARRAY['spend_funds', 'withdraw_funds']::org.workspace_capability[])
    RETURNING id INTO v_biz_role;
    INSERT INTO probe_ids (k, id) VALUES ('team_role', v_team_role), ('biz_role', v_biz_role);

    UPDATE org.team_members SET role_id = v_team_role, granted_capabilities = '{}', revoked_capabilities = '{}'
     WHERE team_id = pg_temp.id('team') AND user_id IN (pg_temp.id('A'), pg_temp.id('B'));
    UPDATE org.business_members SET role_id = v_biz_role, granted_capabilities = '{}', revoked_capabilities = '{}'
     WHERE business_id = pg_temp.id('biz') AND user_id = pg_temp.id('C');
    PERFORM org.fn_sync_vault_permissions('team', pg_temp.id('team'), NULL);
    PERFORM org.fn_sync_vault_permissions('business', pg_temp.id('biz'), NULL);
END $$;

SELECT pg_temp.expect('2 baseline: both team holders project withdraw',
    'withdraw' = ANY (pg_temp.caps('team_wallet', 'A')) AND 'withdraw' = ANY (pg_temp.caps('team_wallet', 'B')),
    format('A %s, B %s', pg_temp.caps('team_wallet', 'A'), pg_temp.caps('team_wallet', 'B')));

UPDATE org.team_roles SET capabilities = ARRAY['spend_funds']::org.workspace_capability[] WHERE id = pg_temp.id('team_role');
UPDATE org.business_roles SET capabilities = ARRAY['spend_funds']::org.workspace_capability[] WHERE id = pg_temp.id('biz_role');

SELECT pg_temp.expect('2 team: editing the role re-projects every holder',
    NOT ('withdraw' = ANY (pg_temp.caps('team_wallet', 'A'))) AND NOT ('withdraw' = ANY (pg_temp.caps('team_wallet', 'B')))
        AND 'spend' = ANY (pg_temp.caps('team_wallet', 'A')) AND 'spend' = ANY (pg_temp.caps('team_wallet', 'B')),
    format('A %s, B %s (expected spend kept, withdraw gone)', pg_temp.caps('team_wallet', 'A'), pg_temp.caps('team_wallet', 'B')));
SELECT pg_temp.expect('2 business: editing the role re-projects its holder',
    NOT ('withdraw' = ANY (pg_temp.caps('biz_wallet', 'C'))) AND 'spend' = ANY (pg_temp.caps('biz_wallet', 'C')),
    format('C %s (expected spend kept, withdraw gone)', pg_temp.caps('biz_wallet', 'C')));
-- #endregion

-- #region 3. A member who leaves keeps an inert row
UPDATE org.team_members SET status = 'left', left_at = now()
 WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('B');
UPDATE org.business_members SET status = 'left', left_at = now()
 WHERE business_id = pg_temp.id('biz') AND user_id = pg_temp.id('C');

SELECT pg_temp.expect('3 team: a departed member''s row is kept and projects to {}',
    pg_temp.caps('team_wallet', 'B') = '{}'::finance.vault_capability[],
    format('B projects to %s', COALESCE(pg_temp.caps('team_wallet', 'B')::text, 'no row (deleted)')));
SELECT pg_temp.expect('3 business: a departed member''s row is kept and projects to {}',
    pg_temp.caps('biz_wallet', 'C') = '{}'::finance.vault_capability[],
    format('C projects to %s', COALESCE(pg_temp.caps('biz_wallet', 'C')::text, 'no row (deleted)')));
-- #endregion

ROLLBACK;
