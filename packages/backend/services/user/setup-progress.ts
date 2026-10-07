import type { SupabaseClient } from "supabaseClient";
import { type ProfileSetupProgress, ProfileSetupProgressRowSchema } from "@projective/types/org";

/**
 * setup-progress — the one read of `org.fn_compute_profile_setup_progress` (Decision #155). The rule
 * lives in that function; this module only calls it and parses the answer, so the score a popover
 * draws is exactly the score the database computed.
 */

/** Why a setup-progress read failed, kept with the error so the caller can report it. */
export class SetupProgressReadError extends Error {
	constructor(message: string, readonly code: string | null, options?: ErrorOptions) {
		super(message, options);
		this.name = "SetupProgressReadError";
	}
}

/**
 * Read one person's setup progress through the CALLER's client (the function refuses another
 * person's id, `42501`). Resolves `null` when the person has no profile row yet; rejects with a
 * {@link SetupProgressReadError} on a database refusal or an answer this build cannot parse.
 */
export async function fetchSetupProgress(
	client: SupabaseClient,
	userId: string,
): Promise<ProfileSetupProgress | null> {
	const { data, error } = await client.schema("org").rpc("fn_compute_profile_setup_progress", {
		p_user_id: userId,
	});
	if (error) {
		throw new SetupProgressReadError(`setup progress: ${error.message}`, error.code ?? null, {
			cause: error,
		});
	}
	if (data === null || data === undefined) return null;
	const parsed = ProfileSetupProgressRowSchema.safeParse(data);
	if (!parsed.success) {
		throw new SetupProgressReadError("setup progress: unexpected answer", null, {
			cause: parsed.error,
		});
	}
	return parsed.data;
}
