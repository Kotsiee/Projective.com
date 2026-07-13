import { define } from "@web/utils/state.ts";
import { fieldErrors, ResetPasswordSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/reset` — complete password recovery: verify the 6-digit code and set the new
 * password.
 *
 * MVP stub: rejects the sentinel code `000000` so the failure path is testable; any other 6-digit
 * code succeeds. The real handler exchanges the code with GoTrue and updates the credential.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) return json({ ok: false, message: "Invalid request body." }, 400);

		const parsed = ResetPasswordSchema.safeParse(body);
		if (!parsed.success) return json({ ok: false, errors: fieldErrors(parsed.error) }, 422);

		if (parsed.data.code === "000000") {
			return json({ ok: false, message: "That code didn't match or has expired." }, 422);
		}
		// TODO(supabase): verify the recovery code + update the password via @server/services.
		return json({ ok: true, redirectTo: safeRedirect(parsed.data.redirectTo) });
	},
});
