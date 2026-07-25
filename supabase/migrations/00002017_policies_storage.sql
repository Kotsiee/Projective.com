-- =============================================================================
-- RLS POLICIES — storage.objects (Supabase Storage RLS)
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0207_storage.sql ---

CREATE POLICY "Authenticated users can upload to quarantine" ON storage.objects FOR
INSERT
    TO authenticated
WITH
    CHECK (bucket_id = 'quarantine');

CREATE POLICY "Users can read their own quarantine files" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'quarantine'
        AND auth.uid () = owner
    );

CREATE POLICY "Authenticated users can view project files" ON storage.objects FOR
SELECT TO authenticated USING (bucket_id = 'project');

CREATE POLICY "Public Assets are viewable by everyone" ON storage.objects FOR
SELECT TO public USING (bucket_id = 'public_assets');

CREATE POLICY "Users manage own personal files" ON storage.objects FOR ALL TO authenticated USING (
    bucket_id = 'personal'
    AND auth.uid () = owner
)
WITH
    CHECK (
        bucket_id = 'personal'
        AND auth.uid () = owner
    );
