import { apiFetch } from "@web/utils/api-client.ts";
import {
	type EnableFreelancerInput,
	type FreelancerConversionResult,
	FreelancerConversionResultSchema,
} from "@projective/types/user";

/**
 * partner-service — the "Become a Partner" client transport (thin: no business rule lives here).
 *
 * The unlock is the same sequence as an acting-context switch (`useContextSwitch`):
 *
 * ```
 *   POST /api/user/freelancer                         →   hard navigation
 *   (convert + re-issue the session, server side)         (re-render the chrome)
 * ```
 *
 * The conversion changes the database; the access token still carries `active_context.isFreelancer:
 * false` until the hook re-mints it, so the route re-issues the session on the same response (Decision
 * #193). When it could not, the answer says `claimsStale` and the unlock is reported, never navigated
 * past — the sidebar, the Create menu and the account popover would keep the buyer chrome. The profile
 * IS unlocked by then, and unlocking again is idempotent, so a retry re-issues the session.
 */

// #region Types
/** The outcome the wizard renders. */
export type UnlockOutcome =
	| { ok: true; result: FreelancerConversionResult; destination: string }
	| { ok: false; message: string; fieldError?: string; unlocked?: boolean };
// #endregion

// #region Helpers
/** The profile editor for a person — where a fresh seller sets up what buyers will see. */
export function profileSetupPath(handle: string): string {
	return `/${encodeURIComponent(handle)}/edit`;
}
// #endregion

// #region Unlock
/** Convert the acting person; the route re-issues their session on the same response. Never throws. */
export async function unlockFreelancer(input: EnableFreelancerInput): Promise<UnlockOutcome> {
	let body: Record<string, unknown> | null = null;
	try {
		const res = await apiFetch("/api/user/freelancer", {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		body = await res.json().catch(() => null);
	} catch {
		return { ok: false, message: "Network error — nothing was changed. Try again." };
	}

	if (!body || body.ok !== true) {
		const errors = body?.errors as Record<string, string> | undefined;
		return {
			ok: false,
			message: typeof body?.message === "string"
				? body.message
				: "We couldn't unlock your freelancer profile. Try again in a moment.",
			fieldError: errors?.skills,
		};
	}

	const parsed = FreelancerConversionResultSchema.safeParse(body);
	if (!parsed.success) {
		return {
			ok: false,
			unlocked: true,
			message: "Your profile was unlocked, but we couldn't confirm it. Reload the page to continue.",
		};
	}

	if (body.claimsStale === true) {
		return {
			ok: false,
			unlocked: true,
			message: "Your freelancer profile is unlocked, but your session couldn't be updated yet. " +
				"Try again in a moment.",
		};
	}

	return { ok: true, result: parsed.data, destination: profileSetupPath(parsed.data.handle) };
}
// #endregion
