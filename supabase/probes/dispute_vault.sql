-- =============================================================================================
-- Probe: raising a ticket dispute freezes a hashed snapshot of its evidence, the Evidence Vault
-- (PROJECTS EX3; Decision #548 (6); PRODUCT_SPEC §Dispute Resolution 1; PJ-43).
--
--   1. The client raises a dispute on a ticket in review: in the same transaction a pending
--      `finance.dispute_vaults` row holds a manifest of the ticket's and stage's terms at raise, the
--      contested escrows, the ticket's history, every submission on the stage with its files (each
--      by its hash) and the stage's rooms' messages, and `sha256` is the SHA-256 of the manifest's
--      canonical text. The door names the files the service copies.
--   2. The hash is stable: a second read gives the same text, and a later edit to the ticket leaves
--      the frozen manifest as it was.
--   3. Reads: the parties and an operator read the vault (`finance.get_dispute_vault`), a stranger
--      reads nothing; the case read carries the vault's status and hash.
--   4. Immutable: the manifest and hash never change and the row is never deleted (42501); the
--      service's ready stamp moves pending → ready once and is idempotent.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   deno task test:probes dispute_vault
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;
-- #endregion

DO $$
DECLARE
    v_project uuid;
    v_biz uuid;
    v_ticket uuid;
    v_stage uuid;
    v_client uuid;
    v_freelancer uuid;
    v_stranger uuid;
    v_operator uuid;
    v_out jsonb;
    v_dispute uuid;
    v_vault record;
    v_read jsonb;
    v_text text;
    v_state text;
