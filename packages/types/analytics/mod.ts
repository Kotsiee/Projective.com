/**
 * `analytics` schema shapes — the event substrate and its daily rollups.
 *
 * Backs `analytics.event_catalogue` / `analytics.events` / `analytics.daily_rollups` +
 * `analytics.fn_emit` (migration `20260724110000`). See `documentation/database/analytics/*`.
 */
export * from "./events.ts";
