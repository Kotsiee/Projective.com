-- The same delta as release-guard.drop.fixture.sql, carrying the approval line that lets it through.
-- A fixture for scripts/release-guard.test.ts, never applied anywhere: its approval names the
-- decision that defines the guard, not one that approved these statements.
-- additive-rule-approved: Decision #512 by Fixture Owner on 2026-11-19
BEGIN;

CREATE TABLE ops.release_notes (id uuid PRIMARY KEY, body text NOT NULL);
ALTER TABLE org.users ADD COLUMN pronouns text;

DROP TABLE catalogue.legacy_tags;
ALTER TABLE org.users DROP COLUMN headline;
ALTER TABLE projects.tickets DROP CONSTRAINT tickets_stage_id_fkey;
ALTER TABLE finance.escrows ALTER COLUMN amount_minor TYPE numeric(20, 0);

COMMIT;