BEGIN
    -- #region 0. Fixture (as postgres): a ticket in review holding its bound escrow, with a submission
    -- The seed's state drifts as sessions drive the shared DB, so the probe makes its own fixture: a funded
    -- ticket at work (or in review) on its current stage, put in review with a submission awaiting review.
    SELECT tk.id INTO v_ticket
      FROM projects.tickets tk
      JOIN projects.projects p ON p.id = tk.project_id
      JOIN finance.escrows e ON e.ticket_id = tk.id AND e.project_stage_id = tk.current_stage_id
                            AND e.status = 'held' AND e.payee_id IS NOT NULL
     WHERE p.status = 'active' AND p.format <> 'session' AND tk.current_assignee_id IS NOT NULL
       AND tk.status IN ('claimed', 'in_progress', 'in_review')
       AND NOT finance.fn_escrow_has_open_dispute(e.id)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows o
                        WHERE o.ticket_id = tk.id AND o.status = 'held' AND o.id <> e.id)
     ORDER BY (tk.status = 'in_review') DESC, tk.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_ticket IS NOT NULL, 'fixture: a funded ticket at work on its current stage');
    UPDATE projects.tickets SET status = 'in_review' WHERE id = v_ticket AND status <> 'in_review';
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status)
    SELECT tk.current_stage_id, tk.id, tk.current_assignee_id, 'Probe delivery', 'pending_review'
      FROM projects.tickets tk
     WHERE tk.id = v_ticket
       AND NOT EXISTS (SELECT 1 FROM projects.stage_submissions ss
                        WHERE ss.ticket_id = tk.id AND ss.project_stage_id = tk.current_stage_id
                          AND ss.status = 'pending_review');
    SELECT p.id, p.client_business_id, tk.id, e.project_stage_id, COALESCE(p.client_user_id, p.owner_user_id),
           CASE WHEN e.payee_type = 'team' THEN t.owner_user_id ELSE e.payee_id END
      INTO v_project, v_biz, v_ticket, v_stage, v_client, v_freelancer
      FROM projects.tickets tk
      JOIN projects.projects p ON p.id = tk.project_id
      JOIN finance.escrows e ON e.ticket_id = tk.id AND e.project_stage_id = tk.current_stage_id
                            AND e.status = 'held' AND e.payee_id IS NOT NULL
      LEFT JOIN org.teams t ON t.id = e.payee_id AND e.payee_type = 'team'
     WHERE tk.id = v_ticket AND p.status = 'active' AND p.format <> 'session' AND tk.status = 'in_review'
       AND NOT finance.fn_escrow_has_open_dispute(e.id)
       AND EXISTS (SELECT 1 FROM projects.stage_submissions ss
                    WHERE ss.ticket_id = tk.id AND ss.project_stage_id = e.project_stage_id)
     ORDER BY tk.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_ticket IS NOT NULL, 'fixture: a ticket in review with its held escrow and a submission');
    IF v_biz IS NOT NULL THEN
        UPDATE org.business_profiles SET status = 'active', kyb_status = 'verified' WHERE id = v_biz;
    END IF;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_client, v_freelancer)
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_id = u.user_id)
       AND (v_biz IS NULL OR NOT EXISTS (SELECT 1 FROM org.business_members bm
                                          WHERE bm.business_id = v_biz AND bm.user_id = u.user_id))
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT a.user_id INTO v_operator FROM ops.admin_users a ORDER BY a.user_id LIMIT 1;
    -- #endregion

    -- #region 1. The raise freezes the vault in its own transaction
    PERFORM pg_temp.ok(pg_catalog.to_regclass('finance.dispute_vaults') IS NOT NULL,
        '1 a dispute has an Evidence Vault (finance.dispute_vaults)');
    PERFORM pg_temp.act(v_client);
    v_out := finance.open_ticket_dispute(v_ticket, v_stage, 'The delivered work does not meet the brief.',
        'Two of the agreed deliverables are missing.');
    v_dispute := (v_out->>'dispute_id')::uuid;
    SELECT * INTO v_vault FROM finance.dispute_vaults WHERE dispute_id = v_dispute;
    PERFORM pg_temp.ok(v_vault.dispute_id IS NOT NULL AND v_vault.status = 'pending',
        '1 the raise wrote a pending vault');
    PERFORM pg_temp.ok(v_vault.sha256 = pg_catalog.encode(pg_catalog.sha256(
                           pg_catalog.convert_to(v_vault.manifest::text, 'UTF8')), 'hex'),
        '1 its hash is the SHA-256 of the manifest''s canonical text');
    PERFORM pg_temp.ok(v_vault.manifest ?& ARRAY['version', 'dispute', 'ticket', 'stage', 'escrows', 'history',
                                                  'submissions', 'messages'],
        '1 the manifest holds the terms, the escrows, the history, the submissions and the rooms');
    PERFORM pg_temp.ok(v_vault.manifest->'ticket'->>'id' = v_ticket::text
                       AND v_vault.manifest->'stage'->>'id' = v_stage::text
                       AND pg_catalog.jsonb_array_length(v_vault.manifest->'escrows') >= 1
                       AND pg_catalog.jsonb_array_length(v_vault.manifest->'submissions') >= 1,
        '1 it names this ticket, its stage, the contested escrow and the stage''s submissions');
    PERFORM pg_temp.ok(v_vault.object_prefix = 'vault/' || v_dispute || '/', '1 the bytes go under vault/{dispute}/');
    PERFORM pg_temp.ok(v_out->'vault'->>'sha256' = v_vault.sha256 AND pg_catalog.jsonb_typeof(v_out->'vault'->'files') = 'array',
        '1 the door returns the hash and the files the service copies');
    -- #endregion

    -- #region 2. The hash is stable
    SELECT manifest::text INTO v_text FROM finance.dispute_vaults WHERE dispute_id = v_dispute;
    PERFORM pg_temp.ok(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_text, 'UTF8')), 'hex') = v_vault.sha256,
        '2 a second read hashes the same');
    -- The raise froze the ticket itself (Decision #549), so the later edit is to its submission.
    UPDATE projects.stage_submissions SET notes = 'Edited after the raise'
     WHERE ticket_id = v_ticket AND project_stage_id = v_stage;
    PERFORM pg_temp.ok(finance.fn_dispute_vault_manifest(v_dispute)::text <> v_text,
        '2 the edit changes what a fresh snapshot would read');
    PERFORM pg_temp.ok((SELECT manifest::text FROM finance.dispute_vaults WHERE dispute_id = v_dispute) = v_text,
        '2 a later edit leaves the frozen manifest as it was');
    -- #endregion

    -- #region 3. Who reads it
    PERFORM pg_temp.act(v_stranger);
    PERFORM pg_temp.ok(finance.get_dispute_vault(v_dispute) IS NULL, '3 a stranger reads nothing');
    PERFORM pg_temp.act(v_freelancer);
    v_read := finance.get_dispute_vault(v_dispute);
    PERFORM pg_temp.ok(v_read->>'sha256' = v_vault.sha256 AND v_read->'manifest' = v_vault.manifest,
        '3 the other side reads the manifest and its hash');
    PERFORM pg_temp.ok(finance.get_dispute(v_dispute)->'vault'->>'sha256' = v_vault.sha256
                       AND finance.get_dispute(v_dispute)->'vault'->>'status' = 'pending',
        '3 the case read carries the vault''s status and hash');
    PERFORM pg_temp.act(v_operator);
    PERFORM pg_temp.ok(finance.get_dispute_vault(v_dispute)->>'object_prefix' = v_vault.object_prefix,
        '3 an operator reads the raw snapshot, with where its bytes are');
    -- #endregion

    -- #region 4. Immutable but for the one ready stamp
    PERFORM pg_temp.act(NULL);
    v_state := pg_temp.state_of(pg_catalog.format(
        'UPDATE finance.dispute_vaults SET manifest = %L WHERE dispute_id = %L', '{}', v_dispute));
    PERFORM pg_temp.ok(v_state = '42501', format('4 the manifest never changes (%s)', v_state));
    v_state := pg_temp.state_of(pg_catalog.format('DELETE FROM finance.dispute_vaults WHERE dispute_id = %L', v_dispute));
    PERFORM pg_temp.ok(v_state = '42501', format('4 a vault is never deleted (%s)', v_state));
    PERFORM pg_temp.ok(finance.mark_dispute_vault_ready(v_dispute) = 'ready'
                       AND finance.mark_dispute_vault_ready(v_dispute) = 'ready',
        '4 the service''s stamp moves it to ready, once, idempotently');
    v_state := pg_temp.state_of(pg_catalog.format(
        'UPDATE finance.dispute_vaults SET status = %L WHERE dispute_id = %L', 'pending', v_dispute));
    PERFORM pg_temp.ok(v_state = '42501', format('4 a ready vault never goes back (%s)', v_state));
    PERFORM pg_temp.ok((SELECT sha256 FROM finance.dispute_vaults WHERE dispute_id = v_dispute) = v_vault.sha256,
        '4 the hash is unchanged');
    -- #endregion
END $$;

ROLLBACK;
