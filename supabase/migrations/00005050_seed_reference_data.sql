-- Seed: reference data — search ranking weights, analytics event catalogue,
-- integration providers (from 0219, 20260724110000, 20260724101000)

-- #region search.search_weights — default scoring matrix (from 0219)
INSERT INTO search.search_weights (key, label, description, scope, weight) VALUES
  -- Universal metrics --------------------------------------------------------
  ('text_relevance',   'Text relevance',      'Full-text rank over title/description/tags',      'universal', 3.00),
  ('vector_similarity','Semantic similarity', 'pgvector cosine similarity of query vs entity',   'universal', 2.00),
  ('query_interest',   'Stated query interest','Exact tag/skill match with the search term',      'universal', 1.50),
  ('location_match',   'Location match',      'Query/user location alignment',                    'universal', 0.75),
  ('timezone_match',   'Timezone match',      'Working-hours overlap',                            'universal', 0.50),
  ('language_match',   'Language match',      'Shared spoken languages',                          'universal', 0.75),
  ('verification',     'Verification status', 'Verified identity / business boost',               'universal', 1.00),
  ('interest_history', 'Interest history',    'Viewer click/search affinity for this entity',     'universal', 1.25),
  ('review_sentiment', 'Review sentiment',    'Average review rating (proxy for sentiment)',      'universal', 1.75),
  ('review_count',     'Review volume',       'Total number of reviews (social proof)',           'universal', 1.00),
  -- Talent metrics (freelancers / teams / businesses) ------------------------
  ('penalty',          'Trust penalties',     'Discovery-rank penalty dampening (negative)',      'talent',    2.50),
  ('workload',         'Current workload',    'Prefer available talent (lower workload)',         'talent',    1.50),
  ('idle_time',        'Idle time',           'Boost talent idle with low/no workload',           'talent',    0.75),
  ('response_time',    'Response time',       'Faster median first-response ranks higher',        'talent',    1.00),
  ('member_count',     'Team size',           'Team/business capacity signal',                    'talent',    0.50),
  ('rating_freelancer','Freelancer rating',   'Historical rating in the freelancer role',         'talent',    1.50),
  ('rating_client',    'Client rating',       'Historical rating in the client role',             'talent',    0.75),
  -- Opportunity / asset metrics (projects / services) ------------------------
  ('open_seats',       'Open seats',          'Available seats / open roles',                     'opportunity', 1.25),
  ('stage_count',      'Project stages',      'Structured scope depth',                           'opportunity', 0.50),
  ('budget_range',     'Budget / payout',     'Higher budget/payout range boost',                 'opportunity', 1.50),
  ('price_tier',       'Service pricing',     'Service pricing-tier alignment',                   'opportunity', 1.00)
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region analytics.event_catalogue — registered vocabulary (from 20260724110000)
INSERT INTO analytics.event_catalogue (name, domain, description, subject_kinds, property_keys) VALUES
    -- Billing
    ('subscription.started', 'billing', 'A paid or free plan became active for a subject.',
        '{user,freelancer,team,business,organisation}', '{plan_code,tier,audience,price_cents,currency,interval}'),
    ('subscription.changed', 'billing', 'A subject moved between plans (upgrade or downgrade).',
        '{user,freelancer,team,business,organisation}', '{from_plan,to_plan,direction,reason}'),
    ('subscription.cancelled', 'billing', 'A subscription was cancelled or allowed to lapse.',
        '{user,freelancer,team,business,organisation}', '{plan_code,at_period_end,reason}'),
    -- Entitlements & allowances (the tuning substrate for every cap magnitude)
    ('entitlement.checked', 'allowance', 'An entitlement limit was resolved for a subject.',
        '{user,freelancer,team,business,organisation}', '{key,effective_limit,source}'),
    ('entitlement.denied', 'allowance', 'An action was blocked by an entitlement cap — the upgrade signal.',
        '{user,freelancer,team,business,organisation}', '{key,effective_limit,attempted}'),
    ('allowance.consumed', 'allowance', 'A metered allowance unit was spent (e.g. one proposal).',
        '{user,freelancer,team}', '{key,units,remaining,from_buffer,period_start}'),
    ('allowance.exhausted', 'allowance', 'A subject reached zero on a metered allowance.',
        '{user,freelancer,team}', '{key,granted,period_start}'),
    ('allowance.period_rolled', 'allowance', 'A new allowance period opened with a fresh grant.',
        '{user,freelancer,team}', '{key,granted,base,standing_bonus,plan_code}'),
    ('allowance.buffer_replenished', 'allowance', 'The rolling drip topped a subject''s buffer back up.',
        '{user,freelancer,team}', '{key,units,buffer_cap}'),
    -- Standing & gamification
    ('standing.recomputed', 'standing', 'The Standing score was recalculated from its metric inputs.',
        '{user,freelancer,team}', '{score,level,components}'),
    ('standing.level_changed', 'standing', 'A subject moved up or down the Standing ladder.',
        '{user,freelancer,team}', '{from_level,to_level,direction,score}'),
    ('mastery.progressed', 'standing', 'CREATE-category mastery advanced for a subject.',
        '{user,freelancer,team}', '{category,stages_completed,mastery_level,share_bp}'),
    ('achievement.awarded', 'standing', 'A milestone or achievement was granted.',
        '{user,freelancer,team}', '{code,tier}'),
    ('streak.extended', 'standing', 'A quality streak (on-time delivery, fast response) was extended.',
        '{user,freelancer,team}', '{kind,current_count,best_count}'),
    ('streak.broken', 'standing', 'A quality streak lapsed.',
        '{user,freelancer,team}', '{kind,previous_count}'),
    -- Storage & assets — the tuning substrate for the storage_megabytes ladder and the share funnel.
    -- Every subject_kind that can own bytes is listed, because quota is metered on the OWNER axis
    -- (files.owner_kind), not on the human who happened to press upload.
    ('storage.uploaded', 'storage', 'An asset was stored against an owner''s quota.',
        '{user,freelancer,team,business,organisation}',
        '{item_id,source,category,mime_type,size_bytes,owner_type,bucket_id}'),
    ('storage.dedup_hit', 'storage', 'A content hash matched an existing asset, so no new bytes were stored.',
        '{user,freelancer,team,business,organisation}',
        '{content_hash,hash_sampled,existing_item_id,size_bytes_saved}'),
    ('storage.share_created', 'storage', 'A read-only share link was minted for an asset or folder.',
        '{user,freelancer,team,business,organisation}',
        '{share_id,item_id,folder_id,visibility,expires_at,download_limit}'),
    ('storage.share_accessed', 'storage', 'A share slug was resolved — the anonymous half of the funnel.',
        '{user,freelancer,team,business,organisation}',
        '{share_id,item_id,folder_id,anonymous,referrer_domain}'),
    ('storage.download', 'storage', 'An asset was downloaded. Mirrors a files.download_events row.',
        '{user,freelancer,team,business,organisation}',
        '{item_id,via,share_slug,anonymous,repeat_download,size_bytes}'),
    ('link.scan_blocked', 'storage', 'The link-safety pipeline refused a URL asset.',
        '{user,freelancer,team,business,organisation}',
        '{item_id,link_domain,scan_status,reason}')
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region integrations.providers — connector catalogue
-- Reference data: every integrable vendor. ALL ship is_enabled=false — enabling one is an operator
-- decision that requires credentials in the Environment Variable Contract to exist first. `broker`
-- records the integration strategy (SYSTEM_ARCHITECTURE.md §Integration & Plugin Platform): calendar
-- goes through a unified API (nylas), most storage/dev goes direct, the CRM long tail via merge.
INSERT INTO
    integrations.providers (
        slug, label, category, capabilities, auth_scheme,
        is_enabled, broker, supports_webhooks, default_scopes
    )
