import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { EnableFreelancerInputSchema } from "@projective/types/user";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";

/**
 * `POST /api/user/freelancer` — "Become a Partner": unlock the freelancer persona on the acting
 * person's own identity (`PRODUCT_SPEC.md` §Additive, Unlockable Personas).
 *
 * Thin by contract: resolve the actor from the SESSION (never the body), Zod-validate the starter
 * skills, delegate to the fat {@link UserBackendService.enableFreelancer}, map the result. The access
 * token this request carried still says `isFreelancer: false` afterwards — the caller refreshes the
 * session (`POST /api/auth/refresh`) so the hook re-mints the claims before it navigates.
 *
 * Self-authorising like the other `/api/user/*` routes: a guest gets the service's 401, which the
 * client's interceptor routes through a silent refresh + retry.
 */
export const handler = define.handlers({
	async POST(ctx) {
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
		return Response.json(
			{ ok: result.ok, message: result.message, errors: result.errors, ...(result.data ?? {}) },
			{ status: result.status },
		);
	},
});
