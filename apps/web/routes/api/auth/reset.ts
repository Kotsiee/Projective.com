import { define } from "@web/utils/state.ts";
import { fieldErrors, ResetPasswordSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/reset` — thin route: validate the 6-digit code + new password, then delegate to
 * the fat {@link AuthBackendService}, which (live) exchanges the recovery code with GoTrue and
 * updates the credential. In stub mode the sentinel `000000` is the deterministic failure path.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const parsed = ResetPasswordSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false, errors: fieldErrors(parsed.error) }, { status: 422 });
		}

		return toAuthResponse(
			await AuthBackendService.resetPassword({
				email: parsed.data.email,
				code: parsed.data.code,
				password: parsed.data.password,
				redirectTo: safeRedirect(parsed.data.redirectTo),
			}),
		);
	},
});
