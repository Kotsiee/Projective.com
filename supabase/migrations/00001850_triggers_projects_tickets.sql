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
    BEFORE UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_immutability_guard();

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

CREATE OR REPLACE TRIGGER trg_open_workload_report
    AFTER INSERT ON projects.ticket_workload_reports
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_open_workload_report();

CREATE OR REPLACE TRIGGER trg_sync_workload_intensity
    AFTER INSERT OR DELETE OR UPDATE OF current_assignee_id, status, workload_intensity ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_sync_workload_intensity();

