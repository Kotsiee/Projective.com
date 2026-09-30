-- ============================================================================
-- 00001830 triggers finance
-- Consolidated verbatim from: 0309_business_finance_overview.sql, 20260724112000_billing_plans_entitlements.sql
-- ============================================================================

-- A new team or business wallet is governed from birth: the entity's members are projected onto it
-- (org.fn_sync_vault_permissions), so the vault's authority is never hand-maintained.
CREATE TRIGGER trg_wallets_sync_vault_permissions
AFTER INSERT ON finance.wallets
FOR EACH ROW EXECUTE FUNCTION finance.fn_sync_vault_on_wallet();

-- A team's split totals exactly 100% (or nothing) at the end of every transaction that touches it.
CREATE CONSTRAINT TRIGGER trg_contribution_agreements_total
AFTER INSERT OR UPDATE ON finance.contribution_agreements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance.fn_assert_team_split_total();

CREATE TRIGGER trg_sync_legacy_subscription_columns
    BEFORE INSERT OR UPDATE ON finance.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_sync_legacy_subscription_columns ();

-- #region Client write guards (the schema is exposed to PostgREST — 00002500)
-- A few finance tables are writable by their owners for good reason — a pot is named and weighted
-- by its owner, a recurring deposit is configured by them, a payment method relabelled — and each of
-- those rows also carries something the owner must NOT be able to write. The policies in 00002013
-- decide WHO may touch a row; these decide WHICH COLUMNS a client may touch, which a policy cannot
-- express (see the guard functions in 00001001). Definer functions and the service role pass.

-- A pot's balance is money. A client that could set it would mint funds into their own vault.
CREATE TRIGGER trg_wallet_pots_derived
    BEFORE INSERT OR UPDATE ON finance.wallet_pots
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_derived_columns ('balance_cents');

-- …and a pot moved to another wallet would carry its balance with it.
CREATE TRIGGER trg_wallet_pots_immutable
    BEFORE UPDATE ON finance.wallet_pots
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_immutable_columns ('wallet_id', 'currency');

-- A recurring deposit's failure count and last error are the scheduler's record of what happened,
-- not the owner's to reset. `created_by` is who AUTHORISED the standing charge, stamped only by
-- finance.create_deposit_rule: a client row starts it empty (and so never runs), because a rule whose
-- author could be written freely could charge a card in somebody else's name.
CREATE TRIGGER trg_deposit_rules_derived
    BEFORE INSERT OR UPDATE ON finance.deposit_rules
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_derived_columns ('failure_count', 'last_error', 'created_by');

-- A payment method is created by the processor's setup handshake, which alone can say an instrument
-- exists and is usable. The owner may relabel it or change which one is the default; the rest is the
-- processor's word.
CREATE TRIGGER trg_payment_methods_immutable
    BEFORE UPDATE ON finance.payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_immutable_columns (
        'owner_type', 'owner_id', 'method_role', 'provider', 'external_ref', 'brand', 'last4', 'status'
    );

-- The same for a saved card: its display facts are the processor's, only `is_default` is the owner's.
CREATE TRIGGER trg_saved_cards_immutable
    BEFORE UPDATE ON finance.saved_cards
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_immutable_columns (
        'owner_type', 'owner_id', 'payment_method_id', 'stripe_payment_method_id', 'brand', 'last4',
        'exp_month', 'exp_year', 'cardholder_name', 'bin_number', 'is_business_card', 'created_by_user_id'
    );

-- Only checkout marks a basket line purchased, and only a definer may put a creator discount on a line
-- (the code, the saving, the struck-through price): a buyer who could write their own discount could
-- zero their own line. A line's PRICE is deliberately not guarded here: the basket service writes the
-- display snapshot as the signed-in user, so a guard would refuse the legitimate write too — instead
-- every read and the wallet checkout re-price each line from the catalogue and never charge a stored
-- figure.
CREATE TRIGGER trg_basket_items_derived
    BEFORE INSERT OR UPDATE ON finance.basket_items
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_derived_columns (
        'purchased_at', 'discount_amount_minor', 'discount_code', 'original_price_minor'
    );
-- #endregion
