-- =============================================================================================
-- RLS POLICIES — storage.objects (Supabase Storage RLS)
--
-- One SELECT/INSERT/UPDATE/DELETE contract per bucket, keyed on the first path segment as the RLS
-- anchor (storage.foldername(name))[1]. Buckets + their anchors are seeded in
-- 00005040_seed_storage_buckets.sql.
--
-- Enforcement tiers:
--   quarantine    - own upload only (INSERT + own SELECT); promotion is a definer/service move
--   project       - projects.has_project_access({project_id}) for read AND write
--   messages       - comms.dm_participants membership on {thread_id} for read AND write
--   personal      - owner = auth.uid()
--   workspace     - active membership of the {entity_id} anchor (team OR business OR organisation)
--   invoices      - owner read on {owner_id}; NO authenticated write (service-role generates)
--   verification  - NO authenticated policy at all → service-role ONLY (RLS-bypass)
--   public_assets - public read; per-owner write on {owner_id}
--   avatars       - public read; per-owner write on {entity_id}
--   catalogue     - public read; per-seller write on {seller_id}
--
-- NOTE: multiple permissive SELECT policies on one bucket are OR-combined, so the project/messages
-- scoping below is written as the SOLE read policy for those buckets — do not re-add a broad
-- "any authenticated" read for them.
-- =============================================================================================


-- #region quarantine — virus-scan landing zone (own upload only)

CREATE POLICY "Authenticated users can upload to quarantine" ON storage.objects FOR
INSERT
    TO authenticated
WITH
    CHECK (
        bucket_id = 'quarantine'
        AND auth.uid () = owner
    );

CREATE POLICY "Users can read their own quarantine files" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'quarantine'
        AND auth.uid () = owner
    );

-- #endregion


-- #region project — collaboration files, gated by projects.has_project_access() on {project_id}

CREATE POLICY "Project participants can read project files" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'project'
        AND projects.has_project_access (
            (storage.foldername (name)) [1]::uuid
        )
    );

CREATE POLICY "Project participants can upload project files" ON storage.objects FOR
INSERT
    TO authenticated
WITH
    CHECK (
        bucket_id = 'project'
        AND projects.has_project_access (
            (storage.foldername (name)) [1]::uuid
        )
    );

CREATE POLICY "Project participants can update project files" ON storage.objects FOR
UPDATE TO authenticated USING (
    bucket_id = 'project'
    AND projects.has_project_access (
        (storage.foldername (name)) [1]::uuid
    )
)
WITH
    CHECK (
        bucket_id = 'project'
        AND projects.has_project_access (
            (storage.foldername (name)) [1]::uuid
        )
    );

CREATE POLICY "Project uploaders can delete their project files" ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'project'
    AND auth.uid () = owner
    AND projects.has_project_access (
        (storage.foldername (name)) [1]::uuid
    )
);

-- #endregion


-- #region messages — global DM/inbox attachments, gated by comms.dm_participants on {thread_id}

CREATE POLICY "DM participants can read message attachments" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'messages'
        AND EXISTS (
            SELECT 1
            FROM comms.dm_participants dp
            WHERE
                dp.thread_id = (storage.foldername (name)) [1]::uuid
                AND dp.user_id = auth.uid ()
        )
    );

CREATE POLICY "DM participants can upload message attachments" ON storage.objects FOR
INSERT
    TO authenticated
WITH
    CHECK (
        bucket_id = 'messages'
        AND auth.uid () = owner
        AND EXISTS (
            SELECT 1
            FROM comms.dm_participants dp
            WHERE
                dp.thread_id = (storage.foldername (name)) [1]::uuid
                AND dp.user_id = auth.uid ()
        )
    );

CREATE POLICY "DM uploaders can delete their message attachments" ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'messages'
    AND auth.uid () = owner
);

-- #endregion


-- #region personal — owner-only private drive

CREATE POLICY "Users manage own personal files" ON storage.objects FOR ALL TO authenticated USING (
    bucket_id = 'personal'
    AND auth.uid () = owner
)
WITH
    CHECK (
        bucket_id = 'personal'
        AND auth.uid () = owner
    );

-- #endregion


-- #region workspace — entity-owned private drive, gated by ACTIVE MEMBERSHIP of the {entity_id} anchor
--
-- The entity counterpart of `personal`. Deliberately NOT `auth.uid() = owner`: an entity asset must
-- outlive the member who uploaded it, so the gate is membership of the anchor, not ownership of the
-- object. The three membership helpers are OR-ed because a single uuid anchor may name a team, a
-- business or an organisation — the caller passes exactly one and the other two return false.
--
-- ⚠️ These are written as the SOLE policies for this bucket. Multiple permissive SELECT policies on
-- storage.objects are OR-combined, so adding a broad "any authenticated" read here would not
-- loosen `workspace` alone — do not add one (same warning as the project/messages buckets above).

