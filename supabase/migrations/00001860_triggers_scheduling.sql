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

CREATE OR REPLACE TRIGGER trg_routines_touch
    BEFORE UPDATE ON scheduling.routines
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

-- Entries follow their routine's behaviour, and a commitment can never be passive (00001510 §5b).
CREATE OR REPLACE TRIGGER trg_routine_behavior
    AFTER UPDATE OF behavior ON scheduling.routines
    FOR EACH ROW
    WHEN (NEW.behavior IS DISTINCT FROM OLD.behavior)
    EXECUTE FUNCTION scheduling.trg_routine_behavior ();

CREATE OR REPLACE TRIGGER trg_guard_event_behavior
    BEFORE INSERT OR UPDATE OF availability_behavior, kind, project_id, source_session_event_id
    ON scheduling.events
    FOR EACH ROW
    WHEN (NEW.availability_behavior = 'passive')
    EXECUTE FUNCTION scheduling.fn_guard_event_behavior ();

CREATE OR REPLACE TRIGGER trg_seat_holds_time
    AFTER INSERT OR UPDATE ON scheduling.event_attendees
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_seat_holds_time ();

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

-- Rooms follow what they belong to (00001510 §7d), so no booking door has to know about them.
CREATE OR REPLACE TRIGGER trg_rooms_touch
    BEFORE UPDATE ON scheduling.rooms
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_call_room
    AFTER INSERT OR UPDATE OF status ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_sync_call_room ();

CREATE OR REPLACE TRIGGER trg_sitting_provider
    BEFORE INSERT ON projects.session_events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_sitting_provider ();

CREATE OR REPLACE TRIGGER trg_sitting_room
    AFTER INSERT OR UPDATE OF status, start_time, end_time ON projects.session_events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_sync_sitting_room ();

CREATE OR REPLACE TRIGGER trg_entry_room
    AFTER UPDATE OF status, starts_at, ends_at ON scheduling.events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_sync_entry_room ();

-- #region Outbound mirrors follow their event (00001510 §7g; Decision #383, ruling R3)
-- A busy row read from a provider queues nothing, and this WHEN is what keeps a full read cheap.
-- attendee_count is here because it is what changes when a group seat starts or ends, and
-- availability_behavior because a copy says whether it blocks time. routine_id is not: a routine is
-- never in a copy, so organising an entry writes nothing to a provider.
CREATE OR REPLACE TRIGGER trg_event_mirrors_touch
    BEFORE UPDATE ON scheduling.event_mirrors
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_event_mirrors
    AFTER INSERT OR UPDATE OF title, starts_at, ends_at, all_day, status, archived_at, external_sync, attendee_count, availability_behavior
    ON scheduling.events
    FOR EACH ROW
    WHEN (NEW.source_connection_id IS NULL AND NEW.kind NOT IN ('availability', 'busy'))
    EXECUTE FUNCTION scheduling.trg_event_mirrors ();

-- BEFORE, because the FK nulls event_id on the way out and this has to find the copies first.
CREATE OR REPLACE TRIGGER trg_event_mirrors_deleted
    BEFORE DELETE ON scheduling.events
    FOR EACH ROW
    WHEN (OLD.source_connection_id IS NULL AND OLD.kind NOT IN ('availability', 'busy'))
    EXECUTE FUNCTION scheduling.trg_event_mirrors ();

-- A call that took place changes nothing its copy says, so the sweep writes to no provider.
CREATE OR REPLACE TRIGGER trg_call_mirrors
    AFTER INSERT OR UPDATE OF status, confirmed_start, confirmed_end, event_id ON scheduling.discovery_calls
    FOR EACH ROW
    WHEN (NEW.status NOT IN ('completed', 'no_show'))
    EXECUTE FUNCTION scheduling.trg_call_mirrors ();

CREATE OR REPLACE TRIGGER trg_call_mirrors_deleted
    BEFORE DELETE ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_call_mirrors ();

CREATE OR REPLACE TRIGGER trg_attendee_mirrors
    AFTER INSERT OR UPDATE OF response, user_id, archived_at OR DELETE ON scheduling.event_attendees
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_attendee_mirrors ();

