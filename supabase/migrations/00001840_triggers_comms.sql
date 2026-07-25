-- ============================================================================
-- 00001840 triggers comms
-- Consolidated verbatim from: 0311_e7_private_channels_pii_handover.sql, 20260724090000_comms_notification_catalog.sql, 20260724091000_comms_notification_preferences.sql, 20260724092000_comms_notification_delivery.sql, 20260724094000_comms_notification_rls_jobs.sql
-- ============================================================================

CREATE TRIGGER trg_mask_message_pii
    BEFORE INSERT ON comms.project_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_mask_message_pii();

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
