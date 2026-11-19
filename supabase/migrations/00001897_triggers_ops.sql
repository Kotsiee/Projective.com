-- ============================================================================
-- 00001897 triggers ops
-- The job registry (Decision #203): functions in 00001650.
-- ============================================================================

CREATE TRIGGER trg_scheduled_jobs_touch
    BEFORE UPDATE ON ops.scheduled_jobs
    FOR EACH ROW
    EXECUTE FUNCTION ops.fn_touch_updated_at ();

-- A registry write is applied to pg_cron in the same transaction, so the row and the job never drift.
CREATE TRIGGER trg_scheduled_jobs_apply
    AFTER INSERT OR UPDATE OR DELETE ON ops.scheduled_jobs
    FOR EACH ROW
    EXECUTE FUNCTION ops.tg_scheduled_jobs_apply ();

-- #region [contact] Contact requests (Decision #276): function in 00001655
-- A request is a record: only its status moves, along the unified machine; updated_at is stamped.
CREATE TRIGGER trg_contact_requests_guard
    BEFORE UPDATE ON ops.contact_requests
    FOR EACH ROW
    EXECUTE FUNCTION ops.fn_guard_contact_request ();
-- #endregion

-- #region [alerts] Money and job alerts (MR4, Decision #461): function in 00001660
-- What was sent, and what the claim has folded, is kept: no role deletes or truncates either.
CREATE TRIGGER trg_alert_deliveries_keep
    BEFORE DELETE ON ops.alert_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION ops.fn_alert_keep ();

CREATE TRIGGER trg_alert_deliveries_no_truncate
    BEFORE TRUNCATE ON ops.alert_deliveries
    FOR EACH STATEMENT
    EXECUTE FUNCTION ops.fn_alert_keep ();

CREATE TRIGGER trg_alert_seen_keep
    BEFORE DELETE ON ops.alert_seen
    FOR EACH ROW
    EXECUTE FUNCTION ops.fn_alert_keep ();

CREATE TRIGGER trg_alert_seen_no_truncate
    BEFORE TRUNCATE ON ops.alert_seen
    FOR EACH STATEMENT
    EXECUTE FUNCTION ops.fn_alert_keep ();
-- #endregion
