import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { NotificationIdsSchema } from "@projective/types/comms";
import { NotificationInboxBackendService } from "@server/services/comms/NotificationInboxBackendService.ts";

/**
 * `POST /api/notifications/read` `{ ids }` — thin route: mark the caller's own notifications read
 * (`comms.mark_notifications_read`). Answers `{ updated }`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = NotificationIdsSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidBody("ids", "Send between 1 and 500 notification ids.");
		return serviceResponse(
			await NotificationInboxBackendService.markRead(parsed.data.ids, readActor(ctx)),
		);
	},
});
