import {
	type ClaimCapacityVerdict,
	claimCapacityVerdict,
	formatIntensity,
	stageLoadOf,
	STANDARD_TICKET_WI,
	type WorkloadCapacity,
	type WorkloadLevel,
	workloadLevel,
} from "@projective/types/projects";

/** A Dev Context Switcher `workload` position (mirrors `DevWorkload` in `@web/utils/dev-seam.ts`). */
export type WorkloadSimulation = "auto" | "normal" | "near" | "at";

/**
 * workload-copy — what the workload gauge and the line beside Claim say (PROJECTS ST4). Pure, so
 * `deno test` loads it, and shared by the `/projects` header gauge, the ticket view and the board.
 *
 * A refusal is `projects.check_ticket_capacity`'s own sentence ({@link claimCapacityVerdict}); every
 * other line is figures in W_i, the unit the caps are set in.
 */

// #region Gauge
/** The gauge's figures and words. */
export interface GaugeCopy {
	level: WorkloadLevel;
	/** The bar's fill, 0–100. */
	percent: number;
	/** "2 of 5". */
	figure: string;
	/** The line under the bar. */
	note: string;
	/** The bar's accessible name, both figures in words. */
	label: string;
}

/** `1 ticket` / `3 tickets`. */
function tickets(n: number): string {
	return `${n} ${n === 1 ? "ticket" : "tickets"}`;
}

/** The gauge for one load. */
export function gaugeCopy(
	capacity: Pick<WorkloadCapacity, "current" | "cap" | "ticketCount">,
): GaugeCopy {
	const level = workloadLevel(capacity);
	const percent = capacity.cap > 0
		? Math.min(100, Math.max(0, Math.round((100 * capacity.current) / capacity.cap)))
		: 100;
	const current = formatIntensity(capacity.current);
	const cap = formatIntensity(capacity.cap);
	const room = formatIntensity(Math.max(0, capacity.cap - capacity.current));
	const held = `${tickets(capacity.ticketCount)} held`;
	const note = level === "at"
		? `${held} · At your cap: submit current work before claiming more`
		: level === "near"
		? `${held} · ${room} left, less than one standard ticket`
		: `${held} · ${room} free`;
	return {
		level,
		percent,
		figure: `${current} of ${cap}`,
		note,
		label: `Workload: ${current} of your cap of ${cap}`,
	};
}
// #endregion

// #region Claim
/** The line beside Claim, and whether Claim would pass a cap. */
export interface ClaimCapacityLine {
	verdict: ClaimCapacityVerdict;
	/** "This ticket adds 1.5 · you'd be at 3.5 of 5", or the door's refusal. */
	text: string;
}

/**
 * The line beside Claim for a ticket of `ticketWi` on stage `stageId` with hard cap `stageCap`
 * (`null` = unlimited). `null` with no load read yet: say nothing rather than guess.
 */
export function claimCapacityLine(
	capacity: WorkloadCapacity | null,
	ticketWi: number,
	stageId: string | null,
	stageCap: number | null,
): ClaimCapacityLine | null {
	if (!capacity) return null;
	const stage = stageId ? { current: stageLoadOf(capacity, stageId), cap: stageCap } : null;
	const verdict = claimCapacityVerdict(capacity, ticketWi, stage);
	const text = verdict.reason ??
		`This ticket adds ${formatIntensity(ticketWi)} · you'd be at ${
			formatIntensity(verdict.globalProjected)
		} of ${formatIntensity(verdict.globalCap)}`;
	return { verdict, text };
}
// #endregion

// #region Dev simulation
/** The platform default cap (`global_workload_cap_default`), for a simulation with no real read. */
const DEFAULT_CAP = 10;

/**
 * The load a Dev Context Switcher position stands for, built on the real cap when there is one: `normal`
 * holds two fifths of the cap, `near` leaves half a standard ticket of room, `at` fills it. The stage
 * split is dropped, so only the global cap speaks while simulating.
 */
export function simulateWorkload(
	position: WorkloadSimulation,
	real: WorkloadCapacity | null,
): WorkloadCapacity | null {
	if (position === "auto") return real;
	const cap = real?.cap && real.cap > 0 ? real.cap : DEFAULT_CAP;
	const current = position === "at"
		? cap
		: position === "near"
		? cap - STANDARD_TICKET_WI / 2
		: Math.round(cap * 0.4 * 2) / 2;
	return { current, cap, ticketCount: Math.max(1, Math.ceil(current)), stages: [] };
}
// #endregion
