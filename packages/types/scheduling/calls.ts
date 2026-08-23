import { z } from "zod";
import { timestamp, uuid } from "./rows.ts";

/**
 * Discovery & courtesy calls — the Zod SSOT for the pre-engagement booking layer.
 *
 * Mirrors the consolidated `supabase/migrations/00000022_tables_scheduling.sql` (settings, the
 * booking record, the Digital Handshake attendance log, the audit trail) plus `00001510` (the
 * refusal vocabulary the in-DB gate returns) / `00001860` (its enforcement triggers). The
 * timestamped `2026072410xxxx_scheduling_*.sql` files these were first authored in were folded into
 * those consolidated files (root CLAUDE.md §1) and no longer exist.
 *
 * **The central distinction (PRODUCT_SPEC.md §Discovery & Courtesy Calls).** A discovery call is a
 * TOP-OF-FUNNEL CONVERSION TOOL, not a deliverable: it creates no project, stage, or ticket, never
 * enters the `PRODUCT_MANAGEMENT.md` §3.1 delivery state-machine, and does not count toward
 * Workload Intensity. Two flavours:
 * - `courtesy` — free, the common case. A pure "Calendar Handshake": request → confirm →
 *   auto-generated meeting link. No payment, no escrow, no KYC gate.
 * - `paid` — a chargeable consultation, priced by the provider (PRODUCT_SPEC.md §Why Sessions are
 *   Fixed: session pricing is provider-set, never negotiated).
 *
 * ⚠️ **Flagged (root CLAUDE.md §8).** A paid call cannot yet ride `finance.escrows`: that table
 * requires both `project_stage_id` and `payer_business_id` NOT NULL, so a standalone 1-1 call
 * between an individual client and a freelancer has no legal escrow row. {@link DiscoveryCallSchema}
 * `escrowId` is therefore nullable and populated only when a call attaches to an already-funded
 * stage. Relaxing those columns (a PROTECTED table) or auto-provisioning a session-format
 * micro-project are the two candidate fixes; both need human sign-off.
 *
 * ⚠️ **Flagged.** Cancellation economics are recorded as OUTCOMES (`refundAmountMinor` /
 * `penaltyAmountMinor`), never hard-coded, because `finance-model.md` §4 (50% forfeit) and
 * `PRODUCT_SPEC.md` §Sessions (full forfeit) still disagree. The COURTESY rules are new and
 * deliberate: a free call has no money, so a late cancel or no-show carries no financial
 * consequence and is a reliability signal only.
 */

// #region Money primitives (reused shape, not a fork)
/** An amount in integer minor units (pence/cents) — the same money model as `finance`. */
export const minorUnits = z.number().int().min(0);
/** An ISO-4217 currency code. */
export const currency = z.string().min(3).max(8);
// #endregion

// #region Vocabulary
/** `scheduling.call_type` — free courtesy call vs chargeable consultation. */
export const CallType = z.enum(["courtesy", "paid"]);
export type CallType = z.infer<typeof CallType>;

/**
 * `scheduling.call_status` — the discovery-call DOMAIN lifecycle (PRODUCT_MANAGEMENT.md §3.5;
 * never a delivery-board column).
 *
 * ```
 * proposed  → confirmed → completed
 * proposed  → declined            (host says no)
 * proposed  → expired             (nobody answered before the slot passed)
 * confirmed → cancelled           (either party; `cancelledBy` + `isLateCancel` record which/when)
 * confirmed → no_show             (`noShowParty` records who)
 * ```
 *
 * A reschedule is deliberately NOT a state: it returns the row to `proposed`, increments
 * `rescheduleCount`, and appends an audit line. `declined` / `cancelled` / `completed` / `no_show`
 * / `expired` are terminal — nothing is hard-deleted (root CLAUDE.md §5).
 */
export const CallStatus = z.enum([
	"proposed",
	"confirmed",
	"declined",
	"cancelled",
	"completed",
	"no_show",
	"expired",
]);
export type CallStatus = z.infer<typeof CallStatus>;

/** `scheduling.call_party` — which side of a call an outcome attaches to. */
export const CallParty = z.enum(["host", "requester", "both"]);
export type CallParty = z.infer<typeof CallParty>;

/** `scheduling.call_action` — the audit-trail vocabulary (this is where a reschedule lives). */
export const CallAction = z.enum([
	"requested",
	"confirmed",
	"declined",
	"rescheduled",
	"cancelled",
	"completed",
	"marked_no_show",
	"expired",
	"link_generated",
	"reminder_sent",
]);
export type CallAction = z.infer<typeof CallAction>;

/**
 * The machine-readable refusal codes `scheduling.fn_call_request_refusal` returns. A reason rather
 * than a bare boolean lets the UI explain a refusal without re-deriving the rules client-side.
 */
