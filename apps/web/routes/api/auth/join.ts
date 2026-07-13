import { define } from "@web/utils/state.ts";
import { fieldErrors, JoinSchema } from "@features/auth/core/schema.ts";
import { bracketFromDob, isJoinable, MIN_AGE } from "@features/auth/core/age.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

/** JSON helper — auth APIs always return an {@link AuthResult}-shaped body. */
function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/join` — validate an individual OR organization onboarding payload and (eventually)
 * provision the account. Islands are dumb: they POST here and act on the result. The age-gate is
 * re-enforced server-side (never trust the client's `restricted` flag).
 *
 * MVP: this is a thin, Supabase-pending stub. When auth lands, the marked sections delegate to fat
 * Services (`@server/services`) that create the `auth.users` identity, the `org.users_public` /
 * `org.business_profiles` records, invites, and session context (SYSTEM_ARCHITECTURE.md §Auth).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) return json({ ok: false, message: "Invalid request body." }, 400);

		const parsed = JoinSchema.safeParse(body);
		if (!parsed.success) return json({ ok: false, errors: fieldErrors(parsed.error) }, 422);

		const data = parsed.data;
		const redirectTo = safeRedirect(data.redirectTo);

		if (data.type === "individual") {
			const bracket = bracketFromDob(data.dob);
			if (!isJoinable(bracket)) {
				return json({
					ok: false,
					errors: { dob: `You need to be at least ${MIN_AGE} to join Projective.` },
				}, 422);
			}
			// Password is required unless this is an SSO/OAuth signup (which sets its own credential).
			if (!data.oauth && (!data.password || data.password.length < 8)) {
				return json({ ok: false, errors: { password: "Use at least 8 characters." } }, 422);
			}
			// TODO(supabase): create identity + org.users_public profile; persist the initial intent
			// as the active session context; store `restricted = bracket === "restricted"` (13–17).
		} else {
			// TODO(supabase): create owner identity + org.business_profiles (Draft/Unverified),
			// initial departments, and queue the stakeholder invites.
		}

		return json({ ok: true, requiresVerification: true, redirectTo });
	},
});
