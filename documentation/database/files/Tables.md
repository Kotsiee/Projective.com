# files Schema: Tables

The `files` schema provides a virtualized file system layer over Supabase Storage. It allows users
to organize their assets into folders, track metadata, and manage file statuses independently of the
physical storage buckets.

## 📂 Directory Structure

### `files.folders`

Enables hierarchical organization of user assets. Folders are private to the owning user.

| Column             | Type        | Notes                                                |
| :----------------- | :---------- | :--------------------------------------------------- |
| `id`               | uuid        | PK.                                                  |
| `owner_user_id`    | uuid        | FK → `auth.users.id`.                                |
| `parent_folder_id` | uuid        | FK → `files.folders.id` (Allows nested directories). |
| `name`             | text        | Folder display name.                                 |
| `created_at`       | timestamptz | Timestamp of creation.                               |

```sql
CREATE TABLE files.folders (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    owner_user_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT folders_pkey PRIMARY KEY (id),
    CONSTRAINT folders_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users (id),
    CONSTRAINT folders_parent_fkey FOREIGN KEY (parent_folder_id) REFERENCES files.folders (id)
);
```

---

## 📄 File Management

### `files.items`

The central registry for all files uploaded to the platform. It tracks the relationship between the
database entry and the actual Supabase Storage object.

| Column          | Type    | Notes                                                         |
| :-------------- | :------ | :------------------------------------------------------------ |
| `id`            | uuid    | PK.                                                           |
| `owner_user_id` | uuid    | FK → `auth.users.id`.                                         |
| `folder_id`     | uuid    | FK → `files.folders.id` (Optional).                           |
| `bucket_id`     | text    | Supabase Storage bucket name (e.g., `project`, `quarantine`). |
| `storage_path`  | text    | Full path to the object within the bucket.                    |
| `display_name`  | text    | User-defined name.                                            |
| `original_name` | text    | Filename as uploaded by the client.                           |
| `mime_type`     | text    | Sanitized MIME type.                                          |
| `size_bytes`    | bigint  | File size for quota management.                               |
| `metadata`      | jsonb   | Extra fields (e.g., image dimensions, PDF page count).        |
| `status`        | text    | `pending_upload`, `uploaded`, `error`.                        |
| `is_archived`   | boolean | Logical deletion flag.                                        |

```sql
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
```

---

## 🚩 Refactor Notes & Suggestions

- **Bucket Synchronization**: The `bucket_id` and `storage_path` columns must stay in sync with the
  physical Supabase Storage state.
  - _Suggestion_: Use a database trigger or a Deno Edge Function to handle `DELETE` operations on
    `files.items` to ensure orphaned files aren't left in the storage bucket.
- **Redundancy with org.attachments**: There is overlap between `files.items` and `org.attachments`.
  - _Suggestion_: Consolidate these into a single storage metadata table or clarify the distinction
    (e.g., `files.items` for user-facing file management, `org.attachments` for strictly immutable
    project deliverables).
- **Target Bucket Fields**: The columns `target_bucket` and `target_path` in `files.items` appear to
  be placeholders for a "Move" or "Promote from Quarantine" workflow. These should be clearly
  defined in the file processing service logic.
