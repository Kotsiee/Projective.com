import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteActionInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/invites` — thin route: Zod-validate a client's act on one invitation they
 * sent (`cancel` an open offer · `dismiss` an answered or lapsed record) and delegate to the fat
 * {@link ProjectBackendService.inviteAction}, which re-checks that the row's state admits the act
 * (`inviteActionFor`) before it writes.
 *
 * **No capability guard.** The Dev Context Switcher's persona is a client seam the server never sees,
 * so a server-side role bounce would fire on a simulated persona (Decision #53(b)). RLS is the real
 * gate: on the live path the UPDATE runs under the caller's own `Owner manages invitations` policy
 * and affects zero rows for anyone else, which the service reports as a refusal.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to manage invitations." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = InviteActionInputSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.inviteAction(parsed.data, actor));
	},
});
