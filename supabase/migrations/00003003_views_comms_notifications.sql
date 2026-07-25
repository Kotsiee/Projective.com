-- Views: comms notification read models (from 20260724093000)

-- The inbox feed: live, in-app, unexpired rows joined to their catalog policy.
CREATE OR REPLACE VIEW comms.notification_feed
WITH (security_invoker = true) AS
SELECT
    n.id,
    n.user_id,
    n.type,
    n.title,
    n.body,
    n.category,
    n.urgency,
    n.entity_table,
    n.entity_id,
    n.context_type,
    n.context_id,
    n.actor_user_id,
    n.action_url,
    n.payload,
    n.group_key,
    n.group_count,
    n.channels,
    n.read_at,
    n.seen_at,
    n.expires_at,
    n.created_at,
    (n.read_at IS NULL) AS is_unread,
    t.mandatory,
    t.digestible,
    t.description AS type_description
FROM comms.notifications n
LEFT JOIN comms.notification_types t ON t.key = n.type
WHERE n.archived_at IS NULL
  AND (n.expires_at IS NULL OR n.expires_at > now())
  AND 'in_app' = ANY (n.channels);

COMMENT ON VIEW comms.notification_feed IS
    'The in-app inbox read model. Excludes archived, expired, and non-in_app rows (a muted event is still recorded on comms.notifications but never surfaces here). security_invoker — RLS decides visibility.';

-- Per-category unread counts, for the inbox tabs.
CREATE OR REPLACE VIEW comms.notification_unread_counts
WITH (security_invoker = true) AS
SELECT
    n.user_id,
    n.category,
    COUNT(*) FILTER (WHERE n.read_at IS NULL) AS unread,
    COUNT(*) FILTER (WHERE n.seen_at IS NULL) AS unseen,
    COUNT(*) AS total
FROM comms.notifications n
WHERE n.archived_at IS NULL
  AND (n.expires_at IS NULL OR n.expires_at > now())
  AND 'in_app' = ANY (n.channels)
GROUP BY n.user_id, n.category;

-- Ops view: what is failing, per channel, over the last day. Admin-only via RLS on the base table.
CREATE OR REPLACE VIEW comms.notification_delivery_health
WITH (security_invoker = true) AS
SELECT
    d.channel,
    d.status,
    COUNT(*) AS deliveries,
    MAX(d.created_at) AS last_seen_at
FROM comms.notification_deliveries d
WHERE d.created_at > now() - interval '1 day'
GROUP BY d.channel, d.status;
