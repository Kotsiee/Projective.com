-- =============================================================================================
-- 00005040_seed_storage_buckets.sql — storage.buckets seed (Category 5: Seeds).
--
-- Sensitivity × ownership tiering. Every bucket carries an explicit `file_size_limit` and
-- `allowed_mime_types` so no bucket silently inherits the global 50 MiB / any-MIME default.
-- The first path segment of every object is the RLS anchor (see 00002017_policies_storage.sql):
--   - quarantine/{user_id}/...            - project/{project_id}/...
--   - public_assets/{owner_id}/...        - avatars/{entity_id}/...
--   - catalogue/{seller_id}/...           - messages/{thread_id}/...
--   - invoices/{owner_id}/...             - verification/{subject_id}/...
--   - personal/{user_id}/...              - workspace/{entity_id}/...
--
-- Additive per root CLAUDE.md §1: buckets are inserted ON CONFLICT DO NOTHING and never dropped.
-- Byte sizes: 5 MiB = 5242880 · 10 MiB = 10485760 · 20 MiB = 20971520 · 50 MiB = 52428800.
-- =============================================================================================

-- #region Private system + collaboration buckets

-- Virus-scan / MIME-validation landing zone. Every user upload lands here first; a SECURITY DEFINER
-- promote moves clean files to their target bucket (files.items.target_bucket / target_path).
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'quarantine',
        'quarantine',
        false,
        52428800,
        NULL
    ) ON CONFLICT (id) DO NOTHING;

-- Project / channel / stage collaboration files. Read+write gated by projects.has_project_access().
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'project',
        'project',
        false,
        52428800,
        NULL
    ) ON CONFLICT (id) DO NOTHING;

-- Global DM / inbox attachments (NOT project-scoped). Read+write gated by comms.dm_participants
-- membership on the {thread_id} path anchor.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'messages',
        'messages',
        false,
        52428800,
        NULL
    ) ON CONFLICT (id) DO NOTHING;

-- Owner-only private drive: drafts, personal templates, work-in-progress.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'personal',
        'personal',
        false,
        52428800,
        NULL
    ) ON CONFLICT (id) DO NOTHING;

-- ENTITY-owned private drive: the team / business / organisation counterpart of `personal`. Anchored
-- on {entity_id} rather than {user_id}, because the whole point of an entity asset is that it
-- OUTLIVES the member who uploaded it — anchoring on the uploader would strand a departing member's
-- files behind a personal gate. Access is active membership of that entity, not object ownership.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'workspace',
        'workspace',
        false,
        52428800,
        NULL
    ) ON CONFLICT (id) DO NOTHING;

-- Wallet statements / invoices / receipts. Owner read; service-role write (generated server-side).
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'invoices',
        'invoices',
        false,
        20971520,
        ARRAY['application/pdf']
    ) ON CONFLICT (id) DO NOTHING;

-- KYC / KYB identity documents. HIGHEST sensitivity: service-role ONLY, no authenticated policy at
-- all (see 00002017). Client uploads route through quarantine and are promoted by a definer move.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'verification',
        'verification',
        false,
        20971520,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
    ) ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Public edge-cached buckets

-- Misc public assets (legacy general bucket). Public read; per-owner write on the {owner_id} anchor.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'public_assets',
        'public_assets',
        true,
        10485760,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
    ) ON CONFLICT (id) DO NOTHING;

-- Profile / team / business / org branding: avatars, banners, logos. Public read; owner write.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'avatars',
        'avatars',
        true,
        5242880,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    ) ON CONFLICT (id) DO NOTHING;

-- Marketplace storefront media: product images + service showcase. Public read; seller write.
INSERT INTO
    storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
        'catalogue',
        'catalogue',
        true,
        10485760,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    ) ON CONFLICT (id) DO NOTHING;

-- #endregion
