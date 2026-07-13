import { define } from "@web/utils/state.ts";
import { ForgotPasswordSchema } from "@features/auth/core/schema.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/forgot-password` — begin password recovery by emailing a reset code.
 *
 * Anti-enumeration: responds `ok` regardless of whether the address has an account, so an attacker
 * can't probe which emails are registered. MVP stub — the real handler asks Supabase/GoTrue to send
 * the recovery email.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) return json({ ok: false, message: "Invalid request body." }, 400);

		const parsed = ForgotPasswordSchema.safeParse(body);
		if (!parsed.success) {
			return json({ ok: false, errors: { email: "Enter a valid email address." } }, 422);
		}
		// TODO(supabase): trigger the recovery email via @server/services. Always report success.
		return json({ ok: true });
	},
});
