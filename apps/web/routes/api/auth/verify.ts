import { define } from "@web/utils/state.ts";
import { fieldErrors, VerifySchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/verify` — confirm an email with the 6-digit code.
 *
 * MVP stub: rejects the sentinel code `000000` (testable failure path); any other 6-digit code
 * confirms and returns the sanitised return path. The real handler exchanges the code with GoTrue,
 * whose confirmation trigger advances `org.user_emails.verified_at` (see database/org/Tables.md).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) return json({ ok: false, message: "Invalid request body." }, 400);

		const parsed = VerifySchema.safeParse(body);
		if (!parsed.success) return json({ ok: false, errors: fieldErrors(parsed.error) }, 422);

		if (parsed.data.code === "000000") {
			return json(
				{ ok: false, message: "That code didn't match. Check the digits and try again." },
				422,
			);
		}
		// TODO(supabase): confirm the email via @server/services; issue the session cookie.
		return json({ ok: true, redirectTo: safeRedirect(parsed.data.redirectTo) });
	},
});
