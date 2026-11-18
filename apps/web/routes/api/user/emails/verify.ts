import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ConfirmUserEmailSchema, EMAIL_TOKEN_PARAM } from "@projective/types/org";
import { EmailsBackendService } from "@server/services/user/EmailsBackendService.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `GET | POST /api/user/emails/verify` — the link in a confirmation email, and the press that spends it.
 *
 * A GET spends nothing (PRD-C11, the #445 rule for mailed links). A link scanner, a prefetch or a
 * cross-site navigation carrying the `SameSite=Lax` session cookie can open the link as well as the
 * person can, so the GET only shape-checks the token and forwards it to
 * `/settings/account?email-token=…#emails`. The dashboard guard signs a visitor in first and brings
 * them back with the query intact, and the Email addresses block asks them to press Confirm. A
 * malformed token lands on `?email=invalid` without the page.
 *
 * The press is `POST { token }` (JSON, so the `/api` origin guard refuses it from another site), which
 * redeems the token for the SIGNED-IN account through {@link EmailsBackendService.confirm} and answers
 * `{ ok, message, outcome }`, the outcome being one of `EmailVerifyOutcome` (`verified` · `expired` ·
 * `invalid` · `used` · `wrong-account` · `in-use`). A token the account cannot redeem is an outcome, not
 * a failure; a lapsed session is a 401 the client refreshes through, and an outage a 503.
 */

/** Where the link lands. */
const SETTINGS = "/settings/account";

/** A 303 to `location`; never cached, and no referrer, because the URL holds a credential. */
function seeOther(location: string): Response {
	return new Response(null, {
		status: 303,
		headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
	});
}

/** Map a {@link ServiceResult} to the flat JSON envelope the `/api/user/emails` routes return. */
function respond<T>(result: ServiceResult<T>): Response {
	return Response.json(
		{ ok: result.ok, message: result.message, errors: result.errors, ...(result.data ?? {}) },
		{ status: result.status, headers: { "cache-control": "no-store" } },
	);
}

export const handler = define.handlers({
	GET(ctx) {
		const parsed = ConfirmUserEmailSchema.safeParse({
			token: ctx.url.searchParams.get("token") ?? "",
		});
		if (!parsed.success) return seeOther(`${SETTINGS}?email=invalid#emails`);
		const qs = new URLSearchParams({ [EMAIL_TOKEN_PARAM]: parsed.data.token });
		return seeOther(`${SETTINGS}?${qs.toString()}#emails`);
	},

	async POST(ctx) {
		const parsed = ConfirmUserEmailSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That link isn't valid.", errors: { token: "invalid" } },
				{ status: 422, headers: { "cache-control": "no-store" } },
			);
		}
		return respond(await EmailsBackendService.confirm(readActor(ctx), parsed.data.token));
	},
});
