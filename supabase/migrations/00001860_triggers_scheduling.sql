-- Scheduling triggers. (integrations triggers live in 00001870_triggers_integrations.sql.)
-- Trigger functions live in 00001510; tables in 00000022.

CREATE OR REPLACE TRIGGER trg_schedules_touch
    BEFORE UPDATE ON scheduling.schedules
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_availability_rules_touch
    BEFORE UPDATE ON scheduling.availability_rules
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_blackout_dates_touch
    BEFORE UPDATE ON scheduling.blackout_dates
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_events_touch
    BEFORE UPDATE ON scheduling.events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_call_settings_touch
    BEFORE UPDATE ON scheduling.call_settings
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_discovery_calls_touch
    BEFORE UPDATE ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_enforce_call_request
    BEFORE INSERT ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_enforce_call_request ();

CREATE OR REPLACE TRIGGER trg_enforce_call_transition
    BEFORE UPDATE ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_enforce_call_transition ();

CREATE OR REPLACE TRIGGER trg_log_call_event
    AFTER INSERT OR UPDATE ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_log_call_event ();

