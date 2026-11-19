-- A schema delta for scripts/release-guard.test.ts that the Additive Rule refuses: it has no
-- approval line. Never applied anywhere. `deno task release:guard` exits 1 on it.
BEGIN;

CREATE TABLE ops.release_notes (id uuid PRIMARY KEY, body text NOT NULL);
ALTER TABLE org.users ADD COLUMN pronouns text;

DROP TABLE catalogue.legacy_tags;
ALTER TABLE org.users DROP COLUMN headline;
ALTER TABLE projects.tickets DROP CONSTRAINT tickets_stage_id_fkey;
ALTER TABLE finance.escrows ALTER COLUMN amount_minor TYPE numeric(20, 0);

COMMIT;
