import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { respondWithReissuedSession } from "@web/utils/session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { EnableFreelancerInputSchema } from "@projective/types/user";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";

/**
 * `POST /api/user/freelancer` — "Become a Partner": unlock the freelancer persona on the acting
 * person's own identity (`PRODUCT_SPEC.md` §Additive, Unlockable Personas).
 *
 * Thin by contract: resolve the actor from the SESSION (never the body), Zod-validate the starter
 * skills, delegate to the fat {@link UserBackendService.enableFreelancer}, map the result. The access
 * token this request carried still says `isFreelancer: false` afterwards, so a successful unlock
 * re-issues the session server-side and mints the re-stamped cookies onto this response
 * ({@link respondWithReissuedSession}); a failed renewal keeps the old cookies and answers
 * `claimsStale: true`.
 *
 * Self-authorising like the other `/api/user/*` routes: a guest gets the service's 401, which the
 * client's interceptor routes through a silent refresh + retry.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const raw = await ctx.req.json().catch(() => null);
		const parsed = EnableFreelancerInputSchema.safeParse(raw);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return Response.json(
				{
					ok: false,
					message: first?.message ?? "Choose between one and ten skills.",
					errors: { [first?.path.join(".") || "skills"]: first?.message ?? "Invalid value." },
				},
				{ status: 422 },
			);
		}

		const result = await UserBackendService.enableFreelancer(readActor(ctx), parsed.data);
		const body = {
			ok: result.ok,
			message: result.message,
			errors: result.errors,
			...(result.data ?? {}),
		};
		if (!result.ok) return Response.json(body, { status: result.status });
		return respondWithReissuedSession(ctx.req, body, result.status);
	},
});