CREATE POLICY "Entity members can read workspace files" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'workspace'
        AND (
            org.is_active_team_member (
                (storage.foldername (name)) [1]::uuid
            )
            OR org.is_active_business_member (
                (storage.foldername (name)) [1]::uuid
            )
            OR org.is_organisation_member (
                (storage.foldername (name)) [1]::uuid
            )
        )
    );

CREATE POLICY "Entity members can upload workspace files" ON storage.objects FOR
INSERT
    TO authenticated
WITH
    CHECK (
        bucket_id = 'workspace'
        AND auth.uid () = owner
        AND (
            org.is_active_team_member (
                (storage.foldername (name)) [1]::uuid
            )
            OR org.is_active_business_member (
                (storage.foldername (name)) [1]::uuid
            )
            OR org.is_organisation_member (
                (storage.foldername (name)) [1]::uuid
            )
        )
    );

CREATE POLICY "Entity members can update workspace files" ON storage.objects FOR
UPDATE TO authenticated USING (
    bucket_id = 'workspace'
    AND (
        org.is_active_team_member (
            (storage.foldername (name)) [1]::uuid
        )
        OR org.is_active_business_member (
            (storage.foldername (name)) [1]::uuid
        )
        OR org.is_organisation_member (
            (storage.foldername (name)) [1]::uuid
        )
    )
)
WITH
    CHECK (
        bucket_id = 'workspace'
        AND (
            org.is_active_team_member (
                (storage.foldername (name)) [1]::uuid
            )
            OR org.is_active_business_member (
                (storage.foldername (name)) [1]::uuid
            )
            OR org.is_organisation_member (
                (storage.foldername (name)) [1]::uuid
            )
        )
    );

-- Delete is narrower than update, on purpose: any member may revise a shared asset, but only the
-- uploader may destroy one. Entity-wide deletion authority belongs behind a capability check in the
-- fat service, not in a blanket storage policy.
CREATE POLICY "Workspace uploaders can delete their workspace files" ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'workspace'
    AND auth.uid () = owner
    AND (
        org.is_active_team_member (
            (storage.foldername (name)) [1]::uuid
        )
        OR org.is_active_business_member (
            (storage.foldername (name)) [1]::uuid
        )
        OR org.is_organisation_member (
            (storage.foldername (name)) [1]::uuid
        )
    )
);

-- #endregion


-- #region invoices — owner read on {owner_id}; NO authenticated write (service-role generates them)

CREATE POLICY "Owners can read their invoices" ON storage.objects FOR
SELECT TO authenticated USING (
        bucket_id = 'invoices'
        AND (storage.foldername (name)) [1] = auth.uid ()::text
    );

-- #endregion


-- #region verification — KYC/KYB docs: service-role ONLY.
-- Deliberately NO policy here. RLS is on (00002001) so `authenticated` is default-denied; only the
-- service_role (which bypasses RLS in Edge Functions) can read/write. Client uploads land in
-- `quarantine` and are promoted into `verification` by a SECURITY DEFINER / service-role move, so a
-- user's JWT never touches this bucket directly. Do NOT add an `authenticated` policy.
-- #endregion


-- #region public_assets — public read; per-owner write on {owner_id}

CREATE POLICY "Public Assets are viewable by everyone" ON storage.objects FOR
SELECT TO public USING (bucket_id = 'public_assets');

CREATE POLICY "Owners can write their public assets" ON storage.objects FOR ALL TO authenticated USING (
    bucket_id = 'public_assets'
    AND auth.uid () = owner
)
WITH
    CHECK (
        bucket_id = 'public_assets'
        AND auth.uid () = owner
    );

-- #endregion


-- #region avatars — profile/team/business/org branding: public read; owner write

CREATE POLICY "Avatars are viewable by everyone" ON storage.objects FOR
SELECT TO public USING (bucket_id = 'avatars');

CREATE POLICY "Owners can write their branding assets" ON storage.objects FOR ALL TO authenticated USING (
    bucket_id = 'avatars'
    AND auth.uid () = owner
)
WITH
    CHECK (
        bucket_id = 'avatars'
        AND auth.uid () = owner
    );

-- #endregion


-- #region catalogue — marketplace storefront media: public read; seller write

CREATE POLICY "Catalogue media is viewable by everyone" ON storage.objects FOR
SELECT TO public USING (bucket_id = 'catalogue');

CREATE POLICY "Sellers can write their catalogue media" ON storage.objects FOR ALL TO authenticated USING (
    bucket_id = 'catalogue'
    AND auth.uid () = owner
)
WITH
    CHECK (
        bucket_id = 'catalogue'
        AND auth.uid () = owner
    );

-- #endregion
