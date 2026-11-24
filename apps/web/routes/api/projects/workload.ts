import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectWorkloadService } from "@server/services/projects/ProjectWorkloadService.ts";

/**
 * `GET /api/projects/workload` — the caller's own Σ W_i against their global cap, for the Workload
 * Capacity Gauge (`WorkloadCapacity`).
 *
 * Thin by contract and takes no parameters: the subject is always the signed-in caller, so there is no
 * query a caller could use to read someone else's load. Delegates to the fat
 * {@link ProjectWorkloadService.mine}. `no-store`: a claim or a submission moves the figure.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const result = await ProjectWorkloadService.mine(readActor(ctx));
		return Response.json(toProjectsBody(result), {
			status: result.status,
			headers: { "Cache-Control": "no-store" },
		});
	},
});
