import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { MessagePage } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/messaging/messages?conversationId=…&before=…&limit=…` — thin route:
 * guard the required conversation id + parse the optional scroll-up cursor, then delegate to the fat
 * {@link MessagingBackendService} for a bottom-anchored page of the conversation's messages (the
 * stream the ChatFeed virtualizes; unified with project channels by `chatId`). `before` is the
 * load-older cursor; omit it for the latest page.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`conversationId` guard returns its 400 from inside `resolve`
 * rather than from a hand-written `GET`, so that refusal is stated once and `HEAD` reports the same
 * status with the body stripped by the factory. See that module for the caching and CORS decisions.
 */
export const handler = define.handlers(
	defineReadRoute<{ page: MessagePage }>({
		resolve: (ctx) => {
			const conversationId = ctx.url.searchParams.get("conversationId");
			if (!conversationId) {
				return Response.json({ ok: false, message: "Missing conversationId." }, { status: 400 });
			}
			const before = ctx.url.searchParams.get("before");
			const limitRaw = ctx.url.searchParams.get("limit");
			const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
			return MessagingBackendService.messages({
				conversationId,
				before: before || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}, readActor(ctx));
		},
		toBody: toMessagingBody,
	}),
);
