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
