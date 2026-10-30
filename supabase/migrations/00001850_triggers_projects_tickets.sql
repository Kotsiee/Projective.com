-- Projects: ticket, stage, and workload-report triggers.
-- Trigger functions live in 00001110/00001130/00001140; tables in 00000015.

CREATE OR REPLACE TRIGGER trg_enforce_ticket_due_date
    BEFORE INSERT OR UPDATE OF due_date ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_ticket_due_date();

CREATE OR REPLACE TRIGGER trg_ticket_touch_updated_at
    BEFORE UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_touch_updated_at();

CREATE OR REPLACE TRIGGER trg_enforce_ticket_checkout_desc
    BEFORE UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_ticket_checkout_desc();

CREATE OR REPLACE TRIGGER trg_ticket_ordering_guard
    BEFORE UPDATE OF sort_order ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_ordering_guard();

CREATE OR REPLACE TRIGGER trg_ticket_immutability_guard
    BEFORE INSERT OR UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_immutability_guard();

-- Named to sort before trg_ticket_claim_before / trg_ticket_delete_protocol, so the authority check
-- sees the caller's own NEW.status and refuses before any escrow trigger runs.
CREATE OR REPLACE TRIGGER trg_ticket_authority_guard
    BEFORE UPDATE OF status OR DELETE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_settlement_guard();

CREATE OR REPLACE TRIGGER trg_ticket_claim_before
    BEFORE UPDATE OF current_assignee_id, status ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_claim_before();

CREATE OR REPLACE TRIGGER trg_ticket_escrow_sync
    AFTER UPDATE OF current_assignee_id, status ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_escrow_sync();

CREATE OR REPLACE TRIGGER trg_ticket_delete_protocol
    BEFORE DELETE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_delete_protocol();

CREATE OR REPLACE TRIGGER trg_stage_reorder_lock
    BEFORE UPDATE OF sort_order ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_stage_reorder_lock();

CREATE OR REPLACE TRIGGER trg_stage_price_lock
    BEFORE UPDATE OF unit_price_cents ON projects.project_stages
    FOR EACH ROW
    WHEN (OLD.unit_price_cents IS DISTINCT FROM NEW.unit_price_cents)
    EXECUTE FUNCTION projects.fn_stage_price_lock();

CREATE OR REPLACE TRIGGER trg_stage_delete_cascade
    BEFORE DELETE ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_stage_delete_cascade();

CREATE OR REPLACE TRIGGER trg_enforce_structure_variation_tickets
    BEFORE INSERT ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_structure_variation();

CREATE OR REPLACE TRIGGER trg_enforce_structure_variation_stages
    BEFORE INSERT ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_structure_variation();

-- The same caps when the shape itself changes (DL S6), judged at commit so a setup save may switch the
-- shape and retire the extra stages in one transaction. A constraint trigger is never OR REPLACEd, so
-- it is dropped first to keep this file re-runnable.
DROP TRIGGER IF EXISTS trg_enforce_structure_variation_switch ON projects.projects;
CREATE CONSTRAINT TRIGGER trg_enforce_structure_variation_switch
    AFTER UPDATE OF structure_variation ON projects.projects
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (OLD.structure_variation IS DISTINCT FROM NEW.structure_variation)
    EXECUTE FUNCTION projects.fn_enforce_structure_variation_switch();

-- A taken seat is never un-taken, so the shape and price locks that read it cannot be lifted (X8).
CREATE OR REPLACE TRIGGER trg_stage_assignment_lock_guard
    BEFORE UPDATE OR DELETE ON projects.stage_assignments
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_stage_assignment_lock_guard();

CREATE OR REPLACE TRIGGER trg_stage_revision_terms
    BEFORE INSERT OR UPDATE OF file_revisions_allowed, extra_revision_price_cents ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_stage_revision_terms();

CREATE OR REPLACE TRIGGER trg_open_workload_report
    AFTER INSERT ON projects.ticket_workload_reports
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_open_workload_report();

-- The client raising a suspended ticket's W_i answers its workload report and resumes the work.
CREATE OR REPLACE TRIGGER trg_adjust_workload_report
    AFTER UPDATE OF workload_intensity ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_adjust_workload_report();

CREATE OR REPLACE TRIGGER trg_sync_workload_intensity
    AFTER INSERT OR DELETE OR UPDATE OF current_assignee_id, status, workload_intensity ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_sync_workload_intensity();

