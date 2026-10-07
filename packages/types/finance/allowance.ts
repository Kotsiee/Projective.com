import { z } from "zod";
import { PlanAudience, PlanTier } from "./plans.ts";
import { timestamp, uuid } from "./common.ts";

/**
 * finance allowance — the proposal allowance as the product reads it: the weekly quota, the anti-burst
 * buffer, when the next token drips back, and whether an application would be accepted right now.
 *
 * It is a READ PROJECTION over `finance.allowance_periods`, produced by the caller-scoped door
 * `finance.get_proposal_allowance(p_team_id)` (which opens the week and pays out the lazy drip on
 * read). The raw row lives in `entitlements.ts` ({@link import("./entitlements.ts").AllowancePeriod});
 * this is the shape the meter, the countdown and the pre-flight gate share, so the account popover,
 * the conversion lane and the apply modal can never disagree about what "3 ready" means.
 *
 * Two rules shape it (PRODUCT_SPEC §Proposal allowances; Decision #154):
 *
 * - **A spend needs both a weekly unit AND a buffer token.** Either one at zero stops an application.
 * - **Metering is not enforcement.** The over-cap reasons (`weekly_exhausted`, `buffer_exhausted`) only
 *   REFUSE while `security.platform_params.proposal_allowance_enforced` is on (Decision #58's fail-open
 *   switch); while it is off the meter still reads empty, the UI says so, and the application goes
 *   through. The eligibility reasons (`team_too_small`, `missing_permission`) are rules, not meters,
 *   and always refuse.
 */

// #region Vocabulary
/** Why an application cannot (or, while unenforced, should not) be sent right now. */
export const AllowanceBlockReason = z.enum([
	"weekly_exhausted",
	"buffer_exhausted",
	"team_too_small",
	"missing_permission",
]);
export type AllowanceBlockReason = z.infer<typeof AllowanceBlockReason>;

/** The reasons governed by the enforcement switch — the meters. The rest are eligibility rules. */
export const METERED_BLOCK_REASONS: readonly AllowanceBlockReason[] = [
	"weekly_exhausted",
	"buffer_exhausted",
];

/** The minimum active members a team needs before it may send proposals (PRODUCT_SPEC). */
export const TEAM_PROPOSAL_MIN_MEMBERS = 2;
// #endregion

// #region Status
/** `GET /api/user/allowance` — the acting subject's proposal allowance, resolved. */
export const ProposalAllowanceStatusSchema = z.object({
	/** Whose allowance this is: the person (`user`), or the team being acted as. */
	subjectType: z.enum(["user", "team"]),
	subjectId: uuid,
	/** This week's ceiling — the plan's base plus the earned Standing bonus (plus any grant). */
	weeklyGranted: z.number().int().min(0),
	weeklyConsumed: z.number().int().min(0),
	weeklyRemaining: z.number().int().min(0),
	/** When the weekly quota resets (Monday 00:00 UTC — the period's end). */
	weeklyResetsAt: timestamp,
	/** Tokens banked in the anti-burst buffer right now. */
	bufferUnits: z.number().int().min(0),
	/** The most the buffer holds (the drip × `proposal_buffer_hold_multiple`). */
	bufferCap: z.number().int().min(0),
	/** Tokens returned per replenish window (3 free / 5 Pro). */
	bufferDrip: z.number().int().min(0),
	/** The replenish window, in hours (`proposal_buffer_window_hours`). */
	bufferWindowHours: z.number().int().min(1),
	/** When the next drip lands; `null` while the buffer is full (nothing is dripping). */
	nextBufferRefillAt: timestamp.nullable(),
	/** Whether an application sent now would be accepted. */
	canApply: z.boolean(),
	/** Why the subject is out — present whenever it is, enforced or not. */
	blockReason: AllowanceBlockReason.optional(),
	/** Whether the over-cap reasons refuse (`proposal_allowance_enforced`). */
	enforced: z.boolean(),
	planCode: z.string(),
	planLabel: z.string(),
	planTier: PlanTier,
	/**
	 * What upgrading would give — the same audience's Pro plan, named for an offer ("Individual Pro"),
	 * and its weekly base. `null` on a paid plan, where there is nothing to accelerate to.
	 */
	upgrade: z.object({ planLabel: z.string(), weeklyUnits: z.number().int().min(0) }).nullable(),
	/** The earned rung, 1–5. */
	standingLevel: z.number().int().min(1).max(5),
	/** Weekly units the rung adds on top of the plan's base. */
	standingBonus: z.number().int().min(0),
	/** Active members, for a team subject; `null` for a person. */
	teamMemberCount: z.number().int().min(0).nullable(),
	/** Whether the caller may bind the team to work (`bind_seat`); `null` for a person. */
	canBindSeat: z.boolean().nullable(),
	/** The database clock the projection was taken at — countdowns anchor to it, not the client's. */
	serverNow: timestamp,
});
export type ProposalAllowanceStatus = z.infer<typeof ProposalAllowanceStatusSchema>;

