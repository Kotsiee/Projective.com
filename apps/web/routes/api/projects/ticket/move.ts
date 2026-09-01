import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { MoveTicketSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/ticket/move` — thin route: Zod-validate a resolved board drag and delegate to
 * the fat {@link ProjectBackendService}, which returns the card in its committed position.
 *
 * The client sends the RESOLVED destination — the target `ticket_status` and the stage it lands in —
 * never a column id: the column vocabulary is a rendering decision (one card appears in three
 * different lanes depending on the view), and the server must not have to reverse-engineer a
 * lifecycle transition out of one.
 *
 * That transition is a money-moving write. A ticket entering a completed state releases escrow
 * through `trg_ticket_escrow_sync`, so this route is deliberately the only way a client can ask for
 * one, and the fat service is the only thing that decides whether the ask is honoured.
 *
 * **No capability guard.** A server-side owner/`isFreelancer` bounce is forbidden — the Dev Context
 * Switcher's persona is a client seam the server never sees, so the gate would fire on a simulated
 * persona. RLS is the real gate (Decision #53(b)); the 401 below only establishes an identity to
 * attribute the move to.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to move a ticket." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = MoveTicketSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.moveTicket(parsed.data, actor));
	},
});
