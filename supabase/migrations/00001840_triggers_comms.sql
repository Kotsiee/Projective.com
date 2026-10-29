-- ============================================================================
-- 00001840 triggers comms
-- Consolidated verbatim from: 0311_e7_private_channels_pii_handover.sql, 20260724090000_comms_notification_catalog.sql, 20260724091000_comms_notification_preferences.sql, 20260724092000_comms_notification_delivery.sql, 20260724094000_comms_notification_rls_jobs.sql
-- ============================================================================

CREATE TRIGGER trg_mask_message_pii
    BEFORE INSERT OR UPDATE OF body, body_delta ON comms.project_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_mask_message_pii();

CREATE TRIGGER trg_dm_messages_mask_pii
    BEFORE INSERT ON comms.dm_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_mask_dm_message_pii();

CREATE TRIGGER trg_dm_messages_promote_on_reply
    BEFORE INSERT ON comms.dm_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.fn_promote_thread_on_reply();

-- Only comms.tg_dm_auto_reply marks a message automatic; a client write may not.
CREATE TRIGGER trg_dm_messages_derived
    BEFORE INSERT OR UPDATE ON comms.dm_messages
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_derived_columns('auto_response_id');

-- Settings → Messaging away replies (00001300 §Auto-replies).
CREATE TRIGGER trg_dm_messages_auto_reply
    AFTER INSERT ON comms.dm_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_dm_auto_reply();

-- A reply's original must be in the reply's own channel / thread (00001300). On UPDATE as well as
-- INSERT, scoped to the two columns that could move a reply out of its room after the fact.
CREATE TRIGGER trg_project_messages_guard_reply
    BEFORE INSERT OR UPDATE OF reply_to_id, channel_id ON comms.project_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_guard_message_reply();

CREATE TRIGGER trg_dm_messages_guard_reply
    BEFORE INSERT OR UPDATE OF reply_to_id, thread_id ON comms.dm_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_guard_dm_message_reply();

CREATE TRIGGER trg_notification_types_touch
    BEFORE UPDATE ON comms.notification_types
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notifications_touch
    BEFORE UPDATE ON comms.notifications
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notification_prefs_touch
    BEFORE UPDATE ON comms.notification_prefs
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notification_category_prefs_touch
    BEFORE UPDATE ON comms.notification_category_prefs
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notification_type_mutes_touch
    BEFORE UPDATE ON comms.notification_type_mutes
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_device_tokens_touch
    BEFORE UPDATE ON comms.device_tokens
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notification_deliveries_touch
    BEFORE UPDATE ON comms.notification_deliveries
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notification_queue_touch
    BEFORE UPDATE ON comms.notification_queue
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER trg_notification_digests_touch
    BEFORE UPDATE ON comms.notification_digests
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

CREATE TRIGGER on_notification_created_dispatch
    AFTER INSERT ON comms.notifications
    FOR EACH ROW EXECUTE FUNCTION comms.fn_dispatch_notification();

-- #region Direct-message shielding for under-18 accounts (Decision #208)
CREATE TRIGGER trg_dm_shield BEFORE INSERT ON comms.dm_participants
    FOR EACH ROW EXECUTE FUNCTION comms.trg_dm_shield();
CREATE TRIGGER trg_dm_shield BEFORE INSERT ON comms.dm_messages
    FOR EACH ROW EXECUTE FUNCTION comms.trg_dm_shield();
-- #endregion

-- #region Entity channels (Decision #306, 00001300)
-- A channel's people are its entity's active members: seeded when the channel is created, joined and
-- left as memberships become and stop being active. Every entity gets its `general` when it is created.
CREATE TRIGGER trg_entity_channel_seed_members
    AFTER INSERT ON comms.dm_threads
    FOR EACH ROW WHEN (NEW.kind = 'entity_channel')
    EXECUTE FUNCTION comms.tg_entity_channel_seed_members();

CREATE TRIGGER trg_team_member_channels
    AFTER INSERT OR UPDATE OF status ON org.team_members
    FOR EACH ROW EXECUTE FUNCTION comms.tg_entity_member_channels('team');

CREATE TRIGGER trg_business_member_channels
    AFTER INSERT OR UPDATE OF status ON org.business_members
    FOR EACH ROW EXECUTE FUNCTION comms.tg_entity_member_channels('business');

CREATE TRIGGER trg_team_default_channel
    AFTER INSERT ON org.teams
    FOR EACH ROW EXECUTE FUNCTION comms.tg_entity_default_channel('team');

CREATE TRIGGER trg_business_default_channel
    AFTER INSERT ON org.business_profiles
    FOR EACH ROW EXECUTE FUNCTION comms.tg_entity_default_channel('business');
-- #endregion
