import { define } from "@web/utils/state.ts";
import { ForgotPasswordSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/forgot-password` — thin route: begin password recovery. Anti-enumeration: it
 * responds `ok` regardless of whether the address has an account, so an attacker can't probe which
 * emails are registered. The fat {@link AuthBackendService} (live) asks GoTrue to send the email.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const parsed = ForgotPasswordSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false, errors: { email: "Enter a valid email address." } }, {
				status: 422,
			});
		}

		return toAuthResponse(
			await AuthBackendService.requestPasswordReset({
				email: parsed.data.email,
				redirectTo: safeRedirect(parsed.data.redirectTo),
			}),
		);
	},
});
