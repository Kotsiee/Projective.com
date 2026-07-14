import { define } from "@web/utils/state.ts";
import { ResendSchema } from "@features/auth/core/schema.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/resend` — thin route: re-send the email verification code. Always reports success
 * (anti-enumeration + the client throttles resends behind a countdown regardless). The fat
 * {@link AuthBackendService} (live) asks GoTrue to re-issue the confirmation email.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => ({}));
		const parsed = ResendSchema.safeParse(body);
		return toAuthResponse(
			await AuthBackendService.resendVerification({
				email: parsed.success ? parsed.data.email : undefined,
			}),
		);
	},
});
