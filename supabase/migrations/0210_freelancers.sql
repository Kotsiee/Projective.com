ALTER TABLE org.freelancer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own freelancer profile" ON org.freelancer_profiles;

CREATE POLICY "Users can view their own freelancer profile" ON org.freelancer_profiles FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Users can create their own freelancer profile" ON org.freelancer_profiles;

CREATE POLICY "Users can create their own freelancer profile" ON org.freelancer_profiles FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Users can update their own freelancer profile" ON org.freelancer_profiles;

CREATE POLICY "Users can update their own freelancer profile" ON org.freelancer_profiles FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);