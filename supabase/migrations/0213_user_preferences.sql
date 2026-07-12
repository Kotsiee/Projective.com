ALTER TABLE org.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON org.user_preferences FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users can update own preferences" ON org.user_preferences FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

CREATE POLICY "Users can insert own preferences" ON org.user_preferences FOR
INSERT
    TO authenticated
WITH
    CHECK (user_id = auth.uid ());