CREATE POLICY "Public can view published blueprints" ON marketplace.service_blueprints FOR
SELECT TO public USING (
        is_published = true
        OR freelancer_profile_id = auth.uid ()
    );

CREATE POLICY "Freelancers manage own blueprints" ON marketplace.service_blueprints FOR ALL TO public USING (
    freelancer_profile_id = auth.uid ()
);