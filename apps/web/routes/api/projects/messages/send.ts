import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SendProjectMessageSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/messages/send` — thin route: Zod-validate one composer payload and delegate to
 * the fat {@link ProjectBackendService}, which returns the persisted message.
 *
 * **No bytes pass through here.** Attachments arrive as `files.items` ids, already uploaded through
 * the files handshake (`/api/files/upload-init` → a direct PUT at the signed URL →
 * `/api/files/upload-complete`), which is the reason that handshake exists: a 500 MB attachment
 * streamed through a Deno handler occupies a request worker for minutes and buys nothing. A
 * library-picked attachment and a just-uploaded one are therefore the same thing on this wire, which
 * is what keeps the picker and the drop zone on one code path.
 *
 * **No capability guard.** Channel membership is enforced by RLS on `comms.project_messages`, whose
 * INSERT policy also pins `sender_user_id` to the acting identity — so a member cannot post as
 * another member even with a hand-rolled request. A route-level bounce would add nothing and would
 * fire on a simulated Dev Context persona (Decision #53(b)). The 401 is an identity check: a message
 * with no author is not a message.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to send a message." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = SendProjectMessageSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.sendMessage(parsed.data, actor));
	},
});
