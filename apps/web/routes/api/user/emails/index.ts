import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { AddUserEmailSchema } from "@projective/types/org";
import { EmailsBackendService } from "@server/services/user/EmailsBackendService.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `GET` / `POST /api/user/emails` — the acting person's email addresses.
 *
 * - `GET` → `{ ok, emails: UserEmail[] }`, primary first.
 * - `POST { email }` → files the address UNVERIFIED and mails its confirmation link →
 *   `201 { ok, message, emails, delivery }` (`delivery`: `sent` · `logged` · `unavailable`, so the UI
 *   never claims a mail went out when it did not). `422` on a body that is not one address.
 *
 * Thin by contract: resolve the actor from the SESSION (never the body), Zod-validate, delegate to the
 * fat {@link EmailsBackendService}, map the result. Self-authorising like the other `/api/user/*`
 * routes: a guest gets the service's 401, which the client's interceptor routes through a silent
 * refresh + retry. Refusals carry their code in `details.refusal` (the `EmailRefusal` vocabulary).
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
	async GET(ctx) {
		return respond(await EmailsBackendService.list(readActor(ctx)));
	},

	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = AddUserEmailSchema.safeParse(raw);
		if (!parsed.success) {
			// One field, one sentence: Zod's own wording ("Too big", "Unrecognized key") is not copy.
			const message = "Enter an email address like name@example.com.";
			return Response.json({ ok: false, message, errors: { email: message } }, { status: 422 });
		}
		return respond(await EmailsBackendService.add(readActor(ctx), parsed.data));
	},
});