/** What `finance.get_proposal_allowance` returns (snake_case, straight from `jsonb_build_object`). */
export const ProposalAllowanceRowSchema = z.object({
	subject_type: z.enum(["user", "team"]),
	subject_id: uuid,
	period_end: timestamp,
	granted_units: z.number().int(),
	consumed_units: z.number().int(),
	standing_bonus_units: z.number().int(),
	buffer_units: z.number().int(),
	buffer_cap: z.number().int(),
	buffer_refreshed_at: timestamp,
	buffer_window_hours: z.number().int(),
	buffer_drip: z.number().int(),
	plan_code: z.string().nullable(),
	plan_label: z.string().nullable(),
	plan_tier: PlanTier.nullable(),
	plan_audience: PlanAudience.nullable(),
	upgrade_plan_label: z.string().nullable(),
	upgrade_weekly_units: z.number().int().nullable(),
	standing_level: z.number().int(),
	enforced: z.boolean(),
	team_member_count: z.number().int().nullable(),
	can_bind_seat: z.boolean().nullable(),
	server_now: timestamp,
});
export type ProposalAllowanceRow = z.infer<typeof ProposalAllowanceRowSchema>;
// #endregion

// #region Pure resolution (mirrors fn_consume_allowance's guard + the eligibility rules)
/**
 * When the buffer's next drip lands: one window after the drip clock, or `null` while the buffer is
 * full. The clock is `buffer_refreshed_at`, which the database advances by whole windows (never to
 * "now"), so this instant is the truth and not an estimate.
 */
export function nextBufferRefillAt(
	bufferUnits: number,
	bufferCap: number,
	refreshedAt: string,
	windowHours: number,
): string | null {
	if (bufferCap <= 0 || bufferUnits >= bufferCap) return null;
	const at = Date.parse(refreshedAt);
	if (!Number.isFinite(at)) return null;
	return new Date(at + windowHours * 3_600_000).toISOString();
}

/**
 * The first reason an application would be stopped, most fundamental first: eligibility before the
 * meters, and the weekly quota before the buffer (a drip cannot help an empty week).
 */
export function allowanceBlockReason(
	input: {
		weeklyRemaining: number;
		bufferUnits: number;
		bufferCap: number;
		teamMemberCount: number | null;
		canBindSeat: boolean | null;
	},
): AllowanceBlockReason | undefined {
	if (input.teamMemberCount !== null && input.teamMemberCount < TEAM_PROPOSAL_MIN_MEMBERS) {
		return "team_too_small";
	}
	if (input.canBindSeat === false) return "missing_permission";
	if (input.weeklyRemaining <= 0) return "weekly_exhausted";
	if (input.bufferCap > 0 && input.bufferUnits <= 0) return "buffer_exhausted";
	return undefined;
}

/** Whether a reason refuses: eligibility always; a meter only while enforcement is on. */
export function refusesApplication(
	reason: AllowanceBlockReason | undefined,
	enforced: boolean,
): boolean {
	if (!reason) return false;
	return METERED_BLOCK_REASONS.includes(reason) ? enforced : true;
}

/**
 * The name an upgrade is offered under. The catalogue labels the individual Pro plan just "Pro" (the
 * plan picker shows it beside "Free"); an offer made from a proposal meter has no picker beside it, so
 * the audience is named.
 */
function upgradeLabel(label: string, audience: PlanAudience | null): string {
	return audience === "individual" && !/individual/i.test(label) ? `Individual ${label}` : label;
}

