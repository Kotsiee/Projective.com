import { define } from "@web/utils/state.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `GET /api/auth/verification-status?email=&redirectTo=` — the poll target for the `/verify` page's
 * "database listener". Thin route: it forwards to the fat {@link AuthBackendService}, which (live)
 * reads the app-owned `org.user_emails.verified_at` flag kept in lockstep with GoTrue by migration
 * `0312_email_verification_sync.sql`. When it flips `verified: true` the page auto-logs the user in.
 *
 * Stub mode returns `verified: false` so the manual OTP path stays the working route; the poll wiring
 * is already in place for the real query.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const params = ctx.url.searchParams;
		const result = await AuthBackendService.getVerificationStatus({
			email: params.get("email") ?? undefined,
			redirectTo: safeRedirect(params.get("redirectTo")),
		});
		return toAuthResponse(result);
	},
});
