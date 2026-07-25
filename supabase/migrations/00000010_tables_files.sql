-- =============================================================================================
-- 00000010_tables_files.sql — files schema tables (Category 0). Source: 0002_files_tables.sql.
-- =============================================================================================

CREATE TABLE files.folders (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    owner_user_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT folders_pkey PRIMARY KEY (id),
        CONSTRAINT folders_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users (id),
        CONSTRAINT folders_parent_fkey FOREIGN KEY (parent_folder_id) REFERENCES files.folders (id)
);

CREATE TABLE files.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  folder_id uuid,
  bucket_id text NOT NULL,
  storage_path text NOT NULL,
  target_bucket text,
  target_path text,
  display_name text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  -- Rich taxonomy for search/filter/facets/analytics; classified by the fat backend on upload from
  -- (original_name, mime_type) via @projective/types/files `describeFile`. NOT NULL so every row is
  -- faceable; defaults to 'Other' until classified. See documentation/database/files/Storage.md.
  category files.file_category NOT NULL DEFAULT 'Other',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending_upload',
  is_archived boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT files_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
  CONSTRAINT files_folder_fkey FOREIGN KEY (folder_id) REFERENCES files.folders(id)
);
