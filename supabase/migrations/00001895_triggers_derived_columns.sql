-- =============================================================================================
-- 00001895_triggers_derived_columns.sql — derived- and immutable-column guards (Category 1).
--
-- Attaches `security.fn_guard_derived_columns` (00001001) to every publication table whose OWNER can
-- update their own row through the API while the row also carries numbers the platform computes:
-- ratings recomputed from reviews, and the catalogue console's view and order counters. The owner's
-- policy is right to let them edit a title or a price; it was never meant to let them edit what
-- buyers said about them.
--
-- Scope: the three tables whose schemas became reachable through PostgREST with the live discovery
-- reads (`marketplace`, `catalogue`), and the two `org` profile owners a client can still write
-- directly (`org.teams`, `org.organisations`) — see the `org` region below for the audit that
-- cleared them.
-- =============================================================================================

DROP TRIGGER IF EXISTS trg_service_blueprints_derived ON marketplace.service_blueprints;
CREATE TRIGGER trg_service_blueprints_derived
    BEFORE INSERT OR UPDATE ON marketplace.service_blueprints
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_derived_columns('rating_average', 'rating_count');

DROP TRIGGER IF EXISTS trg_products_derived ON catalogue.products;
CREATE TRIGGER trg_products_derived
    BEFORE INSERT OR UPDATE ON catalogue.products
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_derived_columns('rating_average', 'rating_count');

-- A quote request is between a buyer and the seller of one blueprint. Either may move its status;
-- neither may re-address it or point it at another listing (`security.fn_guard_immutable_columns`).
DROP TRIGGER IF EXISTS trg_quote_requests_parties ON marketplace.quote_requests;
CREATE TRIGGER trg_quote_requests_parties
    BEFORE UPDATE ON marketplace.quote_requests
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_immutable_columns(
        'requester_user_id', 'host_user_id', 'blueprint_id'
    );

DROP TRIGGER IF EXISTS trg_listings_derived ON catalogue.listings;
CREATE TRIGGER trg_listings_derived
    BEFORE INSERT OR UPDATE ON catalogue.listings
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_derived_columns(
        'rating_average', 'rating_count', 'view_count', 'order_count'
    );

-- #region org — the profile owners a client can still write
-- `org.users_public`, `org.freelancer_profiles` and `org.business_profiles` carry no client write
-- policy at all, so nothing reaches them but a definer. Two owners remain writable over PostgREST:
-- `org.teams` ("Team owners can update their teams") and `org.organisations` ("Owners and admins can
-- update the organisation"). Their policies are right to let an owner rename a team or edit an
-- address; they were never meant to let one set a rating, buy a plan by PATCHing `subscription_tier`,
-- hand the organisation to themselves as an admin, mark it verified, take somebody else's `@handle`,
-- or point its picture at a file from another person's library.
--
-- Audit (2026-09-23) of every writer of the guarded columns — each is SECURITY DEFINER, so inside it
-- `current_user` is the function's owner and the guards let it through:
--   rating_average / rating_count      reviews.recalculate_entity_rating            (00001005)
--   *_project_count                    projects.update_entity_project_counts         (00001100)
--   current_workload_intensity         projects.fn_sync_workload_intensity           (00001140)
--   owner · treasury · tier · limit    org.create_team                               (00001020)
--   avatar · banner · logo             org.set_profile_avatar — checks the file's owner (00001040)
--   organisation owner · status ·
--   verification · handle              public.create_organisation (service role)     (00001010)
-- No INVOKER trigger writes any of them on a client's behalf, so the guards refuse only the client.
-- `service_count` / `product_count` have no writer yet; the guard holds them at what the platform set.

DROP TRIGGER IF EXISTS trg_teams_derived ON org.teams;
CREATE TRIGGER trg_teams_derived
    BEFORE INSERT OR UPDATE ON org.teams
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_derived_columns(
        'rating_average', 'rating_count', 'active_project_count', 'total_project_count',
        'service_count', 'product_count', 'current_workload_intensity'
    );

DROP TRIGGER IF EXISTS trg_teams_immutable ON org.teams;
CREATE TRIGGER trg_teams_immutable
    BEFORE UPDATE ON org.teams
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_immutable_columns(
        'owner_user_id', 'treasury_wallet_id', 'subscription_tier', 'member_limit', 'slug',
        'avatar_file_id', 'banner_file_id'
    );

DROP TRIGGER IF EXISTS trg_organisations_immutable ON org.organisations;
CREATE TRIGGER trg_organisations_immutable
    BEFORE UPDATE ON org.organisations
    FOR EACH ROW EXECUTE FUNCTION security.fn_guard_immutable_columns(
        'owner_user_id', 'status', 'verification_level', 'handle', 'logo_file_id'
    );
-- #endregion
