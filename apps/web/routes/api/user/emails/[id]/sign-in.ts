import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidFields, serviceBody, serviceResponse } from "@web/utils/service-response.ts";
import { respondWithReissuedSession } from "@web/utils/session.ts";
import { authSubject, noteAuthOutcome, refuseIfThrottled } from "@features/auth/core/throttle.ts";
import { MakeSignInSchema } from "@projective/types/org";
import { EmailsBackendService, isEmailId } from "@server/services/user/EmailsBackendService.ts";
import { emailRefusal } from "@server/services/user/emails-refusals.ts";

/**
 * `POST /api/user/emails/:id/sign-in` `{ password, captchaToken?, makePrimary? }` — sign in with one
 * of the acting person's CONFIRMED addresses from now on (Decision #451) →
 * `{ ok, message, emails, notice, otherSessionsEnded, claimsStale }`.
 *
 * Refusals carry their code in `details.refusal`: `password_incorrect` (422, `errors.password`),
 * `sign_in_unverified`, `sign_in_already`, `account_closing`, `password_required` and the generic
 * `sign_in_unavailable` (409), `sign_in_limit` (429, `details.retryAt`), `email_not_found` (404).
 *
 * Thin: validate the path id and the body, count the password attempt against the re-auth throttle
 * (IW-H3, per client and per account), delegate to the fat {@link EmailsBackendService}. The token
 * carries the email claim, so a success re-issues the session on the same response.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!isEmailId(ctx.params.id)) return serviceResponse(emailRefusal("email_not_found"));
		const parsed = MakeSignInSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidFields(parsed.error.issues);

		const actor = readActor(ctx);
		const subject = authSubject(ctx.req, ctx.info.remoteAddr, actor.userId || undefined);
		const refused = refuseIfThrottled(ctx.req, "reauth", subject);
		if (refused) return refused;

		const result = await EmailsBackendService.makeSignIn(actor, ctx.params.id, parsed.data);
		noteAuthOutcome("reauth", subject, result);
		if (!result.ok) return serviceResponse(result);
		return respondWithReissuedSession(ctx.req, serviceBody(result), result.status);
	},
});
