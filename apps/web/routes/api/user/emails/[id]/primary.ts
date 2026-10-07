import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { EmailsBackendService, isEmailId } from "@server/services/user/EmailsBackendService.ts";
import { emailRefusal } from "@server/services/user/emails-refusals.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `POST /api/user/emails/:id/primary` — make one of the acting person's CONFIRMED addresses their
 * primary (the contact address the platform writes to) → `{ ok, message, emails }`. An unconfirmed
 * address is `409 email_unverified`; an id that is not the caller's is `404 email_not_found`.
 *
 * Thin: validate the path id as a uuid, resolve the actor from the session, delegate to the fat
 * {@link EmailsBackendService}. No body.
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
	async POST(ctx) {
		if (!isEmailId(ctx.params.id)) return respond(emailRefusal("email_not_found"));
		return respond(await EmailsBackendService.setPrimary(readActor(ctx), ctx.params.id));
	},
});
