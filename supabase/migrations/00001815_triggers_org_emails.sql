-- ============================================================================
-- 00001815 triggers org emails
-- The org.user_emails column guard (function: 00001050 §4). Defence in depth under the grants: the
-- table is read-only to a client (00002010 / 00002520), and this refuses a client role's write to
-- `verified_at` / `email` / `is_primary` / `user_id` should a grant or policy ever come back.
-- ============================================================================

CREATE TRIGGER user_emails_guard
BEFORE INSERT OR UPDATE ON org.user_emails
FOR EACH ROW
EXECUTE FUNCTION org.trg_user_emails_guard();
