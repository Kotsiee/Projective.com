import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { MarkAllReadSchema } from "@projective/types/comms";
import { NotificationInboxBackendService } from "@server/services/comms/NotificationInboxBackendService.ts";

/**
 * `POST /api/notifications/read-all` `{ category? }` — thin route: mark every live notification read,
 * or only one category's (`comms.mark_all_notifications_read`). An empty body clears everything.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = MarkAllReadSchema.safeParse(await ctx.req.json().catch(() => ({})));
		if (!parsed.success) return invalidBody("category", "That is not a notification category.");
		return serviceResponse(
			await NotificationInboxBackendService.markAllRead(parsed.data.category, readActor(ctx)),
		);
	},
});
