-- =============================================================================================
-- 20260724090000_comms_notification_catalog.sql
-- Notification engine foundation (1/5) — the type catalog, routing vocabulary & event envelope.
--
-- ADDITIVE ONLY. Adds seven `comms`-scoped enums, one registry table, and nullable/defaulted
-- columns on the pre-existing `comms.notifications`. No existing column, FK, function, or table is
-- dropped or altered. Authored, NOT applied to any live database (root CLAUDE.md §1, Decision #47
-- / #54 precedent — pushing migrations is a human step).
--
-- WHY A CATALOG. Before this change a notification was four free-text strings written by
-- `comms.fn_notify` (migration 0305): no category, no urgency, no channel routing, no dedupe, no
-- quiet-hours semantics. The routing matrix ("critical events override quiet hours", "still unread
-- after 15m → email", "collapse repeated mentions") cannot be expressed per-call-site without
-- duplicating policy across every RPC that emits an event. `comms.notification_types` makes the
-- policy DATA: one row per event key declaring its category, urgency, default channel fan-out,
-- whether a user may mute it, whether it pierces quiet hours, and how long a dedupe window lasts.
--
-- ⚠️ DELIBERATELY NOT A FOREIGN KEY. `comms.notifications.type` is NOT constrained to this catalog.
-- An unregistered type must never raise inside an escrow/stage money-movement RPC — `fn_notify`
-- (migration 4/5) auto-registers an unknown key as `system`/`medium` and carries on. The catalog is
-- policy, not a gate.
--
-- ⚠️ FLAGGED CONFLICT (surface, do not silently resolve — root CLAUDE.md §8). Two notification-key
-- conventions exist in the repo today:
--   * `documentation/database/comms/Tables.md` documents DOTTED keys (`message.new`,
--     `stage.status_changed`);
--   * the live callers in migrations 0305 / 0311 emit UNDERSCORED keys (`stage_funded`,
--     `stage_approved`, `stage_cancelled`, `project_handover`).
-- Resolved here NON-DESTRUCTIVELY: the dotted `domain.event` form is canonical (it matches the
-- documented convention and the platform's wider event naming), and each affected catalog row
-- carries the legacy underscored key in `aliases[]` so the four existing emit sites keep working
-- BYTE-FOR-BYTE UNCHANGED. Rewriting the escrow/stage RPCs is a behavioural change to money-movement
-- functions and needs human sign-off — it is not done here.
-- =============================================================================================

-- #region 1. Routing vocabulary (comms-scoped enums)
-- Schema-scoped rather than public, matching the `finance.*` enum precedent (migrations
-- 20260723090000..094000) — these words only mean something inside the notification engine.

-- The transports a notification can be delivered over. `in_app` is the Supabase Realtime stream on
-- `comms.notifications` (already published, migration 0206); the rest are Edge-Function gateways.
DO $$ BEGIN
    CREATE TYPE comms.notification_channel AS ENUM ('in_app', 'push', 'email', 'sms', 'webhook');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- How loudly an event may interrupt. `critical` is the only tier that pierces a global snooze;
-- `critical`/`high` may pierce quiet hours when the catalog row opts in.
DO $$ BEGIN
    CREATE TYPE comms.notification_urgency AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The user-facing grouping the preference centre and the inbox filter tabs are built from. Keep
-- this list short — it is a UI taxonomy, not an event namespace.
DO $$ BEGIN
    CREATE TYPE comms.notification_category AS ENUM (
        'money',      -- escrow, payouts, wallet, invoices, disputes over funds
        'work',       -- projects, stages, tickets, submissions, applications
        'messages',   -- DMs, channel messages, mentions, reactions
        'schedule',   -- sessions, bookings, reminders, reschedules
        'discovery',  -- marketplace, catalogue, reviews, follows, suggestions
        'account',    -- identity, verification, team/org membership, permissions
        'system',     -- security, moderation, policy, maintenance
        'marketing'   -- opt-in only; never mandatory
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Per-(notification, channel) delivery outcome. `suppressed` = policy said no (muted, quiet hours,
-- unverified address); `skipped` = nothing to send to (no device token, no email on file).
DO $$ BEGIN
    CREATE TYPE comms.delivery_status AS ENUM (
        'pending', 'queued', 'sent', 'delivered', 'failed', 'suppressed', 'skipped'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Digest cadence. `off` means "deliver in real time", not "deliver nothing".
DO $$ BEGIN
    CREATE TYPE comms.digest_frequency AS ENUM ('off', 'daily', 'weekly');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Push registration target. `web` = Web Push (VAPID); `ios` = APNs; `android` = FCM.
DO $$ BEGIN
    CREATE TYPE comms.device_platform AS ENUM ('web', 'ios', 'android');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Lifecycle of a deferred/scheduled send sitting in `comms.notification_queue`.
DO $$ BEGIN
    CREATE TYPE comms.queue_status AS ENUM ('scheduled', 'processing', 'sent', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. comms.notification_types — the routing matrix as data
CREATE TABLE IF NOT EXISTS comms.notification_types (
    -- Canonical dotted `domain.event` key. This is what `comms.notifications.type` should carry.
    key text PRIMARY KEY,
    -- Historic / alternate keys that resolve to this row (see the flagged conflict in the header).
    aliases text[] NOT NULL DEFAULT '{}'::text[],
    category comms.notification_category NOT NULL,
    urgency comms.notification_urgency NOT NULL DEFAULT 'medium',
    -- The fan-out attempted before user preferences are applied. Preferences may only NARROW this
    -- set (except for `mandatory` rows, where the transport toggles are ignored).
    default_channels comms.notification_channel[] NOT NULL DEFAULT ARRAY['in_app']::comms.notification_channel[],
    -- TRUE = the user cannot mute this event (security, legal, money-movement, moderation). The
    -- preference centre must render these as read-only, never hide them.
    mandatory boolean NOT NULL DEFAULT false,
    -- TRUE = push/SMS still fire inside the recipient's quiet hours. Reserve for genuinely
    -- time-critical events (a session starting in 5 minutes, a security alert, a failed payout).
    overrides_quiet_hours boolean NOT NULL DEFAULT false,
    -- TRUE = may be rolled into a daily/weekly digest instead of sent individually.
    digestible boolean NOT NULL DEFAULT true,
    -- TRUE = also write a `security.audit_logs` row (financial + security + moderation events).
    audit boolean NOT NULL DEFAULT false,
    -- Collapse window: a second event with the same `(user_id, group_key)` inside this interval
    -- refreshes the existing notification instead of creating a new one. NULL = never collapse.
    group_window interval,
    -- Deep-link template resolved by the client. `{id}` / `{entity_id}` / `{context_id}` are
    -- substituted from the notification's own columns; NULL = the inbox row is not clickable.
    action_url_template text,
    -- Suggested lead time for reminder-style events, consumed by `comms.fn_enqueue` schedulers.
    default_lead_time interval,
    description text NOT NULL DEFAULT '',
    -- FALSE retires an event without deleting the row (root CLAUDE.md §5 — nothing is hard-deleted).
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
    CONSTRAINT notification_types_marketing_never_mandatory CHECK (NOT (category = 'marketing' AND mandatory)),
    CONSTRAINT notification_types_channels_not_empty CHECK (array_length(default_channels, 1) >= 1)
);

COMMENT ON TABLE comms.notification_types IS
    'Registry of every notification event key and its routing policy (category, urgency, channel fan-out, mute-ability, quiet-hours override, dedupe window). Policy-as-data; deliberately NOT referenced by a FK from comms.notifications so an unregistered key can never raise inside a money-movement RPC.';

-- Alias resolution is an array containment lookup (`p_key = ANY (aliases)`), so a GIN index over
-- the array is the right shape. Uniqueness across rows is not enforceable by an index here —
-- `comms.fn_resolve_type_key` (§6) resolves deterministically (lowest key wins) instead of raising,
-- because an emit site must never fail on a catalog data problem.
CREATE INDEX IF NOT EXISTS idx_notification_types_aliases ON comms.notification_types USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_notification_types_category ON comms.notification_types (category) WHERE enabled;
-- #endregion

-- #region 3. Catalog seed — the platform's notification vocabulary
-- Idempotent: ON CONFLICT DO NOTHING so a re-run never clobbers a hand-tuned row. Amending a
-- shipped row's policy is a follow-up migration, not an edit here.
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
-- ── money ─────────────────────────────────────────────────────────────────────────────────────
('escrow.funded',            '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'Escrow secured for a stage — work may begin.'),
('escrow.released',          '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/wallet/transactions',                      NULL, 'Held escrow was released to the payee.'),
('escrow.refunded',          '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/transactions',                      NULL, 'Escrow was returned to the payer.'),
('escrow.disputed',          '{}',                'money',     'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/wallet/activity',                          NULL, 'Funds moved to the Dispute Lockbox.'),
('payout.sent',              '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/payouts',                           NULL, 'A payout left the platform toward your bank.'),
('payout.failed',            '{}',                'money',     'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/wallet/payouts',                           NULL, 'A payout could not be completed.'),
('payout.method_required',   '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, false, '7 days',          '/wallet/methods',                           NULL, 'Earnings are waiting but no payout method is set up.'),
('wallet.topup_succeeded',   '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  true,  NULL,              '/wallet/transactions',                      NULL, 'A top-up landed in the wallet.'),
('wallet.topup_failed',      '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/wallet/methods',                           NULL, 'A top-up was declined.'),
('wallet.low_balance',       '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '3 days',          '/wallet',                                   NULL, 'Balance fell below the configured floor.'),
('wallet.funds_pending',     '{}',                'money',     'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/wallet',                                   NULL, 'Released funds entered the 7-day safety window.'),
('wallet.funds_available',   '{}',                'money',     'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, NULL,              '/wallet',                                   NULL, 'Pending funds cleared and are now withdrawable.'),
('invoice.issued',           '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, false, NULL,              '/wallet/invoices',                          NULL, 'An invoice was issued.'),
('invoice.overdue',          '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, false, '1 day',           '/wallet/invoices',                          NULL, 'An invoice passed its due date.'),
('statement.ready',          '{}',                'money',     'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              '/wallet/invoices',                          NULL, 'A monthly statement is ready to download.'),
('chargeback.opened',        '{}',                'money',     'critical', ARRAY['in_app','email']::comms.notification_channel[],        true,  true,  false, true,  NULL,              '/wallet/activity',                          NULL, 'A card chargeback was opened against a payment.'),
('spend_approval.requested', '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, true,  NULL,              '/wallet/access',                            NULL, 'A vault member requested approval to spend.'),
('spend_approval.decided',   '{}',                'money',     'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  true,  NULL,              '/wallet/access',                            NULL, 'A spend request was approved or rejected.'),
('split.distributed',        '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  true,  NULL,              '/wallet/transactions',                      NULL, 'A team split paid out your share.'),
('smoother.deposit',         '{}',                'money',     'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/wallet',                                   NULL, 'The Income Smoother made its scheduled deposit.'),
-- ── work ──────────────────────────────────────────────────────────────────────────────────────
('stage.funded',             '{stage_funded}',    'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A stage''s escrow was funded — work can begin.'),
('stage.approved',           '{stage_approved}',  'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A stage was approved and the payout released.'),
('stage.cancelled',          '{stage_cancelled}', 'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A stage was cancelled under fair exit.'),
('stage.invite',             '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}',                    NULL, 'You were invited to join a stage.'),
('stage.deadline_approaching','{}',               'work',      'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, '12 hours',        '/projects/{context_id}',                    '2 days', 'A stage deadline is close.'),
('stage.deadline_missed',    '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}',                    NULL, 'A stage deadline passed without delivery.'),
('ticket.assigned',          '{}',                'work',      'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, false, false, false, NULL,              '/projects/{context_id}/board',              NULL, 'A ticket was assigned to you.'),
('ticket.claimed',           '{}',                'work',      'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '30 minutes',      '/projects/{context_id}/board',              NULL, 'A freelancer claimed a ticket.'),
('ticket.revision_requested','{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/board',              NULL, 'A revision was requested on a ticket.'),
('ticket.completed',         '{}',                'work',      'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '30 minutes',      '/projects/{context_id}/board',              NULL, 'A ticket moved to completed.'),
('submission.received',      '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/submissions',        NULL, 'A deliverable was submitted for review.'),
('submission.accepted',      '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}/submissions',        NULL, 'A submission was accepted.'),
('submission.revision_requested','{}',            'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/submissions',        NULL, 'A submission needs revision.'),
('submission.awaiting_review','{}',               'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, '1 day',           '/projects/{context_id}/submissions',        '3 days', 'A submission has been waiting on the client (ghosting reminder).'),
('submission.auto_approved', '{}',                'work',      'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/projects/{context_id}/submissions',        NULL, 'A submission auto-approved after the review window elapsed.'),
('project.handover',         '{project_handover}','work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A project completed — contact sharing and files unlocked.'),
('project.completed',        '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              '/projects/{context_id}',                    NULL, 'A project reached its terminal state.'),
('project.member_joined',    '{}',                'work',      'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 hour',          '/projects/{context_id}/members',            NULL, 'Someone joined a project you are on.'),
('application.received',     '{}',                'work',      'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, '1 hour',          '/projects/{context_id}',                    NULL, 'Someone applied to your project or stage.'),
('application.accepted',     '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}',                    NULL, 'Your application was accepted.'),
('application.declined',     '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              '/projects',                                 NULL, 'Your application was declined.'),
-- ── messages ──────────────────────────────────────────────────────────────────────────────────
('message.new',              '{}',                'messages',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, '5 minutes',       '/messages/{entity_id}',                     NULL, 'A new message arrived in a conversation.'),
('message.mention',          '{}',                'messages',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, '5 minutes',       '/messages/{entity_id}',                     NULL, 'You were @mentioned.'),
('message.reaction',         '{}',                'messages',  'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '15 minutes',      '/messages/{entity_id}',                     NULL, 'Someone reacted to your message.'),
('channel.invited',          '{}',                'messages',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, NULL,              '/projects/{context_id}',                    NULL, 'You were added to a channel.'),
-- ── schedule ──────────────────────────────────────────────────────────────────────────────────
('session.booked',           '{}',                'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A session was booked.'),
('session.rescheduled',      '{}',                'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A session moved to a new time.'),
('session.cancelled',        '{}',                'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}/calendar',           NULL, 'A session was cancelled.'),
('session.reminder_60m',     '{}',                'schedule',  'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/projects/{context_id}/calendar',           '1 hour', 'A session starts in an hour.'),
('session.reminder_15m',     '{}',                'schedule',  'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/projects/{context_id}/calendar',           '15 minutes', 'A session starts in 15 minutes.'),
('session.reminder_5m',      '{}',                'schedule',  'critical', ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/projects/{context_id}/calendar',           '5 minutes', 'A session is about to start.'),
('session.reschedule_vote',  '{}',                'schedule',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A cohort reschedule vote is open.'),
('availability.booking_request','{}',             'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/{handle}/availability',                    NULL, 'Someone requested a slot in your availability.'),
-- ── discovery ─────────────────────────────────────────────────────────────────────────────────
('catalogue.listing_published','{}',              'discovery', 'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/catalogue/{entity_id}',                    NULL, 'A listing went live.'),
('catalogue.listing_paused', '{}',                'discovery', 'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/catalogue/{entity_id}',                    NULL, 'A listing was paused.'),
('basket.abandoned',         '{}',                'discovery', 'low',      ARRAY['email']::comms.notification_channel[],                 false, false, true,  false, '3 days',          '/explore',                                  '1 day', 'Items were left in the basket.'),
('suggestion.next_steps',    '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '7 days',          '/explore',                                  NULL, 'Suggested next steps based on recent activity.'),
('review.received',          '{}',                'discovery', 'medium',   ARRAY['in_app','push','email']::comms.notification_channel[], false, false, true,  false, NULL,              '/{handle}/reviews',                         NULL, 'You received a review.'),
('review.reminder',          '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '7 days',          '/projects/{context_id}',                    '3 days', 'A completed engagement is waiting on your review.'),
('profile.followed',         '{}',                'discovery', 'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 day',           '/{handle}',                                 NULL, 'Someone followed your profile.'),
('search.saved_alert',       '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '1 day',           '/explore',                                  NULL, 'New results matched a saved search.'),
-- ── account ───────────────────────────────────────────────────────────────────────────────────
('account.email_verified',   '{}',                'account',   'medium',   ARRAY['in_app']::comms.notification_channel[],                true,  false, false, true,  NULL,              '/settings',                                 NULL, 'An email address was confirmed.'),
('account.password_changed', '{}',                'account',   'critical', ARRAY['in_app','email']::comms.notification_channel[],        true,  true,  false, true,  NULL,              '/settings',                                 NULL, 'The account password was changed.'),
('account.new_device_login', '{}',                'account',   'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/settings',                                 NULL, 'A sign-in came from an unrecognised device.'),
('account.kyc_submitted',    '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Identity verification was submitted.'),
('account.kyc_verified',     '{}',                'account',   'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Identity verification succeeded.'),
('account.kyc_rejected',     '{}',                'account',   'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Identity verification was rejected.'),
('account.role_changed',     '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Your capabilities on the platform changed.'),
('team.invite',              '{}',                'account',   'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/settings',                                 NULL, 'You were invited to a team.'),
('team.member_joined',       '{}',                'account',   'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 hour',          '/settings',                                 NULL, 'Someone joined your team.'),
('org.domain_colleague',     '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '1 day',           '/settings',                                 NULL, 'A colleague from your corporate domain joined (PRODUCT_SPEC §Organisations).'),
('business.permission_changed','{}',              'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Your permissions on a business or vault changed.'),
-- ── system ────────────────────────────────────────────────────────────────────────────────────
('system.security_alert',    '{}',                'system',    'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/settings',                                 NULL, 'A security event needs your attention.'),
('system.maintenance',       '{}',                'system',    'medium',   ARRAY['in_app']::comms.notification_channel[],                true,  false, false, false, NULL,              NULL,                                        NULL, 'Planned maintenance affecting the platform.'),
('system.policy_update',     '{}',                'system',    'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              NULL,                                        NULL, 'Terms, privacy, or fee policy changed.'),
('dispute.opened',           '{}',                'system',    'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A dispute was opened on an engagement.'),
('dispute.resolved',         '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A dispute reached a resolution.'),
('report.filed',             '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              NULL,                                        NULL, 'Content you own was reported.'),
('moderation.action',        '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              NULL,                                        NULL, 'A moderation decision was applied to your account or content.'),
-- ── marketing (opt-in only; `mandatory` is barred by CHECK) ────────────────────────────────────
('marketing.newsletter',     '{}',                'marketing', 'low',      ARRAY['email']::comms.notification_channel[],                 false, false, true,  false, NULL,              NULL,                                        NULL, 'Platform newsletter (double opt-in, see packages/types/newsletter).'),
('marketing.product_update', '{}',                'marketing', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              NULL,                                        NULL, 'New platform features and product news.')
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region 4. comms.notifications — the event envelope (additive columns only)
-- The pre-existing shape (id, user_id, type, title, body, entity_table, entity_id, read_at,
-- created_at) is untouched. Everything below is nullable or defaulted, so every existing row and
-- every existing INSERT keeps working unchanged.
ALTER TABLE comms.notifications
    -- Denormalized from the catalog at write time so the inbox can filter/sort without a join and
    -- so a later catalog re-classification never rewrites history.
    ADD COLUMN IF NOT EXISTS category comms.notification_category NOT NULL DEFAULT 'system',
    ADD COLUMN IF NOT EXISTS urgency comms.notification_urgency NOT NULL DEFAULT 'medium',
    -- Who caused the event. NULL = the platform itself (cron, webhook, system action).
    ADD COLUMN IF NOT EXISTS actor_user_id uuid,
    -- Which workspace the event belongs to, so the inbox can scope to the active context
    -- (root CLAUDE.md Decision #16 — personal | team | business | organisation | project).
    ADD COLUMN IF NOT EXISTS context_type text,
    ADD COLUMN IF NOT EXISTS context_id uuid,
    -- Resolved deep link (the catalog's template with the row's own ids substituted).
    ADD COLUMN IF NOT EXISTS action_url text,
    -- Render/localization data (amounts, counts, names). NEVER PII or secret material.
    ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Collapse key for the catalog's `group_window` (e.g. `message:{channel_id}`).
    ADD COLUMN IF NOT EXISTS group_key text,
    -- How many source events this row represents after collapsing (1 = not collapsed).
    ADD COLUMN IF NOT EXISTS group_count integer NOT NULL DEFAULT 1,
    -- The transports resolved for this row at write time (audit of what the router decided).
    ADD COLUMN IF NOT EXISTS channels comms.notification_channel[] NOT NULL DEFAULT ARRAY['in_app']::comms.notification_channel[],
    -- `seen_at` clears the badge (the inbox was opened); `read_at` (pre-existing) means this row was
    -- actually opened. Two distinct signals — do not conflate them.
    ADD COLUMN IF NOT EXISTS seen_at timestamptz,
    -- Nothing is hard-deleted (root CLAUDE.md §5): dismissing archives.
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    -- After this instant the row stops surfacing in the live inbox (reminders, time-boxed offers).
    ADD COLUMN IF NOT EXISTS expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Actor references the same public identity table the recipient does. ON DELETE SET NULL keeps the
-- notification (history) when an actor identity is removed — additive, no existing FK altered.
DO $$ BEGIN
    ALTER TABLE comms.notifications
        ADD CONSTRAINT notifications_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE comms.notifications
        ADD CONSTRAINT notifications_context_type_check
        CHECK (context_type IS NULL OR context_type IN ('personal', 'project', 'team', 'business', 'organisation', 'conversation'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE comms.notifications
        ADD CONSTRAINT notifications_group_count_positive CHECK (group_count >= 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;

COMMENT ON COLUMN comms.notifications.seen_at IS
    'Badge-cleared timestamp (the inbox was opened). Distinct from read_at, which means this specific notification was opened.';
COMMENT ON COLUMN comms.notifications.payload IS
    'Render/localization data only (amounts, counts, display names). Never PII, never secret material — PRODUCT_SPEC §Data Privacy & The Vault.';
-- #endregion

-- #region 5. Indexes for the inbox, the badge, and entity back-references
-- The inbox feed: newest-first, live rows only.
CREATE INDEX IF NOT EXISTS idx_notifications_user_feed
    ON comms.notifications (user_id, created_at DESC)
    WHERE archived_at IS NULL;

-- The unread badge count — the hottest query in the shell.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON comms.notifications (user_id, category)
    WHERE read_at IS NULL AND archived_at IS NULL;

-- Category tab filtering.
CREATE INDEX IF NOT EXISTS idx_notifications_user_category
    ON comms.notifications (user_id, category, created_at DESC)
    WHERE archived_at IS NULL;

-- Dedupe/collapse lookup inside `fn_notify`.
CREATE INDEX IF NOT EXISTS idx_notifications_group
    ON comms.notifications (user_id, group_key, created_at DESC)
    WHERE group_key IS NOT NULL AND archived_at IS NULL;

-- "Show me every notification about this stage" + the escalation jobs' back-reference.
CREATE INDEX IF NOT EXISTS idx_notifications_entity
    ON comms.notifications (entity_table, entity_id)
    WHERE entity_id IS NOT NULL;

-- Workspace-scoped inbox.
CREATE INDEX IF NOT EXISTS idx_notifications_context
    ON comms.notifications (context_type, context_id, created_at DESC)
    WHERE context_id IS NOT NULL;

-- The expiry sweep (§5/5 cron).
CREATE INDEX IF NOT EXISTS idx_notifications_expiring
    ON comms.notifications (expires_at)
    WHERE expires_at IS NOT NULL AND archived_at IS NULL;

-- The "still unread after N minutes → escalate to email" job.
CREATE INDEX IF NOT EXISTS idx_notifications_escalation
    ON comms.notifications (created_at)
    WHERE read_at IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_type ON comms.notifications (type, created_at DESC);
-- #endregion

-- #region 6. Type resolution — canonical key from any registered alias
-- Pure and total: an unknown key resolves to itself so a caller is never blocked. Used by
-- `comms.fn_notify` (migration 4/5) to translate the legacy underscored keys emitted by the escrow
-- RPCs (0305 / 0311) into their canonical dotted form without editing those functions.
CREATE OR REPLACE FUNCTION comms.fn_resolve_type_key(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = comms, public
AS $$
    SELECT COALESCE(
        (SELECT nt.key FROM comms.notification_types nt WHERE nt.key = p_key),
        (SELECT nt.key FROM comms.notification_types nt WHERE p_key = ANY (nt.aliases) ORDER BY nt.key LIMIT 1),
        p_key
    );
$$;

COMMENT ON FUNCTION comms.fn_resolve_type_key(text) IS
    'Maps a notification type key (canonical or legacy alias) to its canonical catalog key. Total — an unregistered key resolves to itself so an emit site can never fail.';

-- Keeps `updated_at` honest on the catalog.
CREATE OR REPLACE FUNCTION comms.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_types_touch ON comms.notification_types;
CREATE TRIGGER trg_notification_types_touch
    BEFORE UPDATE ON comms.notification_types
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_notifications_touch ON comms.notifications;
CREATE TRIGGER trg_notifications_touch
    BEFORE UPDATE ON comms.notifications
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();
-- #endregion