VALUES
    -- Calendars & conferencing (MVP focus; brokered by a unified calendar API).
    ('google', 'Google', 'calendar',
        ARRAY['calendar', 'freebusy', 'conferencing']::integrations.provider_kind[], 'oauth2',
        false, 'nylas', true, ARRAY['https://www.googleapis.com/auth/calendar.events']),
    ('outlook', 'Outlook', 'calendar',
        ARRAY['calendar', 'freebusy', 'conferencing']::integrations.provider_kind[], 'oauth2',
        false, 'nylas', true, ARRAY['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite']),
    ('apple', 'Apple', 'calendar',
        ARRAY['calendar', 'freebusy']::integrations.provider_kind[], 'app_password',
        false, 'nylas', false, ARRAY[]::text[]),
    ('samsung', 'Samsung', 'calendar',
        ARRAY['calendar']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY[]::text[]),
    ('calendly', 'Calendly', 'calendar',
        ARRAY['calendar', 'freebusy']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['default']),
    ('zoom', 'Zoom', 'conferencing',
        ARRAY['conferencing']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY['meeting:write']),
    ('microsoft_teams', 'Microsoft Teams', 'conferencing',
        ARRAY['conferencing']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY['OnlineMeetings.ReadWrite']),
    ('discord', 'Discord', 'communication',
        ARRAY['conferencing', 'messaging']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY[]::text[]),
    -- Storage & docs (V2 focus; direct integrations — a unified file API is too leaky).
    ('google_drive', 'Google Drive', 'storage',
        ARRAY['storage', 'docs']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['https://www.googleapis.com/auth/drive.readonly']),
    ('dropbox', 'Dropbox', 'storage',
        ARRAY['storage']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['files.content.read']),
    -- Frame.io — review-and-approval storage for video/creative deliverables. Direct (no unified
    -- broker models its comment/version graph), webhooks for asset + comment events.
    ('frameio', 'Frame.io', 'storage',
        ARRAY['storage']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['offline', 'asset.read']),
    -- S3-compatible object storage (AWS S3, R2, Backblaze B2, MinIO …). The ONE provider that is
    -- not OAuth: there is no consent dance and no bearer token to refresh — the connection holds an
    -- access-key pair and every request is REQUEST-SIGNED, which is why `aws_sigv4` exists as its
    -- own auth_scheme rather than being folded into `api_key`. No webhooks (bucket notifications
    -- are configured on the customer's side and delivered to their own endpoint, not ours).
    ('s3', 'S3-compatible storage', 'storage',
        ARRAY['storage']::integrations.provider_kind[], 'aws_sigv4',
        false, 'direct', false, ARRAY[]::text[]),
    ('notion', 'Notion', 'productivity',
        ARRAY['docs', 'calendar']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY[]::text[]),
    -- Developer & CRM long tail (Scale; GitHub direct, the CRM tail via a unified broker).
    ('github', 'GitHub', 'developer',
        ARRAY['code', 'issues']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['repo', 'read:user']),
    ('slack', 'Slack', 'communication',
        ARRAY['messaging']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['channels:read', 'chat:write']),
    ('monday', 'Monday.com', 'crm',
        ARRAY['crm']::integrations.provider_kind[], 'oauth2',
        false, 'merge', false, ARRAY[]::text[]),
    ('google_contacts', 'Google Contacts', 'crm',
        ARRAY['contacts']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY['https://www.googleapis.com/auth/contacts.readonly'])
ON CONFLICT (slug) DO NOTHING;
-- #endregion

-- #region integrations.extension_points — plugin slot catalogue
-- The first-party registry of surfaces a plugin may inject into. Mirrors the app's own URL-keyed
-- slot resolvers (channelHeaderFor / laneFor / middleNavFooterFor …). Post-MVP, seeded now so the
-- later plugin build is not a schema change.
INSERT INTO
    integrations.extension_points (key, surface, label, description, allowed_runtimes)
VALUES
    ('messages.tab', 'page_tab', 'Messages tab',
        'A custom tab inside a conversation or channel.', ARRAY['iframe', 'declarative']::integrations.plugin_runtime[]),
    ('project.panel', 'panel', 'Project side panel',
        'A panel in the project workspace middle-nav lane.', ARRAY['iframe', 'declarative']::integrations.plugin_runtime[]),
    ('dashboard.widget', 'dashboard_widget', 'Dashboard widget',
        'A widget on the home dashboard grid.', ARRAY['iframe', 'declarative']::integrations.plugin_runtime[]),
    ('sidebar.item', 'sidebar_item', 'Sidebar item',
        'A navigation entry in the global rail.', ARRAY['declarative']::integrations.plugin_runtime[]),
    ('command.palette', 'command', 'Command',
        'An action registered in the command palette.', ARRAY['declarative', 'headless']::integrations.plugin_runtime[]),
    ('settings.section', 'settings_section', 'Settings section',
        'A configuration section under Settings → Integrations.', ARRAY['iframe', 'declarative']::integrations.plugin_runtime[]),
    ('automation.action', 'automation_action', 'Automation action',
        'A step usable in an automation/agent workflow.', ARRAY['headless']::integrations.plugin_runtime[])
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region integrations.plugin_scopes — Plugin-API permission vocabulary
-- The capability scopes a plugin version may request and a user consents to. Kept as DATA so a new
-- capability is a seed row, not a migration + type change. `risk` drives consent-UI emphasis.
INSERT INTO
    integrations.plugin_scopes (key, label, description, domain, risk)
VALUES
    ('read:profile', 'Read your profile', 'Read your public profile and handle.', 'profile', 'low'),
    ('read:messages', 'Read messages', 'Read messages in conversations you open the plugin in.', 'messaging', 'high'),
    ('write:messages', 'Send messages', 'Send messages on your behalf.', 'messaging', 'high'),
    ('read:projects', 'Read projects', 'Read your projects, stages and tickets.', 'projects', 'medium'),
    ('write:projects', 'Modify projects', 'Create or update projects, stages and tickets.', 'projects', 'high'),
    ('read:files', 'Read files', 'Read attachments and submissions.', 'files', 'medium'),
    ('write:files', 'Write files', 'Upload or modify attachments.', 'files', 'high'),
    ('read:calendar', 'Read calendar', 'Read your schedule and availability.', 'scheduling', 'medium'),
    ('write:calendar', 'Write calendar', 'Create or update calendar events.', 'scheduling', 'high'),
    ('read:catalogue', 'Read catalogue', 'Read your products and services.', 'catalogue', 'low'),
    ('read:wallet', 'Read wallet', 'Read wallet balances and transactions (never move funds).', 'finance', 'high')
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region finance.fx_rates — baseline reference observations (platform base GBP)
-- A FLOOR, not a feed. The live rate table is refreshed from the configured provider; these rows
-- exist so a from-scratch reset can resolve every supported display currency immediately instead of
-- silently rendering unconverted origin amounts on a fresh database.
--
-- Direction is fixed and non-negotiable: `rate` converts BASE into QUOTE
-- (`amount_quote = amount_base * rate`). The inverse pair is seeded explicitly rather than derived at
-- read time, because a reader that divides by the forward rate and a reader that multiplies by the
-- inverse disagree in the last minor unit, and a money figure that differs by which direction the
-- caller happened to ask in is worse than one that is merely stale.
--
-- `as_of` is a fixed reference instant, not `now()`: the seed must be byte-identical across resets so
-- a snapshot captured in a test database is reproducible. `provider = 'seed'` marks these as
-- reference data — never mistake them for a live observation (see FxService's staleness handling).
INSERT INTO
    finance.fx_rates (base, quote, rate, as_of, provider)
VALUES
    ('GBP', 'GBP', 1.0000000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'USD', 1.2700000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'EUR', 1.1700000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'CAD', 1.7300000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'AUD', 1.9300000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'JPY', 192.0000000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'INR', 106.0000000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'SGD', 1.7000000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'CHF', 1.1200000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'ZAR', 23.1000000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'NGN', 1980.0000000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('GBP', 'AED', 4.6600000000, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    -- Inverse pairs (QUOTE → GBP), seeded explicitly. See the direction note above.
    ('USD', 'GBP', 0.7874015748, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('EUR', 'GBP', 0.8547008547, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('CAD', 'GBP', 0.5780346821, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('AUD', 'GBP', 0.5181347150, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('JPY', 'GBP', 0.0052083333, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('INR', 'GBP', 0.0094339623, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('SGD', 'GBP', 0.5882352941, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('CHF', 'GBP', 0.8928571429, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('ZAR', 'GBP', 0.0432900433, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('NGN', 'GBP', 0.0005050505, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed'),
    ('AED', 'GBP', 0.2145922747, TIMESTAMPTZ '2026-08-01 00:00:00+00', 'seed')
ON CONFLICT (base, quote, as_of) DO NOTHING;
-- #endregion
