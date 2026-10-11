import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { NotificationInboxBackendService } from "@server/services/comms/NotificationInboxBackendService.ts";

/**
 * `GET /api/notifications/summary` — thin route: the shell badge (unread / unseen / total, unread per
 * category) from {@link NotificationInboxBackendService.summary}. No input to validate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await NotificationInboxBackendService.summary(readActor(ctx)));
	},
});
