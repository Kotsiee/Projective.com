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
-- A listing by what it sells: the view trigger (search.trg_interest_events_view) finds a viewed
-- listing's seller this way, and the listing rollup maps interest events and order lines to it.
CREATE INDEX IF NOT EXISTS idx_listings_blueprint
    ON catalogue.listings (service_blueprint_id)
    WHERE service_blueprint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_product
    ON catalogue.listings (product_id)
    WHERE product_id IS NOT NULL;
-- #endregion

-- #region marketplace.quote_requests — the pipeline's quote arm
CREATE INDEX IF NOT EXISTS idx_quote_requests_blueprint
    ON marketplace.quote_requests (blueprint_id, created_at DESC);
-- The pair read (`get_quotes_with`), from the buyer's side; the host's side starts from the blueprint.
CREATE INDEX IF NOT EXISTS idx_quote_requests_requester
    ON marketplace.quote_requests (requester_user_id, created_at DESC);
-- One open request per buyer per listing (Decision #458): `request_quote` refuses a second, and this
-- holds against two concurrent first asks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_requests_open
    ON marketplace.quote_requests (requester_user_id, blueprint_id)
    WHERE status IN ('sent', 'answered');
-- #endregion

-- #region marketplace.quote_offers — one live offer per request
CREATE INDEX IF NOT EXISTS idx_quote_offers_request
    ON marketplace.quote_offers (quote_request_id, created_at DESC);
-- A revision withdraws the pending offer before it inserts its successor, so a request holds at most
-- one pending and at most one accepted offer whatever order two doors commit in.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_offers_one_pending
    ON marketplace.quote_offers (quote_request_id)
    WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_offers_one_accepted
    ON marketplace.quote_offers (quote_request_id)
    WHERE status = 'accepted';
-- #endregion

-- #region marketplace.promoted_placements — a listing's paid history (catalogue.fn_listing_engagements)
CREATE INDEX IF NOT EXISTS idx_promoted_placements_entity
    ON marketplace.promoted_placements (entity_type, entity_id);
-- #endregion

-- #region catalogue.entitlements — a holder's purchases, newest first (Decision #488)
-- The purchases view and the download gate both start from the holder; the version FK is what a
-- seller's re-publish and the holder's version read join on.
CREATE INDEX IF NOT EXISTS ix_entitlements_holder
    ON catalogue.entitlements (holder_type, holder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_entitlements_version
    ON catalogue.entitlements (version_id)
    WHERE version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_entitlements_product
    ON catalogue.entitlements (product_id)
    WHERE product_id IS NOT NULL;
-- #endregion