export const CallRefusalReason = z.enum([
	"calls_not_offered",
	"courtesy_not_offered",
	"paid_not_offered",
	"duration_mismatch",
	"duration_exceeds_platform_max",
	"inside_minimum_notice",
	"beyond_booking_horizon",
	"outside_call_window",
	"slot_unavailable",
	"weekly_courtesy_cap_reached",
	"requester_in_cooldown",
]);
export type CallRefusalReason = z.infer<typeof CallRefusalReason>;
// #endregion

// #region scheduling.call_settings
/**
 * A row of `scheduling.call_settings` — the provider's booking configuration, one per schedule.
 * This is what a freelancer edits under Settings; the in-DB gate reads it.
 */
export const CallSettingsSchema = z.object({
	scheduleId: uuid,
	/** Master switch. False → the "Book a call" affordance never renders and every request fails. */
	acceptsCalls: z.boolean(),
	courtesyEnabled: z.boolean(),
	courtesyDurationMinutes: z.number().int().min(5).max(240),
	/** Free calls the owner will host per calendar week. 0 = unlimited. */
	courtesyMaxPerWeek: z.number().int().min(0),
	/** Days a requester must wait before booking another free call. 0 = no cooldown. */
	courtesyCooldownDays: z.number().int().min(0),
	paidEnabled: z.boolean(),
	paidDurationMinutes: z.number().int().min(5).max(480),
	feeAmountMinor: minorUnits.nullable(),
	feeCurrency: currency.nullable(),
	/** The burnout guard: dead time reserved either side of every call. */
	bufferBeforeMinutes: z.number().int().min(0).max(240),
	bufferAfterMinutes: z.number().int().min(0).max(240),
	/** How close to a slot a request may still be made. */
	minNoticeMinutes: z.number().int().min(0),
	/** How far ahead the booking grid opens. */
	maxAdvanceDays: z.number().int().min(1).max(365),
	/** True → a request inside a call window is auto-confirmed instead of awaiting the host. */
	autoConfirm: z.boolean(),
	/** The anti-tyre-kicker field: force the requester to state a purpose. */
	agendaRequired: z.boolean(),
	/** Which connected provider mints the room; null falls back to the user's active connection. */
	preferredProviderSlug: z.string().max(40).nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type CallSettings = z.infer<typeof CallSettingsSchema>;

/** The owner-editable slice of {@link CallSettingsSchema}. */
export const UpdateCallSettingsSchema = CallSettingsSchema.omit({
	scheduleId: true,
	createdAt: true,
	updatedAt: true,
}).partial();
export type UpdateCallSettings = z.infer<typeof UpdateCallSettingsSchema>;

/**
 * The publicly visible slice — what a signed-out visitor may learn before booking: whether calls
 * are offered, how long they run, and what a paid one costs. Never the caps, cooldowns, or buffers.
 */
export const PublicCallOfferSchema = z.object({
	acceptsCalls: z.boolean(),
	courtesyEnabled: z.boolean(),
	courtesyDurationMinutes: z.number().int(),
	paidEnabled: z.boolean(),
	paidDurationMinutes: z.number().int(),
	feeAmountMinor: minorUnits.nullable(),
	feeCurrency: currency.nullable(),
	agendaRequired: z.boolean(),
});
export type PublicCallOffer = z.infer<typeof PublicCallOfferSchema>;
// #endregion

// #region scheduling.discovery_calls
/** A row of `scheduling.discovery_calls` — the booking record. */
export const DiscoveryCallSchema = z.object({
	id: uuid,
	hostScheduleId: uuid,
	hostUserId: uuid,
	requesterUserId: uuid,
	callType: CallType,
	status: CallStatus,
	/** The slot as first asked for — kept after a reschedule so the trail stays legible. */
	proposedStart: timestamp,
	proposedEnd: timestamp,
	/** The agreed slot; null until `confirmed`. */
	confirmedStart: timestamp.nullable(),
	confirmedEnd: timestamp.nullable(),
	/** The IANA zone the REQUESTER was viewing in; the host's zone lives on the schedule. */
	requesterTimezone: z.string().max(60).nullable(),
	agenda: z.string().max(2000).nullable(),
	/** The conferencing provider that minted the room, and the room itself. */
	providerSlug: z.string().max(40).nullable(),
	connectionId: uuid.nullable(),
	meetingUrl: z.string().max(600).nullable(),
	meetingExternalId: z.string().max(200).nullable(),
	/** The calendar mirror, so the call renders on both parties' grids. */
	eventId: uuid.nullable(),
	feeAmountMinor: minorUnits.nullable(),
	feeCurrency: currency.nullable(),
	/** Opaque provider payment reference (Stripe PaymentIntent). No PII. */
	paymentRef: z.string().max(200).nullable(),
	/** Populated only when the call attaches to an already-funded stage — see the flag above. */
	escrowId: uuid.nullable(),
	/** Recorded outcomes, not a hard-coded policy. */
	refundAmountMinor: minorUnits.nullable(),
	penaltyAmountMinor: minorUnits.nullable(),
	proposedAt: timestamp,
	respondedAt: timestamp.nullable(),
	confirmedAt: timestamp.nullable(),
	cancelledAt: timestamp.nullable(),
	cancelledBy: CallParty.nullable(),
	cancellationReason: z.string().max(500).nullable(),
	/** True when the cancel landed inside the platform cancellation window. Derived in-DB. */
	isLateCancel: z.boolean(),
	completedAt: timestamp.nullable(),
	noShowParty: CallParty.nullable(),
	rescheduleCount: z.number().int().min(0),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type DiscoveryCall = z.infer<typeof DiscoveryCallSchema>;

/** Request a call. Every other constraint is enforced by the in-DB booking gate. */
export const RequestCallSchema = z.object({
	hostScheduleId: uuid,
	callType: CallType.default("courtesy"),
	proposedStart: timestamp,
	proposedEnd: timestamp,
	requesterTimezone: z.string().max(60).optional(),
	agenda: z.string().max(2000).optional(),
});
export type RequestCall = z.infer<typeof RequestCallSchema>;

/** Move a call along its lifecycle. Legality is enforced by the in-DB transition trigger. */
export const TransitionCallSchema = z.object({
	callId: uuid,
	status: CallStatus,
	/** Required when rescheduling (status back to `proposed`) with a new slot. */
	proposedStart: timestamp.optional(),
	proposedEnd: timestamp.optional(),
	/** Required when confirming. */
	confirmedStart: timestamp.optional(),
	confirmedEnd: timestamp.optional(),
	cancelledBy: CallParty.optional(),
	cancellationReason: z.string().max(500).optional(),
	noShowParty: CallParty.optional(),
});
export type TransitionCall = z.infer<typeof TransitionCallSchema>;
// #endregion

// #region Attendance & audit
/**
 * A row of `scheduling.call_attendance` — the "Digital Handshake" presence log, fed by
 * server-to-server conferencing webhooks. The evidence that a call actually happened, playing the
 * same role `projects.session_attendance` plays for a delivered Session Service.
 */
export const CallAttendanceSchema = z.object({
	id: uuid,
	callId: uuid,
	/** Null when the provider reported a participant the platform cannot map to an account. */
	userId: uuid.nullable(),
	joinedAt: timestamp,
	leftAt: timestamp.nullable(),
	sourceProviderSlug: z.string().max(40).nullable(),
	externalParticipantId: z.string().max(200).nullable(),
	createdAt: timestamp,
});
export type CallAttendance = z.infer<typeof CallAttendanceSchema>;

/** A row of `scheduling.call_audit` — one line per transition, reschedule, or link generation. */
export const CallAuditEntrySchema = z.object({
	id: uuid,
	callId: uuid,
	action: CallAction,
	actorUserId: uuid.nullable(),
	fromStatus: CallStatus.nullable(),
	toStatus: CallStatus.nullable(),
	slotStart: timestamp.nullable(),
	slotEnd: timestamp.nullable(),
	detail: z.string().max(500).nullable(),
	createdAt: timestamp,
});
export type CallAuditEntry = z.infer<typeof CallAuditEntrySchema>;
// #endregion

// #region Helpers
/** Terminal statuses — a call in one of these can never transition again. */
export const TERMINAL_CALL_STATUSES: readonly CallStatus[] = [
	"declined",
	"cancelled",
	"completed",
	"no_show",
	"expired",
];

/** Is this call finished, one way or another? Pure, total. */
export function isCallTerminal(status: CallStatus): boolean {
	return TERMINAL_CALL_STATUSES.includes(status);
}

/**
 * The legal-transition matrix, mirroring `scheduling.fn_enforce_call_transition` exactly. Keep the
 * two in step: the trigger is the authority, this is the client-side pre-check.
 */
export const CALL_TRANSITIONS: Record<CallStatus, readonly CallStatus[]> = {
	proposed: ["proposed", "confirmed", "declined", "cancelled", "expired"],
	confirmed: ["proposed", "cancelled", "completed", "no_show"],
	declined: [],
	cancelled: [],
	completed: [],
	no_show: [],
	expired: [],
};

/** May a call move from `from` to `to`? Pure, total. */
export function canTransitionCall(from: CallStatus, to: CallStatus): boolean {
	return CALL_TRANSITIONS[from].includes(to);
}

/** Human copy for each refusal code, for the booking UI. */
export const CALL_REFUSAL_COPY: Record<CallRefusalReason, string> = {
	calls_not_offered: "This person isn't taking calls right now.",
	courtesy_not_offered: "Free intro calls aren't offered here.",
	paid_not_offered: "Paid consultations aren't offered here.",
	duration_mismatch: "Pick one of the offered call lengths.",
	duration_exceeds_platform_max: "That call is longer than we allow.",
	inside_minimum_notice: "That's too soon — pick a later slot.",
	beyond_booking_horizon: "That's further ahead than bookings are open.",
	outside_call_window: "That time is outside their call hours.",
	slot_unavailable: "That slot has just been taken.",
	weekly_courtesy_cap_reached: "They're fully booked for free calls this week.",
	requester_in_cooldown: "You've had a free call recently — try again later.",
};
// #endregion
