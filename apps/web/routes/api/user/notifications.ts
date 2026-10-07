import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { NotificationCenterUpdateSchema } from "@projective/types/comms";
import { NotificationCenterBackendService } from "@server/services/user/NotificationCenterBackendService.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `GET` / `PUT /api/user/notifications` — the settings console's notification centre: the acting
 * person's channel masters, quiet hours, snooze, per-category routing matrix, and the catalog's
 * required-alerts summary.
 *
 * Thin by contract: resolve the actor from the SESSION (never the body), Zod-validate the save, and
 * delegate to the fat {@link NotificationCenterBackendService}. No column mapping, precedence rule or
 * write ordering lives here.
 *
 * `PUT` carries a genuine partial (`NotificationCenterUpdateSchema`): only the prefs, categories and
 * channels it names are written. Not behind a capability gate — every signed-in person routes their
 * own notifications. Self-authorising like the other `/api/user/*` routes: a guest gets the service's
 * 401, which the client's interceptor routes through a silent refresh + retry.
 */

// #region Response
/** Map a {@link ServiceResult} to the flat JSON envelope every thin route in this app returns. */
function respond<T>(result: ServiceResult<T>): Response {
	return Response.json(
		{ ok: result.ok, message: result.message, errors: result.errors, ...(result.data ?? {}) },
		{ status: result.status },
	);
}
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		return respond(await NotificationCenterBackendService.center(readActor(ctx)));
	},

	async PUT(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = NotificationCenterUpdateSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const path = issue.path.join(".") || "notifications";
				errors[path] ??= issue.message;
			}
			return Response.json(
				{
					ok: false,
					message: parsed.error.issues[0]?.message ??
						"Those notification settings could not be saved.",
					errors,
				},
				{ status: 422 },
			);
		}
		return respond(
			await NotificationCenterBackendService.updateCenter(readActor(ctx), parsed.data),
		);
	},
});
