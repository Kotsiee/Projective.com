ALTER TABLE org.users_public ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Any authenticated user can view public profiles" ON org.users_public;

CREATE POLICY "Any authenticated user can view public profiles" ON org.users_public FOR
SELECT TO public USING (
        auth.role () = 'authenticated'
    );

DROP POLICY IF EXISTS "Users can create their own profile" ON org.users_public;

CREATE POLICY "Users can create their own profile" ON org.users_public FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Users can update their own profile" ON org.users_public;

CREATE POLICY "Users can update their own profile" ON org.users_public FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);

ALTER TABLE org.user_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own emails" ON org.user_emails;

CREATE POLICY "Users can view their own emails" ON org.user_emails FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Users can add their own emails" ON org.user_emails;

CREATE POLICY "Users can add their own emails" ON org.user_emails FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Users can update their own emails" ON org.user_emails;

CREATE POLICY "Users can update their own emails" ON org.user_emails FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);

DROP POLICY IF EXISTS "Users can delete their own emails" ON org.user_emails;

CREATE POLICY "Users can delete their own emails" ON org.user_emails FOR DELETE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);