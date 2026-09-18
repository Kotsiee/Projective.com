import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { AddConversationMembersSchema } from "@projective/types/messaging";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/messaging/conversations/members` — thin route: add people to a conversation the
 * caller is in. Zod-validate one {@link AddConversationMembersSchema} payload and delegate to the fat
 * {@link MessagingBackendService.addMembers}, which converts a DM into a group the moment a third
 * person joins it and answers with the conversation's (possibly changed) kind.
 *
 * **No capability guard.** Membership is checked inside `comms.add_dm_thread_members` (definer):
 * only an undeleted participant of the thread may add to it. The 401 is an identity check.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to add people to a conversation." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = AddConversationMembersSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Pick at least one contact.", errors },
				{ status: 422 },
			);
		}

		return toMessagingResponse(await MessagingBackendService.addMembers(parsed.data, actor));
	},
});
