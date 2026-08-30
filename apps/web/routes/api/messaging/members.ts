import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { MemberRosterPage } from "@projective/types/projects";

/**
 * `/api/messaging/members` — the thin route for the conversation-scoped Members roster read. HTTP parse
 * + guard, then delegate to the fat {@link MessagingBackendService.members}.
 *
 * It answers the SAME `MemberRosterPage` contract as `/api/projects/members`, so the shared
 * `MemberRoster` island simply swaps its endpoint on `scope="conversation"` — one component, two data
 * sources.
 *
 * `GET`, `HEAD` and `OPTIONS` all come from {@link defineReadRoute}, which resolves the payload ONCE
 * and derives the responses from it — so `HEAD` cannot drift from `GET`, and the `ETag` /
 * `If-None-Match` revalidation is identical on both. The missing-param guard answers from inside the
 * resolver, so `HEAD` reports the same `400` with the body stripped rather than leaking one.
 */
export const handler = define.handlers(
	defineReadRoute<{ page: MemberRosterPage }>({
		resolve: (ctx) => {
			const sp = ctx.url.searchParams;
			const conversationId = sp.get("conversationId") ?? sp.get("projectId");
			if (!conversationId) {
				return Response.json({ ok: false, message: "Missing conversationId." }, { status: 400 });
			}
			return MessagingBackendService.members(conversationId, readActor(ctx));
		},
		toBody: toMessagingBody,
	}),
);
