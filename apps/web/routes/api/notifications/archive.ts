import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { NotificationIdsSchema } from "@projective/types/comms";
import { NotificationInboxBackendService } from "@server/services/comms/NotificationInboxBackendService.ts";

/**
 * `POST /api/notifications/archive` `{ ids }` — thin route: dismiss the caller's own notifications
 * (`comms.archive_notifications`). Nothing is hard-deleted. Answers `{ updated }`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = NotificationIdsSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidBody("ids", "Send between 1 and 500 notification ids.");
		return serviceResponse(
			await NotificationInboxBackendService.archive(parsed.data.ids, readActor(ctx)),
		);
	},
});
