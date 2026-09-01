import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CommitTicketSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/board/ticket` — thin route: Zod-validate one ticket commit (create or edit)
 * and delegate to the fat {@link ProjectBackendService}, which returns the card as the SERVER sees
 * it.
 *
 * The payload carries the client's optimistic `clientId` so the board can reconcile the row it
 * already spliced in rather than appending a duplicate beside it; the returned card carries the real
 * id, which is the only id anything downstream may address the ticket by.
 *
 * **No capability guard.** A server-side owner/`isFreelancer` bounce is forbidden — the Dev Context
 * Switcher's persona is a client seam the server never sees, so the gate would fire on a simulated
 * persona. RLS is the real gate (Decision #53(b)). The 401 below is an identity check, not a
 * capability one: a ticket has to be attributable to somebody.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to save a ticket." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CommitTicketSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.commitTicket(parsed.data, actor));
	},
});