/** Resolve the database row into the status every surface renders. Pure and total. */
export function resolveProposalAllowance(row: ProposalAllowanceRow): ProposalAllowanceStatus {
	const weeklyRemaining = Math.max(row.granted_units - row.consumed_units, 0);
	const blockReason = allowanceBlockReason({
		weeklyRemaining,
		bufferUnits: row.buffer_units,
		bufferCap: row.buffer_cap,
		teamMemberCount: row.team_member_count,
		canBindSeat: row.can_bind_seat,
	});
	return {
		subjectType: row.subject_type,
		subjectId: row.subject_id,
		weeklyGranted: row.granted_units,
		weeklyConsumed: row.consumed_units,
		weeklyRemaining,
		weeklyResetsAt: row.period_end,
		bufferUnits: row.buffer_units,
		bufferCap: row.buffer_cap,
		bufferDrip: row.buffer_drip,
		bufferWindowHours: Math.max(1, row.buffer_window_hours),
		nextBufferRefillAt: nextBufferRefillAt(
			row.buffer_units,
			row.buffer_cap,
			row.buffer_refreshed_at,
			Math.max(1, row.buffer_window_hours),
		),
		canApply: !refusesApplication(blockReason, row.enforced),
		...(blockReason ? { blockReason } : {}),
		enforced: row.enforced,
		planCode: row.plan_code ?? "individual_free",
		planLabel: row.plan_label ?? "Free",
		planTier: row.plan_tier ?? "free",
		upgrade: row.upgrade_plan_label && row.upgrade_weekly_units !== null
			? {
				planLabel: upgradeLabel(row.upgrade_plan_label, row.plan_audience),
				weeklyUnits: row.upgrade_weekly_units,
			}
			: null,
		standingLevel: Math.min(5, Math.max(1, row.standing_level)),
		standingBonus: Math.max(0, row.standing_bonus_units),
		teamMemberCount: row.team_member_count,
		canBindSeat: row.can_bind_seat,
		serverNow: row.server_now,
	};
}
// #endregion

// #region Copy — one wording for the 422 refusal and the in-app notices
/** `04h 12m 30s` — the live countdown, zero-padded and never negative. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(total / 3600))}h ${pad(Math.floor((total % 3600) / 60))}m ${
		pad(total % 60)
	}s`;
}

/** `2h 45m` — the compact countdown for a meta line; anything under a minute rounds up to `1m`. */
export function formatCountdownShort(ms: number): string {
	const minutes = Math.ceil(Math.max(0, ms) / 60_000);
	const hours = Math.floor(minutes / 60);
	return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * What to tell an applicant who is out, split around the one live figure so a client can tick the
 * countdown in place: `lead` + countdown to `countdownTo` + `tail`. `blocking` is false while the
 * switch is off — the sentence then says the application will still go through.
 */
export interface AllowanceNotice {
	reason: AllowanceBlockReason;
	blocking: boolean;
	lead: string;
	/** The instant the countdown runs to, or `null` when the sentence has no live figure. */
	countdownTo: string | null;
	tail: string;
}

/** The notice for a status that is out, or `null` when nothing stands in the way. */
export function allowanceNotice(status: ProposalAllowanceStatus): AllowanceNotice | null {
	const reason = status.blockReason;
	if (!reason) return null;
	const blocking = !status.canApply;
	const soft = blocking
		? ""
		: " Pacing isn't enforced yet, so an application will still go through.";
	switch (reason) {
		case "buffer_exhausted":
			return {
				reason,
				blocking,
				lead:
					`Pacing limit reached (max ${status.bufferDrip} applications per ${status.bufferWindowHours} hours to prevent spam). Next proposal token available in `,
				countdownTo: status.nextBufferRefillAt,
				tail: `.${soft}`,
			};
		case "weekly_exhausted": {
			const offer = status.upgrade
				? `, or upgrade to ${status.upgrade.planLabel} for ${status.upgrade.weeklyUnits}/week.`
				: ".";
			return {
				reason,
				blocking,
				lead:
					`Weekly proposal allowance reached (${status.weeklyConsumed}/${status.weeklyGranted}). Resets on Monday 00:00 UTC${offer}${soft}`,
				countdownTo: null,
				tail: "",
			};
		}
		case "team_too_small":
			return {
				reason,
				blocking,
				lead:
					`Teams must have at least ${TEAM_PROPOSAL_MIN_MEMBERS} members before applying to client projects.`,
				countdownTo: null,
				tail: "",
			};
		case "missing_permission":
			return {
				reason,
				blocking,
				lead: "Only a team member who can commit the team to work may apply on its behalf.",
				countdownTo: null,
				tail: "",
			};
	}
}

/** The notice as one plain sentence, its countdown measured at `nowMs` — the server's 422 message. */
export function allowanceNoticeText(notice: AllowanceNotice, nowMs: number): string {
	const figure = notice.countdownTo ? formatCountdown(Date.parse(notice.countdownTo) - nowMs) : "";
	return `${notice.lead}${figure}${notice.tail}`;
}
// #endregion
