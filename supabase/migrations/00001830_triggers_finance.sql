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
-- finance.create_deposit_rule, because a rule whose author could be written freely could charge a card
-- in somebody else's name. Clients hold SELECT only (00002013, 00002520); this guard is the backstop.
CREATE TRIGGER trg_deposit_rules_derived
    BEFORE INSERT OR UPDATE ON finance.deposit_rules
    FOR EACH ROW
    EXECUTE FUNCTION security.fn_guard_derived_columns ('failure_count', 'last_error', 'created_by');

-- …and unlike the client guards above, a rule's identity binds the doors too: the wallet, currency,
-- card and interval its author consented to never change, and an archived rule stays archived
-- (finance.fn_deposit_rules_immutable; FINANCE_BUILD_PROMPTS DB1).
CREATE TRIGGER trg_deposit_rules_immutable
    BEFORE UPDATE ON finance.deposit_rules
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_deposit_rules_immutable ();

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

-- #region Verification stamp (Decision #155)
-- A person's identity and payout caches move their verification stamp in the same statement, so the
-- crest a profile shows can never lag the evidence behind it.
CREATE TRIGGER trg_freelancer_profiles_verification_stamp
    AFTER INSERT OR UPDATE OF kyc_status, payout_ready ON org.freelancer_profiles
    FOR EACH ROW
    EXECUTE FUNCTION org.trg_freelancer_profiles_verification_stamp ();
-- #endregion

-- #region Append-only ledger (00001200, Decision #186)
-- A ledger row is never rewritten or removed, by any role: corrections are compensating rows.
CREATE TRIGGER trg_transactions_append_only
    BEFORE UPDATE OR DELETE ON finance.transactions
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_transactions_append_only ();

-- TRUNCATE skips row triggers, so it is refused per statement.
CREATE TRIGGER trg_transactions_no_truncate
    BEFORE TRUNCATE ON finance.transactions
    FOR EACH STATEMENT
    EXECUTE FUNCTION finance.fn_transactions_append_only ();

-- A pot's earmark history (finance.pot_movements, Decision #337, ruling M6) is its ledger: the same rule.
CREATE TRIGGER trg_pot_movements_append_only
    BEFORE UPDATE OR DELETE ON finance.pot_movements
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_pot_movements_append_only ();

CREATE TRIGGER trg_pot_movements_no_truncate
    BEFORE TRUNCATE ON finance.pot_movements
    FOR EACH STATEMENT
    EXECUTE FUNCTION finance.fn_pot_movements_append_only ();

