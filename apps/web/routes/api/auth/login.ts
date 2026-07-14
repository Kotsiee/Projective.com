import { define } from "@web/utils/state.ts";
import { fieldErrors, LoginSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/login` — thin route: validate credentials, then delegate to the fat
 * {@link AuthBackendService}, which (live) runs the GoTrue password grant, sets the HTTP-only
 * session cookie, and flags `requiresVerification` for an unconfirmed email.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const parsed = LoginSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false, errors: fieldErrors(parsed.error) }, { status: 422 });
		}

		return toAuthResponse(
			await AuthBackendService.authenticate({
				email: parsed.data.email,
				password: parsed.data.password,
				remember: parsed.data.remember,
				redirectTo: safeRedirect(parsed.data.redirectTo),
			}),
		);
	},
});
