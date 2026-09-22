import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RemoveMemberInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/members/remove` — thin route: Zod-validate a client's removal of an active
 * participant (from the whole project, or from ONE stage when `stageId` is set) and delegate to the
 * fat {@link ProjectBackendService.removeMember}.
 *
 * This is a money-adjacent write. On the live path `projects.remove_project_member` applies
 * `PRODUCT_SPEC.md` §Freelancer Removal Mid-Ticket — the escrow held for every ticket the person holds
 * in scope is released to them and the tickets return to New — so this route is deliberately the only
 * door to it, and the RPC's own ownership check is the gate.
 *
 * **No capability guard**, for the reason every projects write states: the Dev Context Switcher's
 * persona is a client seam the server never sees (Decision #53(b)). The 401 below only establishes
 * an identity to attribute the removal to.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to manage members." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = RemoveMemberInputSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.removeMember(parsed.data, actor));
	},
});
