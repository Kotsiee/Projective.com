-- Seed: reference data — search ranking weights, analytics event catalogue,
-- integration providers (from 0219, 20260724110000, 20260724101000)

-- #region search.search_weights — default scoring matrix (from 0219)
INSERT INTO search.search_weights (key, label, description, scope, weight) VALUES
  -- Universal metrics --------------------------------------------------------
  ('text_relevance',   'Text relevance',      'Best match: how well the typed words match title, tags, summary, owner (0-1)', 'universal', 6.00),
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
  ('discovery_boost',  'Discovery Boost',     'New or first-rung talent, fully available, clean record (earned, never sold)', 'talent', 1.25),
  -- Opportunity / asset metrics (projects / services) ------------------------
  ('open_seats',       'Open seats',          'Available seats / open roles',                     'opportunity', 1.25),
  ('stage_count',      'Project stages',      'Structured scope depth',                           'opportunity', 0.50),
  ('budget_range',     'Budget / payout',     'Higher budget/payout range boost',                 'opportunity', 1.50),
  ('price_tier',       'Service pricing',     'Service pricing-tier alignment',                   'opportunity', 1.00),
  -- Decision #486 (C): a warned client's project openings fall by this much (score below 3.00 from 3
  -- reviews). 2.50 is the `penalty` term's, so a warned client's brief falls as far as a penalised
  -- seller's listing (flag (c)'s proposal).
  ('client_trust',     'Client trust warning','Project openings of a warned client rank lower (negative)', 'opportunity', 2.50)
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region analytics.event_catalogue — registered vocabulary (from 20260724110000)
INSERT INTO analytics.event_catalogue (name, domain, description, subject_kinds, property_keys) VALUES
    -- Billing
    ('subscription.started', 'billing', 'A paid or free plan became active for a subject.',
        '{user,freelancer,team,business,enterprise}', '{plan_code,tier,audience,price_cents,currency,interval}'),
    ('subscription.changed', 'billing', 'A subject moved between plans (upgrade or downgrade).',
        '{user,freelancer,team,business,enterprise}', '{from_plan,to_plan,direction,reason}'),
    ('subscription.cancelled', 'billing', 'A subscription was cancelled or allowed to lapse.',
        '{user,freelancer,team,business,enterprise}', '{plan_code,at_period_end,reason}'),
    -- Entitlements & allowances (the tuning substrate for every cap magnitude)
    ('entitlement.checked', 'allowance', 'An entitlement limit was resolved for a subject.',
        '{user,freelancer,team,business,enterprise}', '{key,effective_limit,source}'),
    ('entitlement.denied', 'allowance', 'An action was blocked by an entitlement cap — the upgrade signal.',
        '{user,freelancer,team,business,enterprise}', '{key,effective_limit,attempted}'),
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
        '{user,freelancer,team,business,enterprise}',
        '{item_id,source,category,mime_type,size_bytes,owner_type,bucket_id}'),
    ('storage.dedup_hit', 'storage', 'A content hash matched an existing asset, so no new bytes were stored.',
        '{user,freelancer,team,business,enterprise}',
        '{content_hash,hash_sampled,existing_item_id,size_bytes_saved}'),
    ('storage.share_created', 'storage', 'A read-only share link was minted for an asset or folder.',
        '{user,freelancer,team,business,enterprise}',
        '{share_id,item_id,folder_id,visibility,expires_at,download_limit}'),
    ('storage.share_accessed', 'storage', 'A share slug was resolved — the anonymous half of the funnel.',
        '{user,freelancer,team,business,enterprise}',
        '{share_id,item_id,folder_id,anonymous,referrer_domain}'),
    ('storage.download', 'storage', 'An asset was downloaded. Mirrors a files.download_events row.',
        '{user,freelancer,team,business,enterprise}',
        '{item_id,via,share_slug,anonymous,repeat_download,size_bytes}'),
    ('link.scan_blocked', 'storage', 'The link-safety pipeline refused a URL asset.',
        '{user,freelancer,team,business,enterprise}',
        '{item_id,link_domain,scan_status,reason}'),
    -- Discovery — the ranking and placement substrate. Rows land in search.interest_events
    -- (impression/click/rail_depth/view) and search.query_logs (search), not analytics.events; these
    -- entries are the vocabulary those streams are rolled up under.
    ('discovery.search', 'discovery', 'A discovery query ran (first page only; paging is not a new search).',
        '{platform}', '{query,category,filters,result_count,duration_ms,matched_density}'),
    ('discovery.impression', 'discovery', 'A listing card was at least half visible for one second.',
        '{listing,project,user,freelancer,team,business}', '{surface,rail,position,query,session_id}'),
    ('discovery.click', 'discovery', 'A listing card''s own link was opened from a discovery surface.',
        '{listing,project,user,freelancer,team,business}', '{surface,rail,position,query,session_id}'),
    ('discovery.rail_depth', 'discovery', 'The furthest a reader scrolled one horizontal rail, as a 0-1 fraction.',
        '{platform}', '{surface,rail,depth,items,session_id}'),
    ('discovery.view', 'discovery', 'A service or product listing''s own page was shown: at most one per viewer per listing per 30 minutes, never the seller''s own.',
        '{listing}', '{surface,session_id}')
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region integrations.providers — connector catalogue
-- Reference data: every integrable vendor. ALL ship is_enabled=false — enabling one is an operator
-- decision that requires credentials in the Environment Variable Contract to exist first. `broker`
-- records the integration strategy (SYSTEM_ARCHITECTURE.md §Integration & Plugin Platform): calendar,
-- conferencing and most storage/dev go direct (Decision #383, ruling R1), the CRM long tail via merge.
INSERT INTO
    integrations.providers (
        slug, label, category, capabilities, auth_scheme,
        is_enabled, broker, supports_webhooks, default_scopes
    )
VALUES
    -- Calendars & conferencing (MVP focus). google, outlook and zoom follow with their auth_config.
    ('apple', 'Apple', 'calendar',
        ARRAY['calendar', 'freebusy']::integrations.provider_kind[], 'app_password',
        false, 'nylas', false, ARRAY[]::text[]),
    ('samsung', 'Samsung', 'calendar',
        ARRAY['calendar']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY[]::text[]),
    ('calendly', 'Calendly', 'calendar',
        ARRAY['calendar', 'freebusy']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['default']),
    ('microsoft_teams', 'Microsoft Teams', 'conferencing',
        ARRAY['conferencing']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY['OnlineMeetings.ReadWrite']),
    ('discord', 'Discord', 'communication',
        ARRAY['conferencing', 'messaging']::integrations.provider_kind[], 'oauth2',
        false, 'direct', false, ARRAY[]::text[]),
    -- Storage & docs (V2 focus; direct integrations — a unified file API is too leaky). google_drive
    -- follows with its auth_config.
    ('dropbox', 'Dropbox', 'storage',
        ARRAY['storage']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['files.content.read']),
    -- OneDrive & SharePoint — ONE Microsoft Graph connector: a person's OneDrive, or a SharePoint
    -- document library addressed by the connection's `config.driveId` (Decision #313). Direct;
    -- Graph change notifications for webhooks. `Files.Read.All` reaches libraries shared with the
    -- user; `offline_access` is what returns a refresh token.
    ('onedrive', 'OneDrive & SharePoint', 'storage',
        ARRAY['storage', 'docs']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true, ARRAY['Files.Read.All', 'offline_access']),
    -- Frame.io — review-and-approval storage for video/creative deliverables. Direct (no unified
    -- broker models its comment/version graph), webhooks for asset + comment events. The V4 API
    -- authorizes through Adobe IMS; these are its user-auth scopes (`offline_access` = refresh
    -- token, `additional_info.roles` = the product entitlement Frame.io checks). The legacy V2 API
    -- and its scopes end on 2026-12-01 (Decision #313).
    ('frameio', 'Frame.io', 'storage',
        ARRAY['storage']::integrations.provider_kind[], 'oauth2',
        false, 'direct', true,
        ARRAY['openid', 'email', 'profile', 'offline_access', 'additional_info.roles']),
    -- S3-compatible object storage (AWS S3, R2, Backblaze B2, MinIO …). The ONE provider that is
    -- not OAuth: there is no consent dance and no bearer token to refresh — the connection holds an
    -- access-key pair and every request is REQUEST-SIGNED, which is why `aws_sigv4` exists as its
    -- own auth_scheme rather than being folded into `api_key`. No webhooks (bucket notifications
    -- are configured on the customer's side and delivered to their own endpoint, not ours).
    ('s3', 'S3-compatible storage', 'storage',
        ARRAY['storage']::integrations.provider_kind[], 'aws_sigv4',
        false, 'direct', false, ARRAY[]::text[]),
    ('notion', 'Notion', 'productivity',
        ARRAY['docs']::integrations.provider_kind[], 'oauth2',
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

-- The direct calendar and conferencing providers (Decision #383, ruling R1), and Google Drive, the one
-- storage connector a person can reach. `auth_config` is what a
-- consent needs (ProviderAuthConfigSchema), and `kind_scopes` is which scopes each capability takes.
-- Microsoft's {tenant} is filled from MICROSOFT_INTEGRATION_TENANT. Each ships disabled like the rest.
-- Zoom's scopes are its granular names: confirm them against the registered app. microsoft_teams
-- above has no consent of its own: Teams rooms mint through the outlook connection.
INSERT INTO
    integrations.providers (
        slug, label, category, capabilities, auth_scheme,
        is_enabled, broker, supports_webhooks, default_scopes, auth_config
    )
VALUES
    ('google', 'Google', 'calendar',
        ARRAY['calendar', 'freebusy', 'conferencing']::integrations.provider_kind[], 'oauth2',
        true, 'direct', true,
        ARRAY[
            'openid', 'email',
            'https://www.googleapis.com/auth/calendar.events.owned.readonly',
            'https://www.googleapis.com/auth/calendar.app.created',
            'https://www.googleapis.com/auth/meetings.space.created',
            'https://www.googleapis.com/auth/meetings.space.readonly'
        ],
        '{
            "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "revoke_url": "https://oauth2.googleapis.com/revoke",
            "pkce": true,
            "authorize_params": {
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true"
            },
            "identity_url": "https://openidconnect.googleapis.com/v1/userinfo",
            "identity_id_field": "sub",
            "identity_label_fields": ["email"],
            "kind_scopes": {
                "freebusy": ["https://www.googleapis.com/auth/calendar.events.owned.readonly"],
                "calendar": ["https://www.googleapis.com/auth/calendar.app.created"],
                "conferencing": [
                    "https://www.googleapis.com/auth/meetings.space.created",
                    "https://www.googleapis.com/auth/meetings.space.readonly"
                ]
            }
        }'::jsonb),
    -- Drive has its own consent, without include_granted_scopes: a token for files should reach files.
    -- drive.readonly lists a person's folders, which drive.file cannot; it is a restricted scope.
    ('google_drive', 'Google Drive', 'storage',
        ARRAY['storage', 'docs']::integrations.provider_kind[], 'oauth2',
        true, 'direct', true,
        ARRAY['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'],
        '{
            "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "revoke_url": "https://oauth2.googleapis.com/revoke",
            "pkce": true,
            "authorize_params": {
                "access_type": "offline",
                "prompt": "consent"
            },
            "identity_url": "https://openidconnect.googleapis.com/v1/userinfo",
            "identity_id_field": "sub",
            "identity_label_fields": ["email"],
            "kind_scopes": {
                "storage": ["https://www.googleapis.com/auth/drive.readonly"],
                "docs": ["https://www.googleapis.com/auth/drive.readonly"]
            }
        }'::jsonb),
    ('outlook', 'Microsoft', 'calendar',
        ARRAY['calendar', 'freebusy', 'conferencing']::integrations.provider_kind[], 'oauth2',
        true, 'direct', true,
        ARRAY[
            'offline_access', 'User.Read', 'Calendars.ReadBasic', 'Calendars.ReadWrite',
            'OnlineMeetings.ReadWrite', 'OnlineMeetingArtifact.Read.All'
        ],
        '{
            "authorize_url": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            "token_url": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "pkce": true,
            "identity_url": "https://graph.microsoft.com/v1.0/me",
            "identity_id_field": "id",
            "identity_label_fields": ["mail", "userPrincipalName"],
            "kind_scopes": {
                "freebusy": ["Calendars.ReadBasic"],
                "calendar": ["Calendars.ReadWrite"],
                "conferencing": ["OnlineMeetings.ReadWrite", "OnlineMeetingArtifact.Read.All"]
            }
        }'::jsonb),
    -- Zoom takes scopes from the Marketplace app and answers "Invalid scope" to any in the URL. Only
    -- creating a meeting is required: the others degrade (a best-effort sync, the shared link, a held
    -- review, a paid room's waiting room in place of approved registrants), so an app missing one
    -- still connects.
    ('zoom', 'Zoom', 'conferencing',
        ARRAY['conferencing']::integrations.provider_kind[], 'oauth2',
        true, 'direct', true,
        ARRAY[
            'meeting:write:meeting', 'meeting:read:meeting', 'meeting:update:meeting',
            'meeting:delete:meeting', 'meeting:write:registrant', 'meeting:write:batch_registrants',
            'meeting:read:list_past_participants', 'user:read:user'
        ],
        '{
            "authorize_url": "https://zoom.us/oauth/authorize",
            "token_url": "https://zoom.us/oauth/token",
            "revoke_url": "https://zoom.us/oauth/revoke",
            "pkce": true,
            "send_scopes": false,
            "token_auth": "basic",
            "identity_url": "https://api.zoom.us/v2/users/me",
            "identity_id_field": "id",
            "identity_label_fields": ["email"],
            "kind_scopes": {
                "conferencing": ["meeting:write:meeting"]
            }
        }'::jsonb)
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
-- A FLOOR, not a feed. The daily feed (`finance-fx-daily` → finance.record_fx_rates, FBP DB17) appends
-- newer observations beside these, and the newest `as_of` wins; these rows exist so a from-scratch reset
-- can resolve every supported display currency immediately instead of silently rendering unconverted
-- origin amounts on a fresh database. The GBP-based rows also name the currencies a feed must quote
-- (finance.fn_fx_feed_currencies), so a display currency is added here first.
--
-- Direction is fixed and non-negotiable: `rate` converts BASE into QUOTE
-- (`amount_quote = amount_base * rate`). Only the GBP-based rows are ever read: FxService reads
-- `base = 'GBP'` and derives a QUOTE → GBP multiplier as 1 / rate (`resolveRate`), the quote door
-- (finance.quote_fx_conversion) pivots every pair through GBP, and the feed writes GBP-based rows only,
-- so no figure depends on which direction its caller asked in. No conversion reads the inverse rows
-- below; org.fn_supported_display_currency (00001010) only checks that a sign-up's currency hint has a
-- row both ways (the DISPLAY_CURRENCIES rule), which is why they stay.
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
    -- Inverse pairs (QUOTE → GBP): never read by a conversion. See the direction note above.
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

-- #region org.supported_locales — the offered formatting locales (Decision #207)
-- Settings → Language & region, in its order. SUPPORTED_LOCALES in @projective/types/org must list
-- exactly these (locales.contract.test.ts).
INSERT INTO org.supported_locales (tag) VALUES
    ('en-GB'),
    ('en-US'),
    ('en-CA'),
    ('en-AU'),
    ('en-IN'),
    ('fr-FR'),
    ('de-DE'),
    ('es-ES'),
    ('es-MX'),
    ('it-IT'),
    ('nl-NL'),
    ('pl-PL'),
    ('pt-PT'),
    ('pt-BR'),
    ('sv-SE'),
    ('tr-TR'),
    ('ar-AE'),
    ('he-IL'),
    ('ur-PK'),
    ('hi-IN'),
    ('zh-CN'),
    ('ja-JP'),
    ('ko-KR')
ON CONFLICT (tag) DO NOTHING;
-- #endregion

-- #region org.legal_document_versions — the accepted documents' versions (Decision #446, LG3)
-- Every version of the Terms, the Acceptable Use Policy and the Privacy Policy (sign-up), and of the IP
-- Transfer Deed and the Escrow Terms (a first paid claim, a first funding), newest first per document.
-- LEGAL_VERSIONS in @projective/types/legal must list exactly these (manifest.contract.test.ts), and it
-- must match the content modules (features/legal/core/manifest.test.ts).
INSERT INTO org.legal_document_versions (slug, version, effective_date, material) VALUES
    ('terms', '2.0', '2026-10-17', false),
    ('terms', '1.0', '2026-08-01', false),
    ('acceptable-use', '1.0', '2026-10-17', false),
    ('privacy', '1.1', '2026-11-18', false),
    ('privacy', '1.0', '2026-10-17', false),
    ('ip-transfer-deed', '1.0', '2026-10-17', false),
    ('escrow-terms', '2.0', '2026-10-17', false),
    ('escrow-terms', '1.0', '2026-08-01', false)
ON CONFLICT (slug, version) DO NOTHING;
-- #endregion
