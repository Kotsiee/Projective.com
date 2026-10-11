import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `/api/messages/:id/pin` — pin (`POST`) or unpin (`DELETE`) a message for everyone in its room, a
 * conversation's or a project room's alike. Idempotent; answers `{ pinned }`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		return serviceResponse(await MessagingBackendService.setPinned(ctx.params.id, true, readActor(ctx)));
	},

	async DELETE(ctx) {
		return serviceResponse(await MessagingBackendService.setPinned(ctx.params.id, false, readActor(ctx)));
	},
});
