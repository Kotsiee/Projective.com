import {
	formatCountdownShort,
	type ProposalAllowanceStatus,
	TEAM_PROPOSAL_MIN_MEMBERS,
} from "@projective/types/finance";
import type { DevProposalAllowance } from "@web/utils/dev-seam.ts";

/**
 * allowance-model — the pure presentation rules for the proposal allowance: the meter line, its
 * tooltip, the refill line, the lane disclosure, when the upgrade link shows, how a countdown is
 * measured against the server's clock, and the Dev Context Switcher's simulated statuses.
 *
 * No Preact, no fetch: the popover meter, the lane disclosure, the apply modal and the proposal list
 * all render from these, and the unit tests pin them. The refusal SENTENCES live one level down, in
 * `@projective/types/finance` (`allowanceNotice`), because the server's 422 says the same words.
 */

// #region Snapshot + clock
/**
 * A status and the client instant it arrived. Every countdown is measured on the SERVER's clock — the
 * refill instant is a database timestamp — so the skew between the two clocks at receipt is carried
 * with the status rather than trusting a laptop's time.
 */
export interface AllowanceSnapshot {
	status: ProposalAllowanceStatus;
	/** `Date.now()` when the status was received. */
	receivedAt: number;
}

/** Milliseconds until `targetIso` on the server's clock, as seen from the client instant `nowMs`. */
export function msUntil(targetIso: string, snapshot: AllowanceSnapshot, nowMs: number): number {
	const skew = Date.parse(snapshot.status.serverNow) - snapshot.receivedAt;
	return Date.parse(targetIso) - (nowMs + (Number.isFinite(skew) ? skew : 0));
}
// #endregion

// #region Lines
/** `Proposals: 38/50 weekly · 12/12 ready` — weekly remaining of granted, buffer of cap. */
export function meterLine(status: ProposalAllowanceStatus): string {
	return `Proposals: ${status.weeklyRemaining}/${status.weeklyGranted} weekly · ${status.bufferUnits}/${status.bufferCap} ready`;
}

/** The meter as a sentence — what a screen reader hears instead of two slashed fractions. */
export function meterLabel(status: ProposalAllowanceStatus): string {
	return `Proposals: ${status.weeklyRemaining} of ${status.weeklyGranted} left this week, ` +
		`${status.bufferUnits} of ${status.bufferCap} tokens ready`;
}

/** `Next token in 2h 45m`, or `null` while the buffer is full (nothing is dripping). */
export function refillLine(snapshot: AllowanceSnapshot, nowMs: number): string | null {
	const at = snapshot.status.nextBufferRefillAt;
	if (!at) return null;
	const ms = msUntil(at, snapshot, nowMs);
	// Past due: the drip is paid out on the next read, which the store makes — say so rather than "0m".
	return ms > 0 ? `Next token in ${formatCountdownShort(ms)}` : "Next token arriving now";
}

/**
 * The tooltip: how the drip works, and what the earned rung adds. The rung sentence names a bonus only
 * when there is one — "L1 grants +0" would be a sentence about nothing.
 */
export function meterTooltip(status: ProposalAllowanceStatus): string {
	const drip = `Replenishes ${status.bufferDrip} ${
		status.bufferDrip === 1 ? "token" : "tokens"
	} every ${status.bufferWindowHours} hours.`;
	const rung = status.standingBonus > 0
		? ` Earned Standing L${status.standingLevel} grants +${status.standingBonus} weekly proposals.`
		: " Earned Standing adds weekly proposals as you climb.";
	return `${drip}${rung}`;
}

/** `1 proposal token · 12 ready` — the conversion lane's disclosure under Apply. */
export function disclosureLine(status: ProposalAllowanceStatus): string {
	return `1 proposal token · ${status.bufferUnits} ready`;
}

/**
 * Whether the upgrade affordance shows: the week is nearly spent (≤ 5 left) or the buffer is empty,
 * and there is a plan to accelerate to. Never on a paid plan — there is nothing to sell there.
 */
export const UPGRADE_WEEKLY_THRESHOLD = 5;
export function showsUpgrade(status: ProposalAllowanceStatus): boolean {
	if (!status.upgrade) return false;
	return status.weeklyRemaining <= UPGRADE_WEEKLY_THRESHOLD || status.bufferUnits === 0;
}
// #endregion

// #region Dev simulation
/**
 * The status a Dev Context Switcher position stands for (`proposalAllowance`), or the real one for
 * `auto`. Built on the real status when there is one, so the plan, the rung and the subject stay the
 * viewer's own; only the METERED facts move. `anchor` is when the position was chosen — countdowns run
 * from it, so a simulated refill ticks down like a real one.
 */
export function simulateAllowance(
	position: DevProposalAllowance,
	real: ProposalAllowanceStatus | null,
	anchor: number,
): ProposalAllowanceStatus | null {
	if (position === "auto") return real;
	const base: ProposalAllowanceStatus = real ?? {
		subjectType: "user",
		subjectId: "00000000-0000-0000-0000-000000000000",
		weeklyGranted: 50,
		weeklyConsumed: 0,
		weeklyRemaining: 50,
		weeklyResetsAt: new Date(anchor + 4 * 86_400_000).toISOString(),
		bufferUnits: 12,
		bufferCap: 12,
		bufferDrip: 3,
		bufferWindowHours: 10,
		nextBufferRefillAt: null,
		canApply: true,
		enforced: false,
		planCode: "individual_free",
		planLabel: "Free",
		planTier: "free",
		upgrade: { planLabel: "Individual Pro", weeklyUnits: 150 },
		standingLevel: 1,
		standingBonus: 0,
		teamMemberCount: null,
		canBindSeat: null,
		serverNow: new Date(anchor).toISOString(),
	};
	const at = (ms: number) => new Date(anchor + ms).toISOString();
	const granted = base.weeklyGranted;
	const cap = base.bufferCap || 12;
	const common = { ...base, serverNow: at(0), bufferCap: cap, blockReason: undefined };
	const spent = (left: number) => ({
		weeklyConsumed: Math.max(0, granted - left),
		weeklyRemaining: Math.min(granted, left),
	});
	switch (position) {
		case "healthy":
			return {
				...common,
				...spent(Math.max(0, granted - 12)),
				bufferUnits: cap,
				nextBufferRefillAt: null,
				canApply: true,
			};
		case "low":
			return {
				...common,
				...spent(Math.min(4, granted)),
				bufferUnits: Math.min(2, cap),
				nextBufferRefillAt: at((2 * 60 + 45) * 60_000),
				canApply: true,
			};
		case "paced":
		case "paced_soft": {
			const enforced = position === "paced";
			return {
				...common,
				...spent(Math.max(0, granted - 9)),
				bufferUnits: 0,
				nextBufferRefillAt: at(((4 * 60 + 12) * 60 + 30) * 1000),
				enforced,
				canApply: !enforced,
				blockReason: "buffer_exhausted",
			};
		}
		case "weekly":
			return {
				...common,
				...spent(0),
				bufferUnits: Math.min(7, cap),
				nextBufferRefillAt: at(6 * 3_600_000),
				enforced: true,
				canApply: false,
				blockReason: "weekly_exhausted",
			};
		case "team_small":
			return {
				...common,
				subjectType: "team",
				teamMemberCount: TEAM_PROPOSAL_MIN_MEMBERS - 1,
				canBindSeat: true,
				canApply: false,
				blockReason: "team_too_small",
			};
	}
}
// #endregion