CREATE OR REPLACE TRIGGER trg_room_mirrors_opened
    AFTER INSERT ON scheduling.rooms
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_room_mirrors ();

CREATE OR REPLACE TRIGGER trg_room_mirrors_changed
    AFTER UPDATE OF status ON scheduling.rooms
    FOR EACH ROW
    WHEN ((OLD.status IN ('failed', 'closing', 'closed')) IS DISTINCT FROM (NEW.status IN ('failed', 'closing', 'closed')))
    EXECUTE FUNCTION scheduling.trg_room_mirrors ();
-- #endregion

-- A rostered event moves only through its negotiation and is never deleted (00001510 §5).
CREATE OR REPLACE TRIGGER trg_guard_rostered_event
    BEFORE UPDATE OR DELETE ON scheduling.events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_rostered_event ();

-- A recurring series stays on one anchor and one level deep (00001510 §5).
CREATE OR REPLACE TRIGGER trg_guard_event_recurrence
    BEFORE INSERT OR UPDATE OF recurrence_rule, recurrence_parent_id, schedule_id, project_id ON scheduling.events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_guard_event_recurrence ();

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

-- A sitting's mirror is negotiated only 1-on-1, and only for a 1-1 engagement: a group sitting is never
-- put to a reschedule round, so no majority can move a seat-holder's sitting under them
-- (`projects.trg_sitting_round_guard`, 00001155 §4c).
CREATE OR REPLACE TRIGGER trg_sitting_round_guard
    BEFORE INSERT OR UPDATE OF event_id, mode ON scheduling.event_reschedules
    FOR EACH ROW EXECUTE FUNCTION projects.trg_sitting_round_guard ();
-- #endregion

-- #region Scheduling and under-18 accounts (Decision #208)
CREATE OR REPLACE TRIGGER trg_schedule_age_gate
    BEFORE INSERT OR UPDATE OF is_published, owner_id ON scheduling.schedules
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_schedule_age_gate ();

CREATE OR REPLACE TRIGGER trg_call_settings_age_gate
    BEFORE INSERT OR UPDATE OF accepts_calls ON scheduling.call_settings
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_schedule_age_gate ();
-- #endregion

-- #region Availability presets & recurrence (Decision #217, 00001510 §10)
CREATE OR REPLACE TRIGGER trg_availability_presets_touch
    BEFORE UPDATE ON scheduling.availability_presets
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_recurrence_rules_touch
    BEFORE UPDATE ON scheduling.recurrence_rules
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

-- No preset for a minor, and a service fork names a service sold from its schedule.
CREATE OR REPLACE TRIGGER trg_preset_guard
    BEFORE INSERT OR UPDATE ON scheduling.availability_presets
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_preset_guard ();

-- A blueprint binds only a live preset of its owner's schedule (the CHECK half of the 00000031 FK).
CREATE OR REPLACE TRIGGER trg_blueprint_preset_binding
    BEFORE INSERT OR UPDATE OF availability_preset_id, owner_team_id, freelancer_profile_id
    ON marketplace.service_blueprints
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_blueprint_preset_binding ();

-- A rule, a band or the schedule's zone changing makes the compiled spans stale.
CREATE OR REPLACE TRIGGER trg_recurrence_rules_invalidate
    AFTER INSERT OR UPDATE OR DELETE ON scheduling.recurrence_rules
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_invalidate_preset_compilation ();

CREATE OR REPLACE TRIGGER trg_recurrence_rule_bands_invalidate
    AFTER INSERT OR UPDATE OR DELETE ON scheduling.recurrence_rule_bands
    FOR EACH ROW EXECUTE FUNCTION scheduling.trg_invalidate_preset_compilation ();

CREATE OR REPLACE TRIGGER trg_schedule_timezone_invalidates_presets
    AFTER UPDATE OF timezone ON scheduling.schedules
    FOR EACH ROW
    WHEN (NEW.timezone IS DISTINCT FROM OLD.timezone)
    EXECUTE FUNCTION scheduling.trg_invalidate_preset_compilation ();
-- #endregion

