import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { EmailsBackendService, isEmailId } from "@server/services/user/EmailsBackendService.ts";
import { emailRefusal } from "@server/services/user/emails-refusals.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `DELETE /api/user/emails/:id` — remove one of the acting person's secondary addresses →
 * `{ ok, message, emails }`. The primary (`409 email_is_primary`) and the sign-in address
 * (`409 email_is_sign_in`) cannot be removed; an id that is not the caller's is `404 email_not_found`,
 * exactly like one that does not exist.
 *
 * Thin: validate the path id as a uuid, resolve the actor from the session, delegate to the fat
 * {@link EmailsBackendService}. The static `/api/user/emails/verify` route takes precedence over this
 * wildcard.
 */

/** Map a {@link ServiceResult} to the flat JSON envelope every thin route in this app returns. */
function respond<T>(result: ServiceResult<T>): Response {
	return Response.json(
		{
			ok: result.ok,
			message: result.message,
			errors: result.errors,
			details: result.details,
			...(result.data ?? {}),
		},
		{ status: result.status },
	);
}

export const handler = define.handlers({
	async DELETE(ctx) {
		if (!isEmailId(ctx.params.id)) return respond(emailRefusal("email_not_found"));
		return respond(await EmailsBackendService.remove(readActor(ctx), ctx.params.id));
	},
});
