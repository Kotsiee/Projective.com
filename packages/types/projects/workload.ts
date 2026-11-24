import { z } from "zod";

/**
 * projects.workload — a freelancer's own workload against their caps: the Workload Capacity Gauge
 * (PRODUCT_SPEC §Resource Allocation & Ticketing, 3. Concurrency Limits).
 *
 * The figures come from `projects.get_my_workload_capacity()`, which takes no argument and answers only
 * about `auth.uid()`; the two-argument `projects.get_workload_capacity` it wraps stays ungranted. The
 * cap itself is enforced by `projects.check_ticket_capacity` on every claim and assignment: the rules
 * below only decide what to SAY before a click, in that function's own words, and never permit a
 * claim the door would refuse.
 */

// #region Row
/** `projects.get_my_workload_capacity()`'s jsonb, key for key (`NULL` signed out). */
export const WorkloadCapacityRowSchema = z.object({
	user_id: z.string().uuid(),
	/** Σ W_i over the tickets held: claimed · in_progress · in_review · reported_hidden. */
	current: z.number().min(0),
	/** `org.freelancer_profiles.max_workload_intensity`, else `global_workload_cap_default`. */
	cap: z.number().min(0),
	ratio: z.number().min(0).nullable(),
	ticket_count: z.number().int().min(0),
	/** Always `null` here: the self-reader passes no project. */
	project_current: z.number().min(0).nullable(),
	/** The caller's held W_i in each stage they hold work in (stage uuid = the board's stage id). */
	stages: z.array(z.object({ stage_id: z.string().uuid(), current: z.number().min(0) })).max(500),
});
export type WorkloadCapacityRow = z.infer<typeof WorkloadCapacityRowSchema>;
// #endregion

// #region DTO
/** What `GET /api/projects/workload` answers: the caller's own load, never anyone else's. */
export const WorkloadCapacitySchema = z.object({
	/** Σ W_i over the tickets the caller holds. */
	current: z.number().min(0),
	/** The caller's global cap. */
	cap: z.number().min(0),
	/** How many held tickets make up {@link current}. */
	ticketCount: z.number().int().min(0),
	/** The caller's held W_i per stage, for the stage's hard cap (`max_concurrent_intensity`). */
	stages: z.array(z.object({ stageId: z.string().max(80), current: z.number().min(0) })).max(500),
});
export type WorkloadCapacity = z.infer<typeof WorkloadCapacitySchema>;

/** The row as the DTO: the user id stays server-side; the caller already knows who they are. */
export function toWorkloadCapacity(row: WorkloadCapacityRow): WorkloadCapacity {
	return {
		current: row.current,
		cap: row.cap,
		ticketCount: row.ticket_count,
		stages: row.stages.map((s) => ({ stageId: s.stage_id, current: s.current })),
	};
}

/** The caller's held W_i in one stage; `0` where they hold nothing there. */
export function stageLoadOf(capacity: Pick<WorkloadCapacity, "stages">, stageId: string): number {
	return capacity.stages.find((s) => s.stageId === stageId)?.current ?? 0;
}
// #endregion

// #region Rules
/** The W_i of one standard-weight ticket ("a cap of 2.0 == max two standard-weight tickets"). */
export const STANDARD_TICKET_WI = 1;

/** Where the load sits against the cap: room, under one standard ticket of room, or none. */
export type WorkloadLevel = "normal" | "near" | "at";

/**
 * `at` once the load has reached the cap (nothing more can be claimed); `near` while less than one
 * standard ticket of room is left; `normal` otherwise.
 */
export function workloadLevel(capacity: Pick<WorkloadCapacity, "current" | "cap">): WorkloadLevel {
	const room = capacity.cap - capacity.current;
	if (room <= 0) return "at";
	return room < STANDARD_TICKET_WI ? "near" : "normal";
}

/**
 * A W_i figure as `trim_scale(numeric(6,2))` prints it: two decimals at most, trailing zeros dropped
 * ("2", "2.5", "0.75").
 */
export function formatIntensity(value: number): string {
	return String(Math.round(Math.max(0, value) * 100) / 100);
}

/** The caller's load in one stage and that stage's cap (`NULL` = unlimited). */
export interface StageLoad {
	current: number;
	cap: number | null;
}

/** What claiming one ticket would do to the caller's load, and why it would be refused. */
export interface ClaimCapacityVerdict {
	allowed: boolean;
	scope: "global" | "stage" | null;
	/** `check_ticket_capacity`'s sentence for the refusal, word for word; `null` when allowed. */
	reason: string | null;
	ticketWi: number;
	globalProjected: number;
	globalCap: number;
}

/**
 * `projects.check_ticket_capacity`'s verdict for a ticket the caller does not hold yet, in its order
 * (the global cap first, then the stage's) and its sentences. A pure mirror for the copy beside Claim:
 * the door re-checks under a lock and its answer wins.
 */
export function claimCapacityVerdict(
	capacity: Pick<WorkloadCapacity, "current" | "cap">,
	ticketWi: number,
	stage?: StageLoad | null,
): ClaimCapacityVerdict {
	const globalProjected = capacity.current + ticketWi;
	const base = { ticketWi, globalProjected, globalCap: capacity.cap };
	if (globalProjected > capacity.cap) {
		return {
			...base,
			allowed: false,
			scope: "global",
			reason: globalCapReason(ticketWi, globalProjected, capacity.cap),
		};
	}
	if (stage && stage.cap !== null && stage.current + ticketWi > stage.cap) {
		return {
			...base,
			allowed: false,
			scope: "stage",
			reason: stageCapReason(ticketWi, stage.current + ticketWi, stage.cap),
		};
	}
	return { ...base, allowed: true, scope: null, reason: null };
}

/** `check_ticket_capacity`'s global refusal. */
export function globalCapReason(ticketWi: number, projected: number, cap: number): string {
	return `Claiming this ticket (intensity ${
		formatIntensity(ticketWi)
	}) would put your global workload at ${formatIntensity(projected)}, over your cap of ${
		formatIntensity(cap)
	}. Submit current work before taking on more.`;
}

/** `check_ticket_capacity`'s stage refusal. */
export function stageCapReason(ticketWi: number, projected: number, cap: number): string {
	return `Claiming this ticket (intensity ${
		formatIntensity(ticketWi)
	}) would put your workload in this stage at ${
		formatIntensity(projected)
	}, over the stage cap of ${formatIntensity(cap)}.`;
}
// #endregion
