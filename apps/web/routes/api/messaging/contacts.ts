import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { MessagingRole } from "@projective/types/messaging";

/**
 * `GET /api/messaging/contacts?role=…&q=…` — thin route: the pickable contacts for the New Conversation
 * / Add Members picker (task §2B), delegated to the fat {@link MessagingBackendService}. `q` narrows by
 * name/handle; `role` is informational (the acting view).
 */
export const handler = define.handlers({
	GET(ctx) {
		const role = ctx.url.searchParams.get("role");
		const q = ctx.url.searchParams.get("q");
		return toMessagingResponse(
			MessagingBackendService.contacts(role ? (role as MessagingRole) : undefined, q ?? undefined),
		);
	},
});
