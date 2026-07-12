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
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending_upload',
  is_archived boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT files_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
  CONSTRAINT files_folder_fkey FOREIGN KEY (folder_id) REFERENCES files.folders(id)
);