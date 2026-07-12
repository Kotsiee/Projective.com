# comms Schema: Tables

The `comms` schema handles all real-time and asynchronous communication within the platform. It is
split between project-specific collaboration (Channels) and personal messaging (DMs), supported by a
robust notification delivery system.

## 🔔 Notifications & Preferences

### `comms.notification_prefs`

Stores per-user configuration for alert delivery across different channels.

| Column        | Type      | Notes                                     |
| :------------ | :-------- | :---------------------------------------- |
| `user_id`     | uuid      | PK, FK → `auth.users.id`.                 |
| `email`       | boolean   | Toggle for email alerts (Default: true).  |
| `push`        | boolean   | Toggle for mobile push notifications.     |
| `quiet_hours` | tstzrange | Time range to suppress non-urgent alerts. |

### `comms.notifications`

The central ledger of all system-generated alerts. Real-time delivery is handled via Supabase
Realtime.

| Column         | Type        | Notes                                        |
| :------------- | :---------- | :------------------------------------------- |
| `id`           | uuid        | PK.                                          |
| `user_id`      | uuid        | Recipient.                                   |
| `type`         | text        | e.g., `message.new`, `stage.status_changed`. |
| `entity_table` | text        | Source table for the event.                  |
| `entity_id`    | uuid        | Specific row ID related to the alert.        |
| `read_at`      | timestamptz | Null if unread.                              |

---

## 💬 Direct Messaging (DMs)

### `comms.dm_threads`

Containers for 1:1 or group conversations separate from project work.

### `comms.dm_participants`

Join table mapping users to threads. Only users in this table can access thread history.

### `comms.dm_messages`

The individual message entries for DMs.

| Column            | Type    | Notes                       |
| :---------------- | :------ | :-------------------------- |
| `thread_id`       | uuid    | FK → `comms.dm_threads.id`. |
| `sender_user_id`  | uuid    | FK → `auth.users.id`.       |
| `body`            | text    | Message content.            |
| `has_attachments` | boolean | Flag for UI optimization.   |

---

## 🧱 Project Collaboration

### `comms.project_channels`

Themed chat rooms within a project workspace. Channels can be global to the project or restricted to
specific stages.

| Column       | Type | Notes                                       |
| :----------- | :--- | :------------------------------------------ |
| `project_id` | uuid | FK → `projects.projects.id`.                |
| `stage_id`   | uuid | Optional FK → `projects.project_stages.id`. |
| `visibility` | text | `project_all` or restricted.                |

### `comms.project_messages`

Stage-aware communication between clients and freelancers.

```sql
CREATE TABLE comms.project_messages (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    channel_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    body text NOT NULL,
    has_attachments boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT project_messages_pkey PRIMARY KEY (id)
);
```

---

## 📎 Attachments & Shared Files

### `comms.message_attachments`

Poly-morphic link table connecting messages to `org.attachments`.

| Column          | Type | Notes                                            |
| :-------------- | :--- | :----------------------------------------------- |
| `message_table` | text | `comms.project_messages` or `comms.dm_messages`. |
| `message_id`    | uuid | ID from the specified message table.             |
| `attachment_id` | uuid | FK → `org.attachments.id`.                       |

### `comms.channel_files`

Aggregates all files shared within a channel for easy gallery browsing.

---

## 🚩 Refactor Notes & Suggestions

- **Message Retention**: `deleted_at` columns exist for soft-deletion. Ensure a background cron job
  handles permanent purging for privacy compliance if required.
- **Presence Tracking**: While table-based notifications are implemented, ephemeral user presence
  (typing indicators, "online" status) should be handled via **Supabase Realtime Broadcast** rather
  than database writes to reduce IO.
- **Attachment Logic**: The `message_attachments` table uses a text-based `message_table` reference.
  This prevents hard foreign keys at the DB level.
  - _Suggestion_: Consider using a database view or function for unified attachment retrieval to
    simplify frontend queries.
