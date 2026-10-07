import { fail, type ServiceResult } from "../ServiceResult.ts";

/**
 * freelancer-unlock — the pure half of {@link UserBackendService.enableFreelancer}: turning an
 * `org.enable_freelancer_profile` error into the refusal the person sees. Kept apart from the service
 * so it is testable without a Supabase client.
 */

// #region Error mapping
/**
 * Map an `org.enable_freelancer_profile` error to a {@link ServiceResult} refusal. The RPC raises
 * `28000` when unauthenticated, `42501` before onboarding is complete and `22023` for a skill list it
 * refuses (an unknown slug, more than ten); anything else is reported as an outage, never as success.
 */
export function freelancerUnlockFailure(
	error: { code?: string; message?: string },
): ServiceResult<never> {
	switch (error.code) {
		case "28000":
			return fail(401, { message: "Your session has expired. Please sign in again." });
		case "42501":
			return fail(403, {
				message: "Finish setting up your account before unlocking a freelancer profile.",
			});
		case "22023":
			return fail(422, {
				message: "Some of those skills couldn't be used. Choose skills from the list.",
				errors: { skills: error.message ?? "Choose skills from the list." },
			});
		default:
			return fail(503, {
				message: "We couldn't unlock your freelancer profile. Try again in a moment.",
			});
	}
}
// #endregion
