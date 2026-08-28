/**
 * @projective/types/scheduling — the Calendar & Schedule domain barrel. One vocabulary shared by the
 * project/channel calendar, the `@handle` availability page, and session-based service schedules,
 * rendered by the `@projective/ui/calendar` engine.
 *
 * Six layers, deliberately separate:
 * - {@link ./scheduling.ts} — the READ PROJECTIONS a calendar surface renders (epoch-ms positions,
 *   flattened for the engine's presentational contract) plus the write payloads it posts back.
 * - {@link ./coordination.ts} — an event's participants, RSVPs, money, reschedule negotiation,
 *   voting and audit log, and the pure business rules governing all of it.
 * - {@link ./privacy.ts} — what a given VIEWER may receive of that, applied at the service boundary
 *   on every read. Separate from the rules above on purpose: those answer "may this happen", this
 *   answers "may this person see it".
 * - {@link ./meeting.ts} — the CONFERENCING axis (which tool mints the room), kept physically apart
 *   from the calendar-sync chip vocabulary per root CLAUDE.md §8 Decision #56.
 * - {@link ./sim.ts} — the developer SIMULATION overlay. The Dev Context Switcher is a client seam
 *   the server cannot see, so every axis a calendar surface branches on travels as a validated query
 *   param and the fat service applies it as an overlay. It grants no access.
 * - {@link ./rows.ts} — the `scheduling` schema ROW shapes (ISO timestamps, uuid keys), mirroring
 *   the consolidated `supabase/migrations/00000022_tables_scheduling.sql`.
 * - {@link ./calls.ts} — discovery & courtesy calls: settings, the booking record, the Digital
 *   Handshake attendance log, and the lifecycle, mirroring the same consolidated DDL plus
 *   `00001510` (functions) / `00001860` (triggers) / `00002015` (policies).
 * - {@link ./booking.ts} — the BOOKABLE SLOT GRID behind a session listing's Book modal and the
 *   discovery-call handshake: the read side of `availability_rules` + `fn_slot_is_free`, flattened
 *   for a picker rather than for a calendar grid, with every instant absolute and both zone names
 *   carried so the client formats in the viewer's zone without re-interpreting a wall clock.
 * - {@link ./ics.ts} — the iCalendar (RFC 5545) READER, the exact inverse of the writer in
 *   `@projective/types/finance` `order.ts`. Pure: no clock, no IO, so the fat service and the
 *   browser call one implementation and a `.ics` import cannot be parsed two different ways.
 *
 * ⚠️ **`coordination.ts` and `meeting.ts` have no tables yet.** They are read+write PROJECTIONS the
 * fat `ScheduleBackendService` derives from fixtures (and mutates in a per-process session store),
 * exactly as `projects/detail`, `projects/messages` and `finance/wallet` did before their live
 * paths landed. The consolidated `scheduling` DDL stores only `attendee_count integer`, a single
 * `proposed_start`/`proposed_end` pair on `discovery_calls`, and no vote or per-event history table
 * at all — so persisting a roster, a multi-slot ballot or an event audit log needs new tables folded
 * into the consolidated migrations (root CLAUDE.md §1), landing with their RLS policies and the
 * matching `documentation/database/scheduling/*` update in the same change.
 */
export * from "./scheduling.ts";
export * from "./coordination.ts";
export * from "./privacy.ts";
export * from "./meeting.ts";
export * from "./sim.ts";
export * from "./rows.ts";
export * from "./calls.ts";
export * from "./booking.ts";
export * from "./ics.ts";
