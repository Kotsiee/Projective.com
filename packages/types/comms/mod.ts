/**
 * `comms` schema shapes — the Notification Engine SSOT.
 *
 * Backs the notification half of the `comms` schema: the pre-existing `comms.notifications` /
 * `notification_prefs` / `device_tokens` tables (migration 0008) plus the engine added by
 * migrations `20260724090000..20260724094000` — the `notification_types` catalog, per-category and
 * per-type preferences, per-channel delivery tracking, the scheduled-send queue, digests, provider
 * callbacks and suppressions.
 *
 * The messaging half of `comms` (project channels, DM threads, message rows) is modelled by
 * `@projective/types/messaging` and is not re-declared here.
 *
 * The migrations, these schemas, and `documentation/database/comms/*` land together
 * (root CLAUDE.md §1).
 */
export * from "./common.ts";
export * from "./catalog.ts";
export * from "./notifications.ts";
export * from "./preferences.ts";
