-- =============================================================================================
-- 00002020_policies_catalogue.sql — RLS policies for the `catalogue` schema (Category 2).
--
-- The seller publication layer (00000023) shipped with tables and nothing else. It gets its security
-- layer with its first live reader — the discovery surfaces (`/explore`, `/view/[id]`, the landing
-- page), which read it as a signed-out visitor as often as a signed-in one.
--
-- THE MODEL, in one line: a PUBLISHED row is public, everything else is its owner's.
--
--   * READ   — `anon` and `authenticated` see what is published; the owner (and, for a team-owned
--              row, an active member of that team) additionally sees their own drafts, paused and
--              archived rows. A buyer never sees a seller's draft.
--   * WRITE  — the owner only, and the owner is always the CALLER (`owner_user_id = auth.uid()` in
--              every WITH CHECK), so a row can never be created in, or moved into, somebody else's
--              name. There is deliberately no DELETE on the three subject tables: nothing on this
--              platform is hard-deleted (root CLAUDE.md §5) — a listing is archived by its status.
--   * CHILD ROWS (media, skills, tags, availability) are visible exactly when their listing is, by
--              delegating to the listing's own policy through an EXISTS — RLS applies inside the
--              subquery, so the rule is stated once rather than restated per child.
--
-- Team membership reuses `org.is_active_team_member`, the helper every other team-scoped policy on
-- the platform already keys on, so "who is in this team" has one answer here too.
-- =============================================================================================


-- #region listings

CREATE POLICY "Published listings are public" ON catalogue.listings FOR
SELECT TO anon, authenticated USING (status = 'published'::catalogue.listing_status);

CREATE POLICY "Owners see their own listings" ON catalogue.listings FOR
SELECT TO authenticated USING (
        owner_user_id = auth.uid ()
        OR (
            owner_team_id IS NOT NULL
            AND org.is_active_team_member (owner_team_id)
        )
    );

-- A team-owned listing may only be created by a member of that team, in their own name.
CREATE POLICY "Sellers create their own listings" ON catalogue.listings FOR
INSERT
    TO authenticated
WITH
    CHECK (
        owner_user_id = auth.uid ()
        AND (
            owner_team_id IS NULL
            OR org.is_active_team_member (owner_team_id)
        )
    );

-- The WITH CHECK is what stops an owner handing a listing to somebody else in the same statement
-- that edits it (the `files.items` defect of Decision #67): the post-image must still be theirs.
CREATE POLICY "Sellers update their own listings" ON catalogue.listings FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ())
WITH
    CHECK (
        owner_user_id = auth.uid ()
        AND (
            owner_team_id IS NULL
            OR org.is_active_team_member (owner_team_id)
        )
    );

-- #endregion


-- #region products

-- A product is public when a PUBLISHED listing offers it. The product row carries no status of its
-- own — publication is the listing's job (00000023) — so visibility is delegated to the listing
-- rather than restated as a second status that could disagree with it.
CREATE POLICY "Listed products are public" ON catalogue.products FOR
SELECT TO anon, authenticated USING (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.product_id = products.id
                AND l.status = 'published'::catalogue.listing_status
        )
    );

CREATE POLICY "Owners see their own products" ON catalogue.products FOR
SELECT TO authenticated USING (
        owner_user_id = auth.uid ()
        OR (
            owner_team_id IS NOT NULL
            AND org.is_active_team_member (owner_team_id)
        )
    );

CREATE POLICY "Sellers create their own products" ON catalogue.products FOR
INSERT
    TO authenticated
WITH
    CHECK (
        owner_user_id = auth.uid ()
        AND (
            owner_team_id IS NULL
            OR org.is_active_team_member (owner_team_id)
        )
    );

CREATE POLICY "Sellers update their own products" ON catalogue.products FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ())
WITH
    CHECK (owner_user_id = auth.uid ());

-- #endregion


-- #region articles

CREATE POLICY "Published articles are public" ON catalogue.articles FOR
SELECT TO anon, authenticated USING (status = 'published'::catalogue.listing_status);

CREATE POLICY "Authors see their own articles" ON catalogue.articles FOR
SELECT TO authenticated USING (
        owner_user_id = auth.uid ()
        OR (
            owner_team_id IS NOT NULL
            AND org.is_active_team_member (owner_team_id)
        )
    );

CREATE POLICY "Authors create their own articles" ON catalogue.articles FOR
INSERT
    TO authenticated
WITH
    CHECK (owner_user_id = auth.uid ());

CREATE POLICY "Authors update their own articles" ON catalogue.articles FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ())
WITH
    CHECK (owner_user_id = auth.uid ());

-- #endregion


-- #region Listing children — media, skills, tags, availability

CREATE POLICY "Listing media follows its listing" ON catalogue.listing_media FOR
SELECT TO anon, authenticated USING (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_media.listing_id
        )
    );

CREATE POLICY "Owners manage their listing media" ON catalogue.listing_media FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM catalogue.listings l
        WHERE
            l.id = listing_media.listing_id
            AND l.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_media.listing_id
                AND l.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Listing skills follow their listing" ON catalogue.listing_skills FOR
SELECT TO anon, authenticated USING (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_skills.listing_id
        )
    );

CREATE POLICY "Owners manage their listing skills" ON catalogue.listing_skills FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM catalogue.listings l
        WHERE
            l.id = listing_skills.listing_id
            AND l.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_skills.listing_id
                AND l.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Listing tags follow their listing" ON catalogue.listing_tags FOR
SELECT TO anon, authenticated USING (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_tags.listing_id
        )
    );

CREATE POLICY "Owners manage their listing tags" ON catalogue.listing_tags FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM catalogue.listings l
        WHERE
            l.id = listing_tags.listing_id
            AND l.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_tags.listing_id
                AND l.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Listing availability follows its listing" ON catalogue.listing_availability FOR
SELECT TO anon, authenticated USING (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_availability.listing_id
        )
    );

CREATE POLICY "Owners manage their listing availability" ON catalogue.listing_availability FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM catalogue.listings l
        WHERE
            l.id = listing_availability.listing_id
            AND l.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM catalogue.listings l
            WHERE
                l.id = listing_availability.listing_id
                AND l.owner_user_id = auth.uid ()
        )
    );

-- #endregion


-- #region Collections
-- A seller's curated groupings. Private to their owner until a surface publishes them: there is no
-- status column to say a collection is public, and "readable by everyone" is not a default this
-- layer should pick on a surface's behalf.

CREATE POLICY "Owners manage their collections" ON catalogue.collections FOR ALL TO authenticated USING (owner_user_id = auth.uid ())
WITH
    CHECK (owner_user_id = auth.uid ());

CREATE POLICY "Owners manage their collection entries" ON catalogue.collection_listings FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM catalogue.collections c
        WHERE
            c.id = collection_listings.collection_id
            AND c.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM catalogue.collections c
            WHERE
                c.id = collection_listings.collection_id
                AND c.owner_user_id = auth.uid ()
        )
    );

-- #endregion
