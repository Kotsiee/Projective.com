import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { DeletionScope, ScheduleDeletionSchema } from "@projective/types/org";
import { AccountLifecycleBackendService } from "@server/services/user/AccountLifecycleBackendService.ts";

/**
 * `/api/user/lifecycle` — giving up the freelancer profile and deleting the account.
 *
 * - `GET` → `{ ok, lifecycle }`: the persona, anything scheduled, and what blocks scheduling.
 * - `POST { scope, confirmation }` → schedules the removal (`confirmation` must be the typed phrase,
 *   checked again by the definer) → `{ ok, message, lifecycle }`; a blocked one is a 409 with
 *   `details.blockers`. The caller renews the session after a freelancer removal.
 * - `DELETE ?scope=` → cancels inside the window, restoring what was paused.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await AccountLifecycleBackendService.lifecycle(readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = ScheduleDeletionSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidBody("confirmation", "Type CONFIRM to confirm.");
		return serviceResponse(
			await AccountLifecycleBackendService.schedule(readActor(ctx), parsed.data),
		);
	},

	async DELETE(ctx) {
		const scope = DeletionScope.safeParse(ctx.url.searchParams.get("scope"));
		if (!scope.success) return invalidBody("scope", "Choose what to cancel.");
		return serviceResponse(await AccountLifecycleBackendService.cancel(readActor(ctx), scope.data));
	},
});
