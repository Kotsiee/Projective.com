import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { ContactList, MessagingRole } from "@projective/types/messaging";

/**
 * `GET | HEAD | OPTIONS /api/messaging/contacts?role=…&q=…` — thin route: the pickable contacts for the
 * New Conversation / Add Members picker (task §2B), delegated to the fat
 * {@link MessagingBackendService}. `q` narrows by name/handle; `role` is informational (the acting
 * view).
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag` / `If-None-Match` revalidation
 * is identical on both. See that module for the caching and CORS decisions.
 */
export const handler = define.handlers(
	defineReadRoute<{ contacts: ContactList }>({
		resolve: (ctx) => {
			const role = ctx.url.searchParams.get("role");
			const q = ctx.url.searchParams.get("q");
			return MessagingBackendService.contacts(
				role ? (role as MessagingRole) : undefined,
				q ?? undefined,
				readActor(ctx),
			);
		},
		toBody: toMessagingBody,
	}),
);
