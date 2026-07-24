/**
 * @projective/types/scheduling — the Calendar & Schedule domain barrel. One vocabulary shared by the
 * project/channel calendar, the `@handle` availability page, and session-based service schedules,
 * rendered by the `@projective/ui/calendar` engine.
 *
 * Three layers, deliberately separate:
 * - {@link ./scheduling.ts} — the READ PROJECTIONS a calendar surface renders (epoch-ms positions,
 *   flattened for the engine's presentational contract).
 * - {@link ./rows.ts} — the `scheduling` schema ROW shapes (ISO timestamps, uuid keys), mirroring
 *   migrations `20260724100000` / `20260724102000`.
 * - {@link ./calls.ts} — discovery & courtesy calls: settings, the booking record, the Digital
 *   Handshake attendance log, and the lifecycle, mirroring migrations `20260724103000` /
 *   `20260724104000`.
 */
export * from "./scheduling.ts";
export * from "./rows.ts";
export * from "./calls.ts";
