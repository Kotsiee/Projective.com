GRANT USAGE ON SCHEMA files TO service_role, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA files TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA files TO service_role;

GRANT
SELECT,
INSERT
,
UPDATE,
DELETE ON ALL TABLES IN SCHEMA files TO authenticated;

GRANT USAGE,
SELECT
    ON ALL SEQUENCES IN SCHEMA files TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT
SELECT,
INSERT
,
UPDATE,
DELETE ON TABLES TO authenticated;

ALTER TABLE files.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users handle own files" ON files.items;

CREATE POLICY "Authenticated users can view files" ON files.items FOR
SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert own files" ON files.items FOR
INSERT
    TO authenticated
WITH
    CHECK (owner_user_id = auth.uid ());

CREATE POLICY "Users can update own files" ON files.items FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ());

CREATE POLICY "Users can delete own files" ON files.items FOR DELETE TO authenticated USING (owner_user_id = auth.uid ());