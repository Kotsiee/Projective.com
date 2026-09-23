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

-- Public reference data, read by SSR to convert a price for a signed-out visitor exactly as for a
-- signed-in one (Decision #69) — so `anon` too. It is the only `finance` table `anon` reaches.
CREATE POLICY "Read FX rates" ON finance.fx_rates FOR
SELECT TO anon, authenticated USING (true);


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

-- UPDATE only: a payment method is CREATED by the processor's setup handshake (service role), and
-- the identity columns are immutable (trg_payment_methods_immutable, 00001830). What is left for the
-- owner — the label, which method is the default for funding or payouts — is billing configuration,
-- so on a shared entity it needs `manage_billing`, not bare membership.
CREATE POLICY "Manage own payment methods" ON finance.payment_methods FOR
UPDATE TO authenticated
USING (finance.fn_owner_capability (owner_type, owner_id, 'manage_billing'::finance.vault_capability))
WITH CHECK (finance.fn_owner_capability (owner_type, owner_id, 'manage_billing'::finance.vault_capability));

CREATE POLICY "View own deposit rules" ON finance.deposit_rules FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

-- A recurring deposit moves money into the wallet on a schedule, so configuring one is a move of
-- funds: seeing the wallet (membership) is not enough.
CREATE POLICY "Manage own deposit rules" ON finance.deposit_rules FOR ALL TO authenticated
USING (finance.fn_can_move_wallet_funds (wallet_id))
WITH CHECK (finance.fn_can_move_wallet_funds (wallet_id));

CREATE POLICY "View own payout schedule" ON finance.payout_schedules FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

-- A payout schedule decides when money leaves the vault and where it goes: `withdraw`, not
-- membership. Before this any active member of a team could re-point the team's payouts.
CREATE POLICY "Manage own payout schedule" ON finance.payout_schedules FOR ALL TO authenticated
USING (finance.fn_owner_capability (owner_type, owner_id, 'withdraw'::finance.vault_capability))
WITH CHECK (finance.fn_owner_capability (owner_type, owner_id, 'withdraw'::finance.vault_capability));

-- READ only. Enrolment is an eligibility decision — earning history, the fee it costs — so it is
-- made server-side, never written directly: a client write let a user set `eligibility_met` and
-- `fee_bp` on their own row.
CREATE POLICY "View own income smoothing" ON finance.income_smoothing FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

CREATE POLICY "View own wallet pots" ON finance.wallet_pots FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

-- Allocating a wallet into pots is a move of funds; the pot's balance itself is guarded
-- (trg_wallet_pots_derived) so this admits the pot's name, purpose and weighting only.
CREATE POLICY "Manage own wallet pots" ON finance.wallet_pots FOR ALL TO authenticated
USING (finance.fn_can_move_wallet_funds (wallet_id))
WITH CHECK (finance.fn_can_move_wallet_funds (wallet_id));


-- --- from 20260723093000_finance_vault_governance.sql ---

CREATE POLICY "View vault permissions" ON finance.vault_permissions FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View team split rules" ON finance.split_rules FOR
SELECT TO authenticated USING (org.is_active_team_member (team_id) OR security.is_admin ());

CREATE POLICY "View wallet spend approvals" ON finance.spend_approvals FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

-- A request is born undecided. Without the state pins a member could insert a request already
-- `approved`, naming anyone as the approver — the approval an entity's spend rules exist to require.
-- Deciding is a separate, capability-checked act and holds no client UPDATE grant at all.
CREATE POLICY "Request a spend approval" ON finance.spend_approvals FOR
INSERT TO authenticated
WITH CHECK (
    requested_by = auth.uid ()
    AND finance.fn_can_view_wallet (wallet_id)
    AND status = 'pending'
    AND approver_user_id IS NULL
    AND decided_at IS NULL
);

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

-- Saved cards mirror finance.payment_methods EXACTLY rather than inventing a third posture for the
-- same concept — a saved card IS the display projection of a payment method, and two different
-- answers to "who may manage this entity's instruments" would be a bug waiting to happen. Any member
-- may SEE them; changing the default or removing one is billing configuration (`manage_billing` on a
-- shared entity). There is no INSERT: a card is saved by the processor's handshake, which alone can
-- say it exists (the display columns are immutable — trg_saved_cards_immutable, 00001830).

CREATE POLICY "View own saved cards" ON finance.saved_cards FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own saved cards" ON finance.saved_cards FOR
UPDATE TO authenticated
USING (finance.fn_owner_capability (owner_type, owner_id, 'manage_billing'::finance.vault_capability))
WITH CHECK (finance.fn_owner_capability (owner_type, owner_id, 'manage_billing'::finance.vault_capability));

CREATE POLICY "Remove own saved cards" ON finance.saved_cards FOR
DELETE TO authenticated
USING (finance.fn_owner_capability (owner_type, owner_id, 'manage_billing'::finance.vault_capability));


-- --- the ledger and commerce tables (the move off fixtures, 2026-09-23) ---
-- The schema is exposed to PostgREST (00002500), so every table a client role can reach carries a
-- policy. All of these are READ policies: money moves only through SECURITY DEFINER functions (the
-- escrow hold/release/refund primitives, the ledger primitives, the guarded doors that call them),
-- which run as their owner — so no client ever needs, or gets, a write on a balance, a ledger line, an
-- order, an invoice or a payout. The one exception is `buyer_details`, the buyer's own form.
--
-- A child table (order lines, invoice lines, dispute messages) reaches its rows through an EXISTS
-- over its parent. That subquery runs under the PARENT's policy, so a line is exactly as visible as
-- the row it belongs to, with no second copy of the rule to drift.

-- A wallet, its ledger and its payouts are seen by whoever may see their owner: the person, or the
-- active members of the team, business or organisation (fn_owner_visible — the rule every sibling
-- in this schema already reads).
CREATE POLICY "View visible wallets" ON finance.wallets FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "View visible wallet ledger" ON finance.transactions FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View visible payouts" ON finance.payouts FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

CREATE POLICY "View own payout accounts" ON finance.payout_accounts FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

-- An order is the buyer's: the person, or the members of the entity that bought.
CREATE POLICY "View own orders" ON finance.orders FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "View own order lines" ON finance.order_lines FOR
SELECT TO authenticated USING (EXISTS (SELECT 1 FROM finance.orders o WHERE o.id = order_id));

-- An invoice has two parties: the business it is issued TO, and the freelancer or team that issued
-- it. `issue_from_profile` holds either a user id or a team id with no type column, so both tests run
-- against it; an id of the other kind simply never matches.
CREATE POLICY "View invoices you are party to" ON finance.invoices FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR issue_from_profile = auth.uid ()
        OR org.is_active_team_member (issue_from_profile)
        OR (issue_to_business_id IS NOT NULL AND org.is_active_business_member (issue_to_business_id))
    );

