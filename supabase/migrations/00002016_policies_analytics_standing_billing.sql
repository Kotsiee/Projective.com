-- =============================================================================
-- RLS POLICIES — analytics schema, org Standing ladder, finance billing/entitlements
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 20260724110000_analytics_event_substrate.sql ---

CREATE POLICY "Read event catalogue" ON analytics.event_catalogue FOR
SELECT TO authenticated USING (true);

CREATE POLICY "View own subject events" ON analytics.events FOR
SELECT TO authenticated USING (analytics.fn_subject_visible (subject_kind, subject_id));

CREATE POLICY "View own subject rollups" ON analytics.daily_rollups FOR
SELECT TO authenticated USING (analytics.fn_subject_visible (subject_kind, subject_id));


-- --- from 20260724111000_standing_reputation.sql ---

CREATE POLICY "Read standing ladder" ON org.standing_levels FOR
SELECT TO authenticated USING (true);

CREATE POLICY "Read standing" ON org.entity_standing FOR
SELECT TO authenticated USING (true);

CREATE POLICY "View own standing history" ON org.standing_events FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('user', 'freelancer') AND subject_id = auth.uid ())
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );

CREATE POLICY "Read create mastery" ON org.create_mastery FOR
SELECT TO authenticated USING (true);

CREATE POLICY "Read achievement catalogue" ON org.achievements FOR
SELECT TO authenticated USING (true);

CREATE POLICY "Read awarded achievements" ON org.entity_achievements FOR
SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM org.achievements a WHERE a.code = achievement_code AND a.is_public)
        OR security.is_admin ()
        OR (subject_type IN ('user', 'freelancer') AND subject_id = auth.uid ())
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );

CREATE POLICY "Read quality streaks" ON org.quality_streaks FOR
SELECT TO authenticated USING (true);


-- --- from 20260724112000_billing_plans_entitlements.sql ---

CREATE POLICY "Read public plans" ON finance.plans FOR
SELECT TO authenticated USING (is_public OR security.is_admin ());

CREATE POLICY "Read plan entitlements" ON finance.plan_entitlements FOR
SELECT TO authenticated USING (true);

CREATE POLICY "View own subscriptions" ON finance.subscriptions FOR
SELECT TO authenticated USING (
        subject_type IS NOT NULL AND finance.fn_owner_visible (subject_type, subject_id)
    );

CREATE POLICY "View own subscription events" ON finance.subscription_events FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));

CREATE POLICY "View own entitlement grants" ON finance.entitlement_grants FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));

CREATE POLICY "Read commission tiers" ON finance.standing_commission_tiers FOR
SELECT TO authenticated USING (true);

CREATE POLICY "View own negotiated rates" ON finance.negotiated_rates FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));


-- --- from 20260724113000_entitlements_allowances_enforcement.sql ---

CREATE POLICY "View own allowances" ON finance.allowance_periods FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));

CREATE POLICY "View own allowance ledger" ON finance.allowance_ledger FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));
