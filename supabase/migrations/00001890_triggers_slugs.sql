-- =============================================================================================
-- 00001890_triggers_slugs.sql — route-slug fill + immutability triggers (Category 1).
--
-- One trigger per slugged table, all five in one file on purpose. They are the same declaration
-- five times over, differing only in the prefix passed to `security.fn_slug_guard`, and keeping
-- them adjacent is what makes a divergence visible: a sixth slugged table added without a trigger
-- would insert NULL into a NOT NULL column and fail loudly, but a trigger given the WRONG prefix
-- would mint `prj-` addresses for stages and nothing would notice until a link resolved against
-- the wrong table.
--
-- Depends on `security.mint_slug` / `security.fn_slug_guard` (00001001), which is why this is a
-- category-1 trigger file and not a column DEFAULT: a DEFAULT is laid down with the table in
-- category 0, before any function exists to call, and cannot contain a subquery anyway.
--
-- BEFORE INSERT: fills a slug the insert did not supply. This runs before NOT NULL is checked, so
-- the column needs neither a DEFAULT nor nullability.
-- BEFORE UPDATE: refuses any change to an existing slug. An ordinary title or status write never
-- mentions the column, so `NEW.slug` already equals `OLD.slug` and nothing fires.
-- =============================================================================================

DROP TRIGGER IF EXISTS trg_projects_slug ON projects.projects;
CREATE TRIGGER trg_projects_slug
    BEFORE INSERT OR UPDATE ON projects.projects
    FOR EACH ROW EXECUTE FUNCTION security.fn_slug_guard('prj');

DROP TRIGGER IF EXISTS trg_project_stages_slug ON projects.project_stages;
CREATE TRIGGER trg_project_stages_slug
    BEFORE INSERT OR UPDATE ON projects.project_stages
    FOR EACH ROW EXECUTE FUNCTION security.fn_slug_guard('stg');

DROP TRIGGER IF EXISTS trg_service_blueprints_slug ON marketplace.service_blueprints;
CREATE TRIGGER trg_service_blueprints_slug
    BEFORE INSERT OR UPDATE ON marketplace.service_blueprints
    FOR EACH ROW EXECUTE FUNCTION security.fn_slug_guard('svc');

DROP TRIGGER IF EXISTS trg_session_events_slug ON projects.session_events;
CREATE TRIGGER trg_session_events_slug
    BEFORE INSERT OR UPDATE ON projects.session_events
    FOR EACH ROW EXECUTE FUNCTION security.fn_slug_guard('ssn');

-- Tickets carry the `?tkv=` deep-link address. Every ticket insert on this platform goes through
-- either PostgREST (the board's commit) or a `SECURITY DEFINER` RPC, and neither supplies a slug —
-- this trigger is what mints it, so a ticket created by any path is addressable from the moment it
-- exists. (With a reset-driven schema there are no pre-existing rows to backfill: every ticket is
-- inserted through this trigger, seed data included.)
DROP TRIGGER IF EXISTS trg_tickets_slug ON projects.tickets;
CREATE TRIGGER trg_tickets_slug
    BEFORE INSERT OR UPDATE ON projects.tickets
    FOR EACH ROW EXECUTE FUNCTION security.fn_slug_guard('tkt');
