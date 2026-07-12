ALTER TABLE org.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view members of their teams" ON org.team_members;

CREATE POLICY "Users can view members of their teams" ON org.team_members FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR org.is_active_team_member (team_id)
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Team owners can add members" ON org.team_members;

CREATE POLICY "Team owners can add members" ON org.team_members FOR
INSERT
    TO public
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM org.teams t
            WHERE
                t.id = team_id
                AND t.owner_user_id = auth.uid ()
        )
        OR security.is_admin ()
    );

DROP POLICY IF EXISTS "Team owners can update members" ON org.team_members;

CREATE POLICY "Team owners can update members" ON org.team_members FOR
UPDATE TO public USING (
    EXISTS (
        SELECT 1
        FROM org.teams t
        WHERE
            t.id = team_id
            AND t.owner_user_id = auth.uid ()
    )
    OR security.is_admin ()
);

DROP POLICY IF EXISTS "Team owners can remove members or members can leave" ON org.team_members;

CREATE POLICY "Team owners can remove members or members can leave" ON org.team_members FOR DELETE TO public USING (
    user_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM org.teams t
        WHERE
            t.id = team_id
            AND t.owner_user_id = auth.uid ()
    )
    OR security.is_admin ()
);