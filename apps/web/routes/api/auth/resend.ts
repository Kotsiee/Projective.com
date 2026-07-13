import { define } from "@web/utils/state.ts";
import { ResendSchema } from "@features/auth/core/schema.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/resend` — re-send the email verification code. MVP stub; the real handler asks
 * GoTrue to re-issue the confirmation email. Always reports success (anti-enumeration + the client
 * throttles resends behind a countdown regardless).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => ({}));
		ResendSchema.safeParse(body); // shape-only; ignore result for the stub
		return json({ ok: true });
	},
});
