import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { NotificationListParamsSchema } from "@projective/types/comms";
import { NotificationInboxBackendService } from "@server/services/comms/NotificationInboxBackendService.ts";

/**
 * `GET /api/notifications?category=&contextType=&contextId=&unreadOnly=true&archived=true&before=&limit=` — thin
 * route: one page of the caller's in-app inbox plus the badge summary
 * ({@link NotificationInboxBackendService.list}). The actor comes from the session; the service
 * answers 401 for a guest.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const q = ctx.url.searchParams;
		const parsed = NotificationListParamsSchema.safeParse({
			category: q.get("category") ?? undefined,
			contextType: q.get("contextType") ?? undefined,
			contextId: q.get("contextId") ?? undefined,
			unreadOnly: q.has("unreadOnly") ? q.get("unreadOnly") === "true" : undefined,
			archived: q.has("archived") ? q.get("archived") === "true" : undefined,
			before: q.get("before") ?? undefined,
			limit: q.has("limit") ? Number(q.get("limit")) : undefined,
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return invalidBody(
				issue?.path.map(String).join(".") || "query",
				issue?.message ?? "Invalid query.",
			);
		}
		return serviceResponse(await NotificationInboxBackendService.list(parsed.data, readActor(ctx)));
	},
});
