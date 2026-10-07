import { define } from "@web/utils/state.ts";
import { ConfirmLinkSchema } from "@features/auth/core/schema.ts";
import { DEFAULT_REDIRECT } from "@features/auth/core/redirect.ts";
import { sessionSetCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

const FAILED = "/login?notice=confirm_failed";

function redirect(location: string, cookies: string[] = []): Response {
	const res = new Response(null, { status: 303, headers: { location } });
	for (const cookie of cookies) res.headers.append("set-cookie", cookie);
	return res;
}

/**
 * `GET /api/auth/confirm` — the confirmation email's button. Thin route: validate the `token_hash`,
 * let the fat {@link AuthBackendService} exchange it with GoTrue, then land the now-signed-in user
 * on `/home`. A malformed, expired or spent link lands on `/login` with a notice; signing in from
 * there routes an unconfirmed account back to `/verify` for a fresh code.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const parsed = ConfirmLinkSchema.safeParse({
			token_hash: ctx.url.searchParams.get("token_hash"),
			type: ctx.url.searchParams.get("type"),
		});
		if (!parsed.success) return redirect(FAILED);

		const result = await AuthBackendService.confirmEmailLink({
			tokenHash: parsed.data.token_hash,
			redirectTo: DEFAULT_REDIRECT,
		});
		if (!result.ok) return redirect(FAILED);

		return redirect(
			result.data?.redirectTo ?? DEFAULT_REDIRECT,
			result.session ? sessionSetCookies(result.session) : [],
		);
	},
});
