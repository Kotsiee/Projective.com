-- =============================================================================================
-- 20260723090000_finance_currency_fx.sql
-- Wallet & Finance foundation (1/5) — Multi-currency, FX snapshotting & i18n preferences.
--
-- ADDITIVE ONLY (root CLAUDE.md §1, database/CLAUDE.md The Additive Rule). No table, column, or
-- foreign-key relationship is dropped or altered. Touches the protected Escrow/Wallet tables ONLY by
-- ADDING nullable columns (FX snapshot fields) — never by changing an existing FK or column.
-- Authored, NOT applied to any live database (a human step, per Decision #47).
--
-- The currency model this encodes (documented in finance-model.md §Multi-Currency & FX and
-- PRODUCT_SPEC.md §Escrow, Wallets & Finance):
--
--   * STORE-IN-ORIGIN. Every monetary amount is stored in the currency it was entered in — an
--     `(amount_minor BIGINT, currency)` pair. A creator prices in their local currency and is paid
--     that exact amount in that currency. The origin-currency columns ALREADY EXIST across the
--     schema (finance.wallets/transactions/escrows/invoices carry `currency`; projects.projects,
--     projects.tickets/stages via the project, and marketplace.service_blueprints carry `currency`)
--     — so NO priced entity lacks a currency column and none is added here (documented, not forced).
--   * GBP is the platform's internal base/accounting currency for system accounts, fees, and
--     cross-currency bridging (`security.platform_params.base_currency`).
--   * SNAPSHOT-AT-COMMIT. When money is committed (escrow lock / release / checkout), the FX rate(s)
--     used are captured onto the transaction/escrow row (`fx_rate`, `fx_base`, `fx_as_of`) so
--     settlement is deterministic and reproducible and never drifts with the market.
--   * DISPLAY CONVERSION is presentational only — a read-time conversion using the latest
--     `finance.fx_rates` row, driven by the viewer's `org.user_preferences.preferred_display_currency`.
--     It NEVER mutates stored amounts or affects settlement.
--
-- ⚠️ FLAGGED OPEN (surface, do not silently resolve): who bears the FX spread / how the conversion
-- fee is charged (payer-side spread vs platform margin vs mid-market pass-through) is a business-
-- economics decision left OPEN — see root CLAUDE.md §8 and finance-model.md §Multi-Currency & FX.
-- =============================================================================================

-- #region 1. Base / accounting currency parameter
INSERT INTO security.platform_params (key, value, description) VALUES
    ('base_currency', '"GBP"'::jsonb,
        'The platform''s internal base/accounting currency (ISO-4217) for system accounts, fees, and cross-currency FX bridging. Stored amounts stay in their origin currency; this is only the accounting/settlement base.')
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region 2. finance.fx_rates — historical FX rate table (append-only reference data)
-- One row per (base, quote, as_of) observation. `rate` is the multiplier: amount_in_quote =
-- amount_in_base * rate. Rows are never mutated — a new observation is a new row, so a snapshotted
-- (fx_base, fx_as_of) on a transaction/escrow reproduces the exact rate used at commit time.
CREATE TABLE IF NOT EXISTS finance.fx_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    base char(3) NOT NULL,           -- ISO-4217, e.g. 'GBP'
    quote char(3) NOT NULL,          -- ISO-4217, e.g. 'USD'
    rate numeric(20, 10) NOT NULL CHECK (rate > 0),
    as_of timestamptz NOT NULL,      -- the observation instant this rate is valid as-of
    provider text NOT NULL DEFAULT 'manual',  -- rate source (Stripe FX / ECB / provider slug); XXXX-XXXX in docs
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_fx_rate_observation UNIQUE (base, quote, as_of)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_asof ON finance.fx_rates (base, quote, as_of DESC);

-- Reference data: readable by any authenticated caller (like security.platform_params); writes are
-- service-role / SECURITY DEFINER only (an ingestion job owns rate publication).
ALTER TABLE finance.fx_rates ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE finance.fx_rates TO authenticated;
GRANT ALL ON TABLE finance.fx_rates TO service_role;

DROP POLICY IF EXISTS "Read FX rates" ON finance.fx_rates;
CREATE POLICY "Read FX rates" ON finance.fx_rates FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 3. FX snapshot columns on the committed-money rows (additive, nullable)
-- Captured at the instant money is committed so settlement is reproducible. NULL when the movement
-- is same-currency (no conversion applied) — existing rows are unaffected.
ALTER TABLE finance.transactions
    ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 10),   -- rate applied to reach the base currency, if converted
    ADD COLUMN IF NOT EXISTS fx_base char(3),           -- the base currency the rate is expressed against (usually GBP)
    ADD COLUMN IF NOT EXISTS fx_as_of timestamptz;      -- the finance.fx_rates.as_of the rate was snapshotted from

ALTER TABLE finance.escrows
    ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 10),
    ADD COLUMN IF NOT EXISTS fx_base char(3),
    ADD COLUMN IF NOT EXISTS fx_as_of timestamptz;
-- #endregion

-- #region 4. i18n preferences: display currency + layout direction (additive to org.user_preferences)
-- `layout_direction` is chosen by the user INDEPENDENT of language ('auto' resolves to the locale's
-- natural direction). See DESIGN_SYSTEM.md §A.6 (RtL/LtR contract).
DO $$ BEGIN
    CREATE TYPE org.layout_direction AS ENUM ('ltr', 'rtl', 'auto');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE org.user_preferences
    -- Presentational display-conversion target (ISO-4217). NULL = follow the origin/locale default;
    -- stored/settled amounts are unaffected regardless of this value.
    ADD COLUMN IF NOT EXISTS preferred_display_currency char(3),
    -- Document layout direction. 'auto' falls back to the natural direction of `locale`.
    ADD COLUMN IF NOT EXISTS layout_direction org.layout_direction NOT NULL DEFAULT 'auto';

-- NOTE (reconciliation, flagged in root CLAUDE.md §8): `org.user_preferences.locale` (default
-- 'en-GB') already carries the BCP-47 locale (language + region). No separate `preferred_locale` /
-- `language` column is added here to avoid duplicating that — `locale` IS the language source, and
-- `layout_direction` is deliberately independent of it. Add a region-independent language tag only
-- if a real need arises (reconcile with a human first).
--
-- The org.seed_user_preferences() trigger (migration 20260722120000) inserts only the PK and relies
-- on column DEFAULTs, so it seeds `layout_direction='auto'` and `preferred_display_currency=NULL`
-- automatically for every new profile — no trigger change required. Existing preferences RLS
-- (migration 0213: view/update/insert own) already covers these new columns (RLS is table-level).
-- #endregion
