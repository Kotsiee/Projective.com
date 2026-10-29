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

CREATE TRIGGER trg_project_price_lock
    BEFORE UPDATE OF budget_amount_cents ON projects.projects
    FOR EACH ROW
    WHEN (OLD.budget_amount_cents IS DISTINCT FROM NEW.budget_amount_cents)
    EXECUTE FUNCTION projects.fn_project_price_lock();

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

-- #region Personal projects and under-18 accounts (Decision #192)
CREATE TRIGGER trg_projects_personal_guard
    BEFORE INSERT OR UPDATE ON projects.projects
    FOR EACH ROW EXECUTE FUNCTION projects.trg_projects_personal_guard();

CREATE TRIGGER trg_stages_personal_money_guard
    BEFORE INSERT OR UPDATE ON projects.project_stages
    FOR EACH ROW EXECUTE FUNCTION projects.trg_stages_personal_money_guard();

CREATE TRIGGER trg_tickets_personal_guard
    BEFORE INSERT OR UPDATE ON projects.tickets
    FOR EACH ROW EXECUTE FUNCTION projects.trg_tickets_personal_guard();

CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.project_participants
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.stage_assignments
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.stage_open_seats
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.stage_staffing_roles
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.stage_budget_rules
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.maintenance_contracts
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.stage_invite_links
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.project_applications
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.project_invitations
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();
CREATE TRIGGER trg_personal_project_closed BEFORE INSERT ON projects.cohorts
    FOR EACH ROW EXECUTE FUNCTION projects.trg_personal_project_closed();

CREATE TRIGGER trg_project_joiner_adult BEFORE INSERT OR UPDATE OF target_user_id ON projects.project_invitations
    FOR EACH ROW EXECUTE FUNCTION projects.trg_project_joiner_adult('target_user_id');
CREATE TRIGGER trg_project_joiner_adult BEFORE INSERT ON projects.project_applications
    FOR EACH ROW EXECUTE FUNCTION projects.trg_project_joiner_adult('applicant_user_id');
CREATE TRIGGER trg_project_joiner_adult BEFORE INSERT ON projects.project_participants
    FOR EACH ROW EXECUTE FUNCTION projects.trg_project_joiner_adult('profile_id');
CREATE TRIGGER trg_project_joiner_adult BEFORE INSERT ON projects.stage_assignments
    FOR EACH ROW EXECUTE FUNCTION projects.trg_project_joiner_adult('freelancer_profile_id');
-- #endregion
