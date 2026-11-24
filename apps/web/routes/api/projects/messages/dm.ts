import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	BringDmIntoProjectInputSchema,
	TakeDmOutOfProjectInputSchema,
} from "@projective/types/messaging";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `/api/projects/messages/dm` — thin route: a one-to-one conversation's place in a project's Private
 * Messages group (PROJECTS CH3, Decision #560; the owner's ruling on stop 23).
 *
 * - `POST { projectId, handle }` opens the viewer's conversation with that project member inside the
 *   project, bringing it in first when it is not there (the other person is told once). Answers
 *   `{ ref, moved }`; the roster's Message action then opens `/projects/:projectId/:ref`.
 * - `DELETE { projectId, conversationId }` takes it out of the project for both people; its messages
 *   and their project stamps stay. Answers `{ moved }`.
 *
 * Both are the person's own act on a click, behind the `/api` origin guard (`utils/csrf.ts`);
 * delegated to the fat {@link MessagingBackendService.bringDmIntoProject} and
 * {@link MessagingBackendService.takeDmOutOfProject}, whose doors decide who may.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to message project members." }, {
				status: 401,
			});
		}
		const parsed = BringDmIntoProjectInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "No such project or person." }, { status: 422 });
		}
		return toProjectsResponse(await MessagingBackendService.bringDmIntoProject(parsed.data, actor));
	},

	async DELETE(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to change project conversations." }, {
				status: 401,
			});
		}
		const parsed = TakeDmOutOfProjectInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "No such conversation in this project." }, {
				status: 422,
			});
		}
		return toProjectsResponse(await MessagingBackendService.takeDmOutOfProject(parsed.data, actor));
	},
});
