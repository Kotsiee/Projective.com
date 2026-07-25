-- ============================================================================
-- 00001820 triggers projects
-- Consolidated verbatim from: 0121_kanban_sync.sql, 0311_e7_private_channels_pii_handover.sql, 20260724113000_entitlements_allowances_enforcement.sql
-- ============================================================================

CREATE TRIGGER trg_ticket_review_submission
    AFTER UPDATE OF status ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_review_submission();

CREATE TRIGGER trg_project_handover_on_complete
    BEFORE UPDATE OF status ON projects.projects
    FOR EACH ROW
    WHEN (NEW.status = 'completed'::project_status)
    EXECUTE FUNCTION projects.tg_project_handover_on_complete();

CREATE TRIGGER trg_meter_application_allowance
    AFTER INSERT ON projects.project_applications
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_meter_application_allowance ();

CREATE TRIGGER trg_refund_withdrawn_application
    AFTER UPDATE OF status ON projects.project_applications
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_refund_withdrawn_application ();

CREATE TRIGGER trg_check_public_project_footprint
    BEFORE INSERT OR UPDATE OF status, visibility ON projects.projects
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_check_public_project_footprint ();
