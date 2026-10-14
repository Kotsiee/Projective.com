-- Indexes: catalogue and marketplace domains (Category 4).
--
-- NOTE ON WHAT WAS MISSING: `catalogue.listings` and `marketplace.quote_requests` carried no index but
-- their primary keys, so "the caller's listings" (the client pipeline, Decision #217) and "the quote
-- requests on this blueprint" were sequential scans of the whole platform's rows.

-- #region catalogue.listings — the seller's own listings
-- catalogue.get_client_pipeline / fn_seller_order_lines narrow to the caller's listings before the
-- per-row capability check: personal ones by owner, team ones by owning team.
CREATE INDEX IF NOT EXISTS idx_listings_owner_user
    ON catalogue.listings (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_listings_owner_team
    ON catalogue.listings (owner_team_id)
    WHERE owner_team_id IS NOT NULL;
-- #endregion

-- #region marketplace.quote_requests — the pipeline's quote arm
CREATE INDEX IF NOT EXISTS idx_quote_requests_blueprint
    ON marketplace.quote_requests (blueprint_id, created_at DESC);
-- #endregion
