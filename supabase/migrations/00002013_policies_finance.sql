-- =============================================================================
-- RLS POLICIES — finance schema (wallets, escrow, payments, payouts, vaults)
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0205_security.sql ---

-- The payee (freelancer/team) and the payer business's active members can view an escrow.
CREATE POLICY "View escrows" ON finance.escrows FOR
SELECT TO authenticated USING (
        (payee_type = 'freelancer'::assignment_type AND payee_id = auth.uid ())
        OR (payee_type = 'team'::assignment_type AND org.is_active_team_member (payee_id))
        OR org.is_active_business_member (payer_business_id)
    );


-- --- from 20260723090000_finance_currency_fx.sql ---

CREATE POLICY "Read FX rates" ON finance.fx_rates FOR
SELECT TO authenticated USING (true);


-- --- from 20260723091000_finance_verification_kyc.sql ---

CREATE POLICY "View own verification cases" ON finance.verification_cases FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('freelancer', 'user') AND subject_id = auth.uid ())
        OR (subject_type = 'business' AND org.is_active_business_member (subject_id))
        OR (subject_type = 'organisation' AND org.is_organisation_member (subject_id))
    );


-- --- from 20260723092000_finance_payment_methods_money_movement.sql ---

CREATE POLICY "View own payment methods" ON finance.payment_methods FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own payment methods" ON finance.payment_methods FOR ALL TO authenticated
USING (finance.fn_owner_visible (owner_type, owner_id))
WITH CHECK (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "View own deposit rules" ON finance.deposit_rules FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "Manage own deposit rules" ON finance.deposit_rules FOR ALL TO authenticated
USING (finance.fn_can_view_wallet (wallet_id))
WITH CHECK (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View own payout schedule" ON finance.payout_schedules FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own payout schedule" ON finance.payout_schedules FOR ALL TO authenticated
USING (finance.fn_owner_visible (owner_type, owner_id))
WITH CHECK (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own income smoothing" ON finance.income_smoothing FOR ALL TO authenticated
USING (user_id = auth.uid () OR security.is_admin ())
WITH CHECK (user_id = auth.uid ());

CREATE POLICY "View own wallet pots" ON finance.wallet_pots FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "Manage own wallet pots" ON finance.wallet_pots FOR ALL TO authenticated
USING (finance.fn_can_view_wallet (wallet_id))
WITH CHECK (finance.fn_can_view_wallet (wallet_id));


-- --- from 20260723093000_finance_vault_governance.sql ---

CREATE POLICY "View vault permissions" ON finance.vault_permissions FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View team split rules" ON finance.split_rules FOR
SELECT TO authenticated USING (org.is_active_team_member (team_id) OR security.is_admin ());

CREATE POLICY "View wallet spend approvals" ON finance.spend_approvals FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "Request a spend approval" ON finance.spend_approvals FOR
INSERT TO authenticated
WITH CHECK (requested_by = auth.uid () AND finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View wallet ledger audit" ON finance.ledger_audit FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));


-- --- from 20260723094000_finance_statements_settlement.sql ---

CREATE POLICY "View own pending releases" ON finance.pending_releases FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View own statements" ON finance.statements FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "View wallet chargebacks" ON finance.chargebacks FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (wallet_id IS NOT NULL AND finance.fn_can_view_wallet (wallet_id))
    );


-- --- finance: basket, wishlist & saved cards ---

-- READ and WRITE are deliberately different predicates on a basket. Any member of an entity may SEE
-- what the entity is about to buy (fn_owner_visible — ordinary membership); only a member who could
-- actually pay for it may CHANGE it (fn_can_manage_basket — the `spend` vault capability). A basket
-- line is a proposed spend, so writing one is a spend-adjacent act, not a read.

CREATE POLICY "View own baskets" ON finance.baskets FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own baskets" ON finance.baskets FOR ALL TO authenticated
USING (finance.fn_can_manage_basket (owner_type, owner_id))
WITH CHECK (finance.fn_can_manage_basket (owner_type, owner_id));

-- Items inherit their basket's reach through an EXISTS over finance.baskets, which is itself
-- filtered by the two policies above — so an item is exactly as reachable as the basket holding it,
-- with no second copy of the ownership rule to drift.

CREATE POLICY "View own basket items" ON finance.basket_items FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM finance.baskets b
            WHERE b.id = basket_id
              AND finance.fn_owner_visible (b.owner_type, b.owner_id)
        )
    );

CREATE POLICY "Manage own basket items" ON finance.basket_items FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM finance.baskets b
        WHERE b.id = basket_id
          AND finance.fn_can_manage_basket (b.owner_type, b.owner_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM finance.baskets b
        WHERE b.id = basket_id
          AND finance.fn_can_manage_basket (b.owner_type, b.owner_id)
    )
);

-- Saved cards mirror finance.payment_methods EXACTLY (fn_owner_visible for both read and write)
-- rather than inventing a third posture for the same concept — a saved card IS the display
-- projection of a payment method, and two different answers to "who may manage this entity's
-- instruments" would be a bug waiting to happen. The looseness that implies for a shared owner
-- (any active member may manage the entity's cards) is inherited from that sibling, not introduced
-- here, and is flagged for reconciliation (root CLAUDE.md §8).

CREATE POLICY "View own saved cards" ON finance.saved_cards FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own saved cards" ON finance.saved_cards FOR ALL TO authenticated
USING (finance.fn_owner_visible (owner_type, owner_id))
WITH CHECK (finance.fn_owner_visible (owner_type, owner_id));
