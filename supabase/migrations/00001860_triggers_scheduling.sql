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

-- A rostered event moves only through its negotiation and is never deleted (00001510 §5).
CREATE OR REPLACE TRIGGER trg_guard_rostered_event
    BEFORE UPDATE OR DELETE ON scheduling.events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_rostered_event ();

-- A schedule's time zone is one Postgres recognises (00001510 §5).
CREATE OR REPLACE TRIGGER trg_check_schedule_timezone
    BEFORE INSERT OR UPDATE OF timezone ON scheduling.schedules
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_check_schedule_timezone ();

-- At most RESCHEDULE_PROPOSALS_MAX slots per round (00001510 §6d).
CREATE OR REPLACE TRIGGER trg_cap_reschedule_proposals
    BEFORE INSERT ON scheduling.reschedule_proposals
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_cap_reschedule_proposals ();

-- No proposal, approval or vote lands on a closed round, and a live vote's deadline moves with its
-- ballot in the same statement (`fn_guard_reschedule_write`, 00001510 §6e).
CREATE OR REPLACE TRIGGER trg_guard_reschedule_proposal_write
    BEFORE INSERT OR UPDATE OF approved ON scheduling.reschedule_proposals
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_reschedule_write ();

CREATE OR REPLACE TRIGGER trg_guard_reschedule_vote_write
    BEFORE INSERT ON scheduling.proposal_votes
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_reschedule_write ();

-- A round entering `voting` is stamped with the deadline of the ballot it holds at that instant.
CREATE OR REPLACE TRIGGER trg_stamp_vote_deadline
    BEFORE UPDATE OF status ON scheduling.event_reschedules
    FOR EACH ROW
    WHEN (NEW.status = 'voting' AND OLD.status IS DISTINCT FROM 'voting')
    EXECUTE FUNCTION scheduling.fn_stamp_vote_deadline ();

-- #region Session sittings follow their calendar entries (Decision #211)
-- A reschedule round that carries moves `scheduling.events` (close_reschedule_round); a session's sitting
-- is what the join window, presence rule and payout clock read, so it moves with its mirror
-- (`projects.trg_sitting_follows_calendar`, 00001155 §14).
CREATE OR REPLACE TRIGGER trg_sitting_follows_calendar
    AFTER UPDATE OF starts_at, ends_at ON scheduling.events
    FOR EACH ROW
    WHEN (NEW.source_session_event_id IS NOT NULL
          AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at))
    EXECUTE FUNCTION projects.trg_sitting_follows_calendar ();

-- A set-session block's scheduling handshake coming to rest confirms its provisional sitting and the
-- client's place on it (`projects.trg_session_handshake_closed`).
CREATE OR REPLACE TRIGGER trg_session_handshake_closed
    AFTER UPDATE OF status ON scheduling.event_reschedules
    FOR EACH ROW
    WHEN (NEW.status IN ('resolved', 'lapsed') AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION projects.trg_session_handshake_closed ();
-- #endregion

-- #region Scheduling and under-18 accounts (Decision #208)
CREATE OR REPLACE TRIGGER trg_schedule_age_gate
    BEFORE INSERT OR UPDATE OF is_published, owner_id ON scheduling.schedules
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_schedule_age_gate ();

CREATE OR REPLACE TRIGGER trg_call_settings_age_gate
    BEFORE INSERT OR UPDATE OF accepts_calls ON scheduling.call_settings
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_schedule_age_gate ();
-- #endregion

