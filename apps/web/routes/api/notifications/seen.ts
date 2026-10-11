import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { NotificationInboxBackendService } from "@server/services/comms/NotificationInboxBackendService.ts";

/**
 * `POST /api/notifications/seen` — thin route: clear the badge without marking anything read
 * (`comms.mark_notifications_seen`), what opening the drawer does. Takes no body.
 */
export const handler = define.handlers({
	async POST(ctx) {
		return serviceResponse(await NotificationInboxBackendService.markSeen(readActor(ctx)));
	},
});
