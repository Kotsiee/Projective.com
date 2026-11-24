import {
	toWorkloadCapacity,
	type WorkloadCapacity,
	WorkloadCapacityRowSchema,
} from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { projectsDb } from "./live-support.ts";

/**
 * ProjectWorkloadService — the caller's own Σ W_i against their global cap, for the Workload Capacity
 * Gauge (PRODUCT_SPEC §Resource Allocation & Ticketing 3; PROJECTS ST4).
 *
 * Live: `projects.get_my_workload_capacity()` under the caller's JWT. It takes no argument, so there is
 * nothing here, or in the route, that could name another user. Stub: {@link STUB_WORKLOAD}, since the
 * fixtures hold no claimed tickets for a signed-in stub user.
 *
 * Never cached: a claim or a submission moves the figure, and the gauge must show it on the next read.
 */

// #region Stub
/** The stub path's load: two standard tickets held against the platform default cap. */
export const STUB_WORKLOAD: WorkloadCapacity = { current: 2, cap: 10, ticketCount: 2, stages: [] };
// #endregion

// #region Live
/** The caller's load, or `null` when the database saw no signed-in caller. THROWS on a failed read. */
async function fetchMyWorkload(
	actor: ReadActor & { accessToken: string },
): Promise<WorkloadCapacity | null> {
	const { data, error } = await projectsDb(actor).rpc("get_my_workload_capacity");
	if (error) throw new Error(`projects.get_my_workload_capacity failed: ${error.message}`);
	if (data === null || data === undefined) return null;
	const parsed = WorkloadCapacityRowSchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(
			`projects.get_my_workload_capacity returned an unexpected shape: ${parsed.error.message}`,
		);
	}
	return toWorkloadCapacity(parsed.data);
}
// #endregion

export class ProjectWorkloadService {
	/** The caller's own workload — `GET /api/projects/workload`. */
	static async mine(actor: ReadActor): Promise<ServiceResult<WorkloadCapacity>> {
		if (actor.userId.length === 0) return fail(401, { message: "Sign in to see your workload." });
		if (!isProjectsBackendLive()) return ok(STUB_WORKLOAD);
		if (!canReadLive(actor)) {
			return fail(401, { message: "Your session has expired — sign in again." });
		}
		try {
			const capacity = await fetchMyWorkload(actor);
			if (!capacity) return fail(401, { message: "Sign in to see your workload." });
			return ok(capacity);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn(`[ProjectWorkloadService.mine] live read failed: ${reason}`);
			return fail(502, { message: "Your workload couldn't be read just now." });
		}
	}
}
