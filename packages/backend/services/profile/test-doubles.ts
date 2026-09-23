import type { ProfileView } from "@projective/types/profile";
import { IntakeFieldSchema } from "@projective/types/services";
import { fail, ok } from "../ServiceResult.ts";
import { ProfileBackendService } from "./ProfileBackendService.ts";

/**
 * test-doubles — stand-ins for the LIVE profile read, for tests of other domains that run without a
 * database (the project hire flow reads the seller's intake from the profile).
 *
 * The profile is a live read by design — there is no fixture branch to fall back to — so a test that
 * needs one supplies exactly the facts it depends on, here, rather than the service growing a mock
 * mode production could reach.
 */

/** `@juno`'s intake as the hire tests expect it: one required free-text question, `scope`. */
export const JUNO_HIRE_INTAKE = [IntakeFieldSchema.parse({
	id: "scope",
	kind: "textarea",
	label: "What would you like me to take on?",
	required: true,
	maxLength: 800,
})];

/**
 * Replace `ProfileBackendService.overview` with a lookup over `profiles` (bare handle → the facts the
 * test needs; any other handle is a 404). Returns the function that restores the real one.
 */
export function stubProfileOverview(profiles: Record<string, Partial<ProfileView>>): () => void {
	const original = ProfileBackendService.overview;
	ProfileBackendService.overview = (handle: string) => {
		const bare = handle.replace(/^@+/, "").toLowerCase();
		const profile = profiles[bare];
		return Promise.resolve(
			profile
				? ok({ profile: { handle: `@${bare}`, ...profile } as ProfileView })
				: fail(404, { message: `No profile found for "${handle}".` }),
		);
	};
	return () => {
		ProfileBackendService.overview = original;
	};
}
