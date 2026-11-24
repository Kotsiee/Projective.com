import { computed, signal } from "@preact/signals";
import { type WorkloadCapacity, WorkloadCapacitySchema } from "@projective/types/projects";
import { type DevWorkload, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { getProjects } from "./api.ts";
import { simulateWorkload } from "./workload-copy.ts";

/**
 * workload-state — the ONE client copy of the caller's own workload (PROJECTS ST4), shared by the
 * `/projects` header gauge, the ticket view's Claim line and the board card's Claim.
 *
 * They live in different islands, so they meet here, at module level (the `allowance-state` bridge).
 * A claim re-reads it once and every reader moves. The Dev Context Switcher's `workload` axis is
 * applied HERE, on the way out ({@link effectiveWorkload}), so no surface knows it is simulated.
 */

// #region Stores
/** The caller's load as last read; `null` until read, for a guest, or after a failed read. */
export const workloadCapacity = signal<WorkloadCapacity | null>(null);
// #endregion

// #region Dev simulation
const devPosition = signal<DevWorkload>("auto");
let devBound = false;

function bindDevSeam(): void {
	if (devBound || typeof document === "undefined") return;
	devBound = true;
	devPosition.value = readDevSeam()?.workload ?? "auto";
	subscribeDevSeam((state) => {
		devPosition.value = state?.workload ?? "auto";
	});
}

/**
 * The load to render: the store's read, else the route's `initial` (never written into the module
 * store, which the server shares across requests), with any simulated position applied. Reads
 * signals, so a component calling it re-renders when either moves.
 */
export function workloadWith(initial: WorkloadCapacity | null): WorkloadCapacity | null {
	bindDevSeam();
	return simulateWorkload(devPosition.value, workloadCapacity.value ?? initial);
}

/** The load every surface without a route read renders. */
export const effectiveWorkload = computed(() => workloadWith(null));
// #endregion

// #region Reads
let inflight: Promise<void> | null = null;

/** (Re)read the caller's load. Concurrent callers share one request; a failure clears the figure. */
export function refreshWorkload(): Promise<void> {
	if (inflight) return inflight;
	inflight = getProjects<unknown>("/api/projects/workload").then((res) => {
		const parsed = WorkloadCapacitySchema.safeParse(res.data);
		workloadCapacity.value = res.ok && parsed.success ? parsed.data : null;
	}).finally(() => {
		inflight = null;
	});
	return inflight;
}

let attempted = false;

/** Read the load once per page, the first time a surface needs it; a failed read is not retried. */
export function ensureWorkload(): void {
	if (attempted) return;
	attempted = true;
	void refreshWorkload();
}
// #endregion