CREATE POLICY "View invoice lines" ON finance.invoice_line_items FOR
SELECT TO authenticated USING (EXISTS (SELECT 1 FROM finance.invoices i WHERE i.id = invoice_id));

-- A buyer's details are SEEN by whoever may see the buyer and WRITTEN by whoever may buy for them —
-- the same read/write split a basket has, because these are the details a basket checks out under.
CREATE POLICY "View own buyer details" ON finance.buyer_details FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Save own buyer details" ON finance.buyer_details FOR
INSERT TO authenticated WITH CHECK (finance.fn_can_manage_basket (owner_type, owner_id));

CREATE POLICY "Update own buyer details" ON finance.buyer_details FOR
UPDATE TO authenticated
USING (finance.fn_can_manage_basket (owner_type, owner_id))
WITH CHECK (finance.fn_can_manage_basket (owner_type, owner_id));

-- A dispute is seen by the parties to the escrow it is about — the EXISTS runs under "View escrows",
-- so they are exactly the escrow's own readers — and by whoever opened it.
CREATE POLICY "View disputes you are party to" ON finance.disputes FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR opened_by_profile = auth.uid ()
        OR EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = escrow_id)
    );

CREATE POLICY "View dispute messages" ON finance.dispute_messages FOR
SELECT TO authenticated USING (EXISTS (SELECT 1 FROM finance.disputes d WHERE d.id = dispute_id));

-- A team's split is its members' business, and each member sees the whole of it: a share is only
-- intelligible as one of the set that sums to the total.
CREATE POLICY "View team contribution agreements" ON finance.contribution_agreements FOR
SELECT TO authenticated USING (security.is_admin () OR org.is_active_team_member (team_id));

-- A payout split line is seen by the member it paid and by the readers of the escrow it came from.
CREATE POLICY "View payout splits" ON finance.payout_splits FOR
SELECT TO authenticated USING (
        member_user_id = auth.uid ()
        OR EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = escrow_id)
    );

-- A spending cap is seen by anyone who may see the wallet it caps, which includes the member it binds.
CREATE POLICY "View wallet spending limits" ON finance.spending_limits FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));
