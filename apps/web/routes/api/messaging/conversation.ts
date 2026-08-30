import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { ConversationDetail } from "@projective/types/messaging";

/**
 * `GET | HEAD | OPTIONS /api/messaging/conversation?id=…` — thin route: guard the required
 * conversation id, then delegate to the fat {@link MessagingBackendService} for the
 * single-conversation metadata (the conversation view header + Members tab). A 404 maps to a
 * missing/inaccessible conversation.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`id` guard returns its 400 from inside `resolve` rather than from
 * a hand-written `GET`, so that refusal is stated once and `HEAD` reports the same status with the
 * body stripped by the factory. See that module for the caching and CORS decisions.
 */
export const handler = define.handlers(
	defineReadRoute<{ detail: ConversationDetail }>({
		resolve: (ctx) => {
			const id = ctx.url.searchParams.get("id");
			if (!id) {
				return Response.json({ ok: false, message: "Missing conversation id." }, { status: 400 });
			}
			return MessagingBackendService.conversation(id, readActor(ctx));
		},
		toBody: toMessagingBody,
	}),
);
