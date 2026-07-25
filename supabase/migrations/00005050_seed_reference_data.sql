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
        '{user,freelancer,team}', '{kind,previous_count}')
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region integrations.providers — provider catalogue (from 20260724101000)
INSERT INTO
    integrations.providers (
        slug,
        label,
        capabilities,
        is_enabled,
        default_scopes
    )
VALUES (
        'google',
        'Google',
        ARRAY['calendar', 'conferencing']::integrations.provider_kind[],
        false,
        ARRAY['https://www.googleapis.com/auth/calendar.events']
    ),
    (
        'outlook',
        'Outlook',
        ARRAY['calendar', 'conferencing']::integrations.provider_kind[],
        false,
        ARRAY['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite']
    ),
    (
        'apple',
        'Apple',
        ARRAY['calendar']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ),
    (
        'samsung',
        'Samsung',
        ARRAY['calendar']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ),
    (
        'notion',
        'Notion',
        ARRAY['calendar']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ),
    (
        'zoom',
        'Zoom',
        ARRAY['conferencing']::integrations.provider_kind[],
        false,
        ARRAY['meeting:write']
    ),
    (
        'microsoft_teams',
        'Microsoft Teams',
        ARRAY['conferencing']::integrations.provider_kind[],
        false,
        ARRAY['OnlineMeetings.ReadWrite']
    ),
    (
        'discord',
        'Discord',
        ARRAY['conferencing']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ) ON CONFLICT (slug) DO NOTHING;
-- #endregion
