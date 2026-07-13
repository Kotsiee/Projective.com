import { define } from "@web/utils/state.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";

/**
 * `GET /api/auth/oauth/google` — Google OAuth entry point.
 *
 * Production flow (SYSTEM_ARCHITECTURE.md §Authentication): this begins the Supabase Google OAuth
 * handshake; the callback either signs an existing user in (→ `redirectTo`) or, for a Google
 * identity with no Projective profile yet, bounces to `/join` with the Google-provided name / email
 * / avatar pre-filled.
 *
 * MVP: no live Google client is wired, so this simulates the "new identity → pre-filled /join"
 * branch directly, which is the branch the join form's pre-fill support exists to serve. The avatar
 * host is on the OAuth allowlist (see core/oauth.ts).
 */
export const handler = define.handlers({
	GET(ctx) {
		const redirectTo = safeRedirect(ctx.url.searchParams.get("redirectTo"));
		const params = new URLSearchParams({
			oauth: "google",
			firstName: "Ada",
			lastName: "Lovelace",
			email: "ada.lovelace@gmail.com",
			avatar:
				"https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=128&h=128&fit=crop&crop=faces",
			redirectTo,
		});
		return new Response(null, {
			status: 303,
			headers: { location: `/join?${params.toString()}` },
		});
	},
});
