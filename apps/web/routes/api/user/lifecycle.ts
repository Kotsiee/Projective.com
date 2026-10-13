import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceBody, serviceResponse } from "@web/utils/service-response.ts";
import { respondWithReissuedSession } from "@web/utils/session.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { DeletionScope, ScheduleDeletionSchema } from "@projective/types/org";
import { AccountLifecycleBackendService } from "@server/services/user/AccountLifecycleBackendService.ts";

/**
 * `/api/user/lifecycle` — giving up the freelancer profile and deleting the account.
 *
 * - `GET` → `{ ok, lifecycle }`: the persona, anything scheduled, and what blocks scheduling.
 * - `POST { scope, confirmation }` → schedules the removal (`confirmation` must be the typed phrase,
 *   checked again by the definer) → `{ ok, message, lifecycle }`; a blocked one is a 409 with
 *   `details.blockers`.
 * - `DELETE ?scope=` → cancels inside the window, restoring what was paused.
 *
 * A freelancer-profile change flips `isFreelancer` on the token, so a successful one re-issues the
 * session on the same response (`claimsStale: true` when it could not; Decision #193). Account
 * deletion changes no claim and leaves the session alone.
 */
function answer<T extends object>(
	req: Request,
	scope: DeletionScope,
	result: ServiceResult<T>,
): Response | Promise<Response> {
	if (!result.ok || scope !== "freelancer_profile") return serviceResponse(result);
	return respondWithReissuedSession(req, serviceBody(result), result.status);
}

export const handler = define.handlers({
	async GET(ctx) {
		return serviceResponse(await AccountLifecycleBackendService.lifecycle(readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = ScheduleDeletionSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidBody("confirmation", "Type CONFIRM to confirm.");
		return answer(
			ctx.req,
			parsed.data.scope,
			await AccountLifecycleBackendService.schedule(readActor(ctx), parsed.data),
		);
	},

	async DELETE(ctx) {
		const scope = DeletionScope.safeParse(ctx.url.searchParams.get("scope"));
		if (!scope.success) return invalidBody("scope", "Choose what to cancel.");
		return answer(
			ctx.req,
			scope.data,
			await AccountLifecycleBackendService.cancel(readActor(ctx), scope.data),
		);
	},
});
