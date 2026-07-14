import { define } from "@web/utils/state.ts";
import { fieldErrors, VerifySchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/verify` — thin route: validate the 6-digit code, then delegate to the fat
 * {@link AuthBackendService}, which exchanges the code with GoTrue and (live) issues the session
 * cookie. In stub mode the sentinel `000000` is the deterministic failure path.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const parsed = VerifySchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false, errors: fieldErrors(parsed.error) }, { status: 422 });
		}

		return toAuthResponse(
			await AuthBackendService.confirmEmail({
				code: parsed.data.code,
				email: parsed.data.email,
				redirectTo: safeRedirect(parsed.data.redirectTo),
			}),
		);
	},
});
