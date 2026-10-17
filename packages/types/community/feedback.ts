/**
 * community.feedback — the Zod SSOT for the public feedback board (P7, Decision #274). Placeholder
 * until P7 lands the tables.
 *
 * What belongs here: the row schemas of the idea, vote and status-event tables (`00000025`, region
 * `[feedback]`), the request and response shapes of `/api/feedback/ideas*`, and the board's status
 * vocabulary. An idea stores a UNIFIED-machine state (PRODUCT_MANAGEMENT.md §3), never a bespoke one:
 * `Backlog` (shown "Under review", visible only to its author and operators), `Ready` ("Planned"),
 * `In Progress`, `Complete` ("Shipped") and `Archived` — the displayed label differs, the stored state
 * does not (owner ruling (d), 2026-10-17). Import shared primitives from `./common.ts`, and prefix
 * every export `Feedback…` — this module is re-exported by the root barrel, where a bare name can
 * collide.
 */
export {};
