-- =============================================================================
-- RLS POLICIES — reviews & marketplace schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0215_marketplace.sql ---

CREATE POLICY "Public can view published blueprints" ON marketplace.service_blueprints FOR
SELECT TO public USING (
        is_published = true
        OR freelancer_profile_id = auth.uid ()
    );

-- The seller writes their own blueprint, in their own name, and a team-owned blueprint only as an
-- active member of that team — the same shape as `catalogue.listings` (00002020), so a listing and
-- the blueprint behind it cannot answer "who may edit this" differently. Split from a single
-- `FOR ALL` for two reasons: a team could be named by anyone (the old arm checked only the
-- freelancer), and `FOR ALL` included DELETE, a hard delete that cascaded into
-- `catalogue.listings`. Nothing is hard-deleted (root CLAUDE.md §5): a blueprint is withdrawn by
-- `is_published`. Ratings are guarded separately (`security.fn_guard_derived_columns`).
CREATE POLICY "Freelancers create own blueprints" ON marketplace.service_blueprints FOR
INSERT
    TO authenticated
WITH
    CHECK (
        freelancer_profile_id = auth.uid ()
        AND (
            owner_team_id IS NULL
            OR org.is_active_team_member (owner_team_id)
        )
    );

CREATE POLICY "Freelancers update own blueprints" ON marketplace.service_blueprints FOR
UPDATE TO authenticated USING (freelancer_profile_id = auth.uid ())
WITH
    CHECK (
        freelancer_profile_id = auth.uid ()
        AND (
            owner_team_id IS NULL
            OR org.is_active_team_member (owner_team_id)
        )
    );


-- --- from 0216_reviews.sql ---

CREATE POLICY "Reviews are globally visible" ON reviews.entity_reviews FOR
SELECT TO public USING (true);

-- NO CLIENT WRITE POLICY, on purpose. A review moves a public rating (the definer trigger
-- `reviews.recalculate_entity_rating` recomputes the target's average on every write), so the only
-- honest write path is one that proves the reviewer had an ENGAGEMENT with what they are reviewing —
-- bought the product, worked the project, was the client — and is not its owner. No table on the
-- platform records a product purchase yet (`finance.orders` is the deferred live path) and no review
-- flow exists in the app, so that check cannot be written today.
--
-- The previous policies allowed any signed-in user to write any number of reviews of anything with
-- `project_id` left NULL (the UNIQUE treats NULLs as distinct). They were dormant while `reviews`
-- was not exposed to the API; exposing it for the discovery reads would have made them live. Reviews
-- are written by the service role and the seed until the engagement-checked review RPC lands, and
-- that RPC adds its own policy (or runs as a definer) with the check inside it.


-- --- marketplace.promoted_placements: the paid-placement ledger ---
--
-- An ACTIVE placement is public on purpose: it is what the "AD" disclosure on a card is answerable
-- from, and a disclosure only the sponsor can read is not a disclosure. A sponsor additionally sees
-- their own history (scheduled, ended, cancelled).
--
-- There is deliberately NO client write policy. A placement is PAID for, so it is created by the
-- billing path that took the payment (a definer or the service role), never by a PostgREST insert —
-- a client-writable ledger is a free advert for anyone who can compose the request.
CREATE POLICY "Active placements are public" ON marketplace.promoted_placements FOR
SELECT TO anon, authenticated USING (
        cancelled_at IS NULL
        AND starts_at <= now ()
        AND ends_at > now ()
    );

CREATE POLICY "Sponsors see their own placements" ON marketplace.promoted_placements FOR
SELECT TO authenticated USING (sponsor_user_id = auth.uid ());


-- --- marketplace.quote_requests: a buyer asking a seller to price bespoke scope ---
--
-- Readable by its two parties and nobody else — a quote request carries a budget and a brief, which
-- is exactly what a competing buyer or seller should not be able to page through.
--
-- No client writes (Decision #458). Each move belongs to one party — the buyer raises and withdraws,
-- the host prices and declines — and a policy cannot tell which party is moving which status, so a
-- shared UPDATE let a buyer mark their own request `answered`. Every write is a door in 00001177
-- (`request_quote` pins the host to the blueprint's seller); `trg_quote_requests_parties` still pins
-- the parties and the blueprint against the doors themselves.
CREATE POLICY "Parties see their quote requests" ON marketplace.quote_requests FOR
SELECT TO authenticated USING (
        requester_user_id = auth.uid ()
        OR host_user_id = auth.uid ()
    );

-- --- marketplace.quote_offers: the host's priced answers ---
-- Readable by the request's two parties. No client writes: `send_quote_offer`, `withdraw_quote_offer`,
-- `accept_quote_offer` and `decline_quote_offer` (00001177) are the only way in.
CREATE POLICY "Parties see their quote offers" ON marketplace.quote_offers FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM marketplace.quote_requests q
            WHERE
                q.id = quote_offers.quote_request_id
                AND (q.requester_user_id = auth.uid () OR q.host_user_id = auth.uid ())
        )
    );
