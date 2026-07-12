-- #region Ticket & Stage lifecycle RPCs
-- Thin, PostgREST-exposed wrappers in the `projects` schema that orchestrate the internal
-- `finance.*` escrow engine (0009_finance_tables.sql). The `finance` schema is intentionally
-- NOT exposed to the API (see supabase/config.toml `[api] schemas`), so backend services call
-- these SECURITY DEFINER wrappers instead of touching finance tables directly.
--
-- Business rules implemented here (spec §2):
--   • Escrow enters `held` immediately on freelancer claim; releases on stage completion.
--   • Force-majeure deletion after a claim releases escrow in full to the freelancer.
--   • Removing a freelancer from an open ticket releases locked funds and returns it to backlog.
--   • Deleting a stage releases escrow for its running tickets and clears dependency references.

-- ---------------------------------------------------------------------------------------------
-- projects.claim_ticket(p_ticket_id, p_assignee_id)
-- A freelancer claims a ticket. Requires a real description (purchase/funding eligibility),
-- stamps the claim, transitions status to `claimed`, and holds escrow immediately.
-- Returns the created escrow id (NULL when escrow prerequisites are absent, e.g. no unit price
-- or an individual — non-business — client, which is a legitimate no-op rather than a failure).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.claim_ticket(p_ticket_id uuid, p_assignee_id uuid)
RETURNS uuid AS $$
DECLARE
  v_desc jsonb;
  v_assignee uuid;
  v_escrow_id uuid;
BEGIN
  SELECT description, current_assignee_id INTO v_desc, v_assignee
  FROM projects.tickets WHERE id = p_ticket_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket % not found.', p_ticket_id; END IF;

  IF v_assignee IS NOT NULL THEN
    RAISE EXCEPTION 'Ticket has already been claimed.';
  END IF;

  -- Purchasing eligibility: funds cannot be committed without a comprehensive description.
  IF v_desc IS NULL OR v_desc = '{}'::jsonb THEN
    RAISE EXCEPTION 'A comprehensive description is required before a ticket can be claimed/funded.';
  END IF;

  UPDATE projects.tickets
  SET current_assignee_id = p_assignee_id,
      claimed_at = now(),
      status = 'claimed'::ticket_status,
      updated_at = now()
  WHERE id = p_ticket_id;

  -- Escrow moves to `held` the moment the ticket is claimed.
  v_escrow_id := finance.fn_hold_ticket_escrow(p_ticket_id);
  RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, auth;

-- ---------------------------------------------------------------------------------------------
-- projects.complete_ticket(p_ticket_id)
-- Marks a ticket complete and releases its held escrow to the assigned payee (fee/bonus/team
-- splits are applied inside finance.fn_release_ticket_escrow).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.complete_ticket(p_ticket_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE projects.tickets
  SET status = 'completed'::ticket_status, updated_at = now()
  WHERE id = p_ticket_id;

  PERFORM finance.fn_release_ticket_escrow(p_ticket_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.delete_ticket(p_ticket_id)
-- Force-majeure deletion:
--   • Before claim  -> purge immediately (no escrow held, nothing to release).
--   • After claim   -> release escrow in full to the freelancer as compensation, then purge.
-- finance.escrows.ticket_id is ON DELETE SET NULL, so released escrow rows survive as an
-- auditable record after the ticket row is removed.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.delete_ticket(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
  v_assignee uuid;
BEGIN
  SELECT current_assignee_id INTO v_assignee FROM projects.tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_assignee IS NOT NULL THEN
    PERFORM finance.fn_release_ticket_escrow(p_ticket_id);
  END IF;

  DELETE FROM projects.tickets WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.release_ticket_to_backlog(p_ticket_id)
-- A freelancer is removed from a stage/project while actively working: release any locked
-- escrow to them, reset the ticket to "New" (backlog) and return it to the open pool.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.release_ticket_to_backlog(p_ticket_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM finance.fn_release_ticket_escrow(p_ticket_id);

  UPDATE projects.tickets
  SET status = 'backlog'::ticket_status,
      current_assignee_id = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.delete_stage(p_project_id, p_stage_id)
-- Deleting an active stage:
--   1. Releases escrow for every actively-claimed ticket currently in the stage.
--   2. Detaches those tickets (they fall back to the backlog pool).
--   3. Clears the stage from every ticket's `required_stages` dependency array.
--   4. Nulls any sibling stage that depended on this one (start_dependency_stage_id).
--   5. Deletes the stage — UNLESS it carries escrow history (finance.escrows.project_stage_id
--      is ON DELETE RESTRICT + NOT NULL): funds are still released, but the stage cannot be
--      hard-deleted and the caller is told to archive it instead. This preserves the finance
--      audit trail rather than silently orphaning it.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.delete_stage(p_project_id uuid, p_stage_id uuid)
RETURNS void AS $$
DECLARE
  r record;
BEGIN
  -- 1. Release escrow for claimed tickets sitting in this stage.
  FOR r IN
    SELECT id FROM projects.tickets
    WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
  LOOP
    PERFORM finance.fn_release_ticket_escrow(r.id);
  END LOOP;

  -- 2. Detach tickets pointing at this stage back into the backlog pool.
  UPDATE projects.tickets
  SET current_stage_id = NULL, updated_at = now()
  WHERE current_stage_id = p_stage_id;

  -- 3. Clear this stage from every ticket's required_stages dependency array.
  UPDATE projects.tickets
  SET required_stages = COALESCE((
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(required_stages) elem
        WHERE elem->>'stage_id' <> p_stage_id::text
      ), '[]'::jsonb),
      updated_at = now()
  WHERE project_id = p_project_id
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(required_stages) e
      WHERE e->>'stage_id' = p_stage_id::text
    );

  -- 4. Null sibling stages that used this stage as a start dependency.
  UPDATE projects.project_stages
  SET start_dependency_stage_id = NULL
  WHERE start_dependency_stage_id = p_stage_id;

  -- 5. Guard the finance audit trail before hard-deleting.
  IF EXISTS (SELECT 1 FROM finance.escrows WHERE project_stage_id = p_stage_id) THEN
    RAISE EXCEPTION 'Stage % has escrow history: its funds were released but the stage must be archived, not deleted.', p_stage_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM projects.project_stages WHERE id = p_stage_id AND project_id = p_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.reorder_stages(p_project_id, p_ordered_ids)
-- Atomic bulk reorder that preserves each column's internal ticket array/order (ticket
-- sort_order is independent of stage sort_order, so simply restamping stage order is safe).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.reorder_stages(p_project_id uuid, p_ordered_ids uuid[])
RETURNS void AS $$
DECLARE
  i integer;
BEGIN
  FOR i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE projects.project_stages
    SET sort_order = i - 1
    WHERE id = p_ordered_ids[i] AND project_id = p_project_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects;
-- #endregion
