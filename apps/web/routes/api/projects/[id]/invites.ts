import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteProjectMemberInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET | POST /api/projects/:id/invites` — the project's invitation queue, and the Members tab's
 * Invite modal. `:id` is the project slug.
 *
 * - `GET` → {@link ProjectBackendService.listInvites}: the roster read's own queue (`no-store` — it
 *   changes with every send and answer, and the roster read is the cached one).
 * - `POST` → {@link ProjectBackendService.inviteMember}: each `@handle` or email is one invitation;
 *   the service enforces the outbound ceiling (429) and the database the 48-day cooldown and the
 *   owner-only rule (403). Answers `201` with what was issued and what was refused.
 *
 * The client's acts on an EXISTING invitation stay at `POST /api/projects/invites` (cancel · dismiss).
 * No capability guard (Decision #53(b)); the 401 only establishes an identity.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to see invitations." }, { status: 401 });
		}
		const res = toProjectsResponse(await ProjectBackendService.listInvites(ctx.params.id, actor));
		res.headers.set("Cache-Control", "no-store");
		return res;
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to invite someone to a project." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = InviteProjectMemberInputSchema.safeParse(raw);
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

		return toProjectsResponse(
			await ProjectBackendService.inviteMember(ctx.params.id, parsed.data, actor),
		);
	},
});
