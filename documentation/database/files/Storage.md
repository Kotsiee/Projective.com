# files Schema: Storage

This document outlines the Supabase Storage bucket architecture for Projective. The storage layer is
physically isolated into buckets based on access patterns, caching requirements, and security
levels.

## 🪣 Bucket Overview

| Bucket          | Access  | Description                                                          |
| :-------------- | :------ | :------------------------------------------------------------------- |
| `public_assets` | Public  | Unrestricted read access for profile branding and public portfolios. |
| `project`       | Private | Restricted to project participants; requires signed URLs.            |
| `personal`      | Private | Owner-only access for drafts, personal templates, and private DMs.   |
| `quarantine`    | Private | Temporary landing zone for virus scanning and MIME validation.       |

---

## 📂 Directory Structure

### 1. `public_assets`

Contains assets that are safe for global edge caching.

```text
public_assets/
├── users/
│   └── [user_id]/
│       ├── avatar.webp
│       └── banner.webp
├── businesses/
│   └── [business_id]/
│       └── logo.webp
├── teams/
│   └── [team_id]/
│       └── avatar.webp
└── portfolios/
    └── [portfolio_id]/
        └── preview.webp
```

### 2. `project` (Private)

Files related to active or archived collaboration. Access is governed by
`projects.has_project_access()`.

```text
project/
└── [project_id]/
    ├── stages/
    │   └── [stage_id]/
    │       └── submissions/
    │           └── [submission_id]/
    │               └── file.xyz
    ├── channels/
    │   └── [channel_id]/
    │       └── attachments/
    │           └── [attachment_id]/
    │               └── file.xyz
    └── assets/
        └── file.xyz
```

### 3. `personal` (Private)

User-specific storage for work-in-progress and non-project communications.

```text
personal/
└── users/
    └── [user_id]/
        ├── drafts/
        │   ├── messages/
        │   │   └── [draft_id]/
        │   │       └── file.xyz
        │   ├── projects/
        │   │   └── [draft_id]/
        │   │       └── file.xyz
        │   └── templates/
        │       └── [draft_id]/
        │           └── file.xyz
        ├── templates/
        │   └── [template_id]/
        │       └── bundle.zip
        └── dms/
            └── [dm_id]/
                └── [message_id]/
                    └── file.xyz
```

### 4. `quarantine` (Restricted)

The entry point for all uploads. Files are moved to their target bucket only after passing system
checks.

```text
quarantine/
└── [upload_session_id]/
    └── original_file.xyz
```

---

## 🔗 Database Integration

Storage paths are mapped to the database through two primary tables:

- **`org.attachments`**: Maps immutable files (submissions, profile avatars) to their storage
  location.
- **`files.items`**: Tracks the virtualized path (folders/items) for a user's personal file library.

### Example: Resolving a File Path

```sql
-- Fetching a signed URL for a stage submission deliverable
SELECT 
  'project/' || p.id || '/stages/' || ps.id || '/submissions/' || ss.id || '/' || a.path as full_storage_path
FROM projects.stage_submissions ss
JOIN projects.project_stages ps ON ss.project_stage_id = ps.id
JOIN projects.projects p ON ps.project_id = p.id
JOIN org.attachments a ON a.id = ss.attachment_id -- Assuming attachment link
WHERE ss.id = :submission_id;
```

## 🔐 Security Enforcement

- **Signed URLs**: All private buckets (`project`, `personal`, `quarantine`) utilize short-lived
  signed URLs (60s TTL) for downloads.
- **Upload Policy**: Users can only `INSERT` into the `quarantine` bucket or their specific
  `personal/users/[user_id]/` path.
- **Move Logic**: Moving a file from `quarantine` to `project` is an atomic operation performed by a
  `SECURITY DEFINER` function or a service role to prevent users from bypassing project-access
  checks.
