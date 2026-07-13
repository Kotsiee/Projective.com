import { define } from "@web/utils/state.ts";
import { fieldErrors, LoginSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/login` — validate credentials and (eventually) mint a Supabase session.
 *
 * MVP stub: shape-validates and echoes the sanitised return path. When Supabase lands this delegates
 * to an auth Service (password grant → HTTP-only session cookie), and returns `requiresVerification`
 * when the identity's email is not yet confirmed so the client routes on to `/verify`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) return json({ ok: false, message: "Invalid request body." }, 400);

		const parsed = LoginSchema.safeParse(body);
		if (!parsed.success) return json({ ok: false, errors: fieldErrors(parsed.error) }, 422);

		// TODO(supabase): verify credentials via @server/services; set the session cookie here.
		return json({
			ok: true,
			requiresVerification: false,
			redirectTo: safeRedirect(parsed.data.redirectTo),
		});
	},
});
