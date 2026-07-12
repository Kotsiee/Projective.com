CREATE OR REPLACE VIEW org.view_business_staff AS
SELECT
    bm.business_id,
    bm.user_id,
    bm.role as membership_role,
    bm.status,
    bm.joined_at,
    up.first_name,
    up.last_name,
    up.username,
    up.avatar_file_id,
    ue.email
FROM org.business_members bm
    JOIN org.users_public up ON up.user_id = bm.user_id
    LEFT JOIN org.user_emails ue ON ue.user_id = bm.user_id
    AND ue.is_primary = true;

GRANT SELECT ON org.view_business_staff TO authenticated;