ALTER TABLE org.business_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view business roster" ON org.business_members FOR
SELECT TO authenticated USING (
        org.is_active_business_member (business_id)
        OR security.is_admin ()
    );

CREATE POLICY "Owners can manage members" ON org.business_members FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM org.business_profiles
        WHERE
            id = business_id
            AND owner_user_id = auth.uid ()
    )
    OR security.is_admin ()
);

ALTER TABLE org.business_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view business roles" ON org.business_roles FOR
SELECT TO authenticated USING (
        org.is_active_business_member (business_id)
    );

CREATE POLICY "Owners can manage business roles" ON org.business_roles FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM org.business_profiles
        WHERE
            id = business_id
            AND owner_user_id = auth.uid ()
    )
);