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

CREATE TRIGGER trg_project_shape_lock
    BEFORE UPDATE OF format, structure_variation ON projects.projects
    FOR EACH ROW
    WHEN (OLD.format IS DISTINCT FROM NEW.format
        OR OLD.structure_variation IS DISTINCT FROM NEW.structure_variation)
    EXECUTE FUNCTION projects.fn_project_shape_lock();

CREATE TRIGGER trg_guard_project_ownership
    BEFORE UPDATE OF owner_user_id, client_business_id ON projects.projects
    FOR EACH ROW
    WHEN (OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
        OR OLD.client_business_id IS DISTINCT FROM NEW.client_business_id)
    EXECUTE FUNCTION projects.fn_guard_project_ownership();

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

CREATE TRIGGER trg_projects_touch_updated_at
    BEFORE UPDATE ON projects.projects
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_touch_updated_at ();