-- The AML monitoring signals (00001240, Decision #529) are a record of what the money doors saw: the
-- same rule.
CREATE TRIGGER trg_aml_signals_append_only
    BEFORE UPDATE OR DELETE ON finance.aml_signals
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_aml_signals_append_only ();

CREATE TRIGGER trg_aml_signals_no_truncate
    BEFORE TRUNCATE ON finance.aml_signals
    FOR EACH STATEMENT
    EXECUTE FUNCTION finance.fn_aml_signals_append_only ();

-- The round-trip signal (00001240, Decision #529): an escrow held for a named payee, or released, with
-- one person on both sides. On the table, so no door that holds or releases money can skip it; WHEN keeps
-- every other escrow write from calling it.
CREATE TRIGGER trg_escrows_aml_round_trip_insert
    AFTER INSERT ON finance.escrows
    FOR EACH ROW
    WHEN (NEW.payee_id IS NOT NULL AND NEW.status IN ('held', 'released'))
    EXECUTE FUNCTION finance.fn_aml_record_round_trip ();

CREATE TRIGGER trg_escrows_aml_round_trip_update
    AFTER UPDATE OF status, payee_id ON finance.escrows
    FOR EACH ROW
    WHEN (NEW.payee_id IS NOT NULL AND (
        (NEW.status = 'released' AND OLD.status IS DISTINCT FROM 'released')
        OR (NEW.status = 'held' AND (OLD.status IS DISTINCT FROM 'held' OR OLD.payee_id IS NULL))
    ))
    EXECUTE FUNCTION finance.fn_aml_record_round_trip ();

-- An executed FX conversion is ledger too (00001240, Decision #435); a quote is frozen once written,
-- except that its use is recorded once.
CREATE TRIGGER trg_fx_conversions_append_only
    BEFORE UPDATE OR DELETE ON finance.fx_conversions
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_fx_conversions_append_only ();

CREATE TRIGGER trg_fx_conversions_no_truncate
    BEFORE TRUNCATE ON finance.fx_conversions
    FOR EACH STATEMENT
    EXECUTE FUNCTION finance.fn_fx_conversions_append_only ();

CREATE TRIGGER trg_fx_quotes_guard
    BEFORE UPDATE OR DELETE ON finance.fx_quotes
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_fx_quotes_guard ();

CREATE TRIGGER trg_fx_quotes_no_truncate
    BEFORE TRUNCATE ON finance.fx_quotes
    FOR EACH STATEMENT
    EXECUTE FUNCTION finance.fn_fx_quotes_guard ();
-- #endregion

-- #region Disputes — never deleted, terminal once resolved, evidence append-only (00001260, Decision #212)
CREATE TRIGGER trg_disputes_immutable
    BEFORE UPDATE OR DELETE ON finance.disputes
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_dispute_records_immutable ();

CREATE TRIGGER trg_dispute_messages_immutable
    BEFORE UPDATE OR DELETE ON finance.dispute_messages
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_dispute_records_immutable ();

CREATE TRIGGER trg_dispute_evidence_immutable
    BEFORE UPDATE OR DELETE ON finance.dispute_evidence
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_dispute_records_immutable ();

-- An offer is stamped accepted once and otherwise never changes (PROJECTS EX2).
CREATE TRIGGER trg_dispute_offers_immutable
    BEFORE UPDATE OR DELETE ON finance.dispute_offers
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_dispute_records_immutable ();

-- TRUNCATE skips row triggers, so it is refused per statement.
CREATE TRIGGER trg_disputes_no_truncate
    BEFORE TRUNCATE ON finance.disputes
    FOR EACH STATEMENT
    EXECUTE FUNCTION finance.fn_dispute_records_immutable ();
-- #endregion

-- #region Wallet watch — auto-fund retries and the low-balance warning (00001250, Decision #172)
-- Every ledger line on a business wallet: a credit retries the From-wallet auto-fund queue, a debit
-- that crosses the business's balance floor warns once and runs any floor top-up.
CREATE TRIGGER trg_transactions_wallet_watch
    AFTER INSERT ON finance.transactions
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_wallet_watch ();
-- #endregion

-- #region An engagement's money (00001150, Decisions #456, #467)
-- An ended (cancelled or archived) engagement of any kind takes no new escrow.
CREATE TRIGGER trg_escrows_ended_project_guard
    BEFORE INSERT ON finance.escrows
    FOR EACH ROW
    WHEN (NEW.status IN ('held', 'reserved') AND NEW.project_stage_id IS NOT NULL)
    EXECUTE FUNCTION projects.fn_guard_escrow_on_ended_project ();

-- A bought Pipeline service's first held escrow moves it draft → active.
CREATE TRIGGER trg_escrows_activate_funded_service
    AFTER INSERT OR UPDATE OF status ON finance.escrows
    FOR EACH ROW
    WHEN (NEW.status = 'held' AND NEW.project_stage_id IS NOT NULL)
    EXECUTE FUNCTION projects.fn_activate_funded_service ();
-- #endregion

-- #region Priced only in a settlement currency (Decision #337, ruling M5 (a); #423 (B); FBP DB9)
-- Every priced row, whoever writes it (a door, a direct write, the seed), is in a currency Projective
-- settles in: org.trg_settlement_currency (00001020) refuses any other with 22023 `currency`.
CREATE TRIGGER trg_projects_settlement_currency
    BEFORE INSERT OR UPDATE OF currency ON projects.projects
    FOR EACH ROW EXECUTE FUNCTION org.trg_settlement_currency ();

CREATE TRIGGER trg_listings_settlement_currency
    BEFORE INSERT OR UPDATE OF currency ON catalogue.listings
    FOR EACH ROW EXECUTE FUNCTION org.trg_settlement_currency ();

CREATE TRIGGER trg_products_settlement_currency
    BEFORE INSERT OR UPDATE OF currency ON catalogue.products
    FOR EACH ROW EXECUTE FUNCTION org.trg_settlement_currency ();

CREATE TRIGGER trg_service_blueprints_settlement_currency
    BEFORE INSERT OR UPDATE OF currency ON marketplace.service_blueprints
    FOR EACH ROW EXECUTE FUNCTION org.trg_settlement_currency ();
-- #endregion
