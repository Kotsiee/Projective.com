/**
 * Age-gate — the Date-of-Birth guardrail shared by the client islands and the server API stubs
 * (single source of truth so the two layers can never drift).
 *
 * Business rule (PRODUCT_SPEC.md §Account Age Guardrails):
 *   - age < 13            → `blocked`    — cannot create an account at all.
 *   - 13 ≤ age < 18       → `restricted` — account is created but flagged; cannot buy services or
 *                                          sell work until they turn 18.
 *   - age ≥ 18            → `full`       — unrestricted access.
 */

/** Minimum age permitted to hold any Projective account. */
export const MIN_AGE = 13;
/** Age at which an account gains unrestricted (buy/sell) capability. */
export const ADULT_AGE = 18;

/** The four possible evaluations of a supplied Date of Birth. */
export type AgeBracket = "unknown" | "blocked" | "restricted" | "full";

/**
 * Compute a whole-year age from an ISO `YYYY-MM-DD` date-of-birth string.
 *
 * @param dob ISO date string from a native `<input type="date">` (empty ⇒ `null`).
 * @param now Reference "today" (injectable for deterministic tests).
 * @returns Whole years, or `null` when the input is empty / unparseable / in the future.
 */
export function computeAge(dob: string, now: Date = new Date()): number | null {
	if (!dob) return null;
	const d = new Date(`${dob}T00:00:00`);
	if (Number.isNaN(d.getTime())) return null;
	if (d.getTime() > now.getTime()) return null;
	let age = now.getFullYear() - d.getFullYear();
	const monthDelta = now.getMonth() - d.getMonth();
	if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < d.getDate())) age--;
	return age;
}

/** Map a computed age to its capability bracket. */
export function ageBracket(age: number | null): AgeBracket {
	if (age === null) return "unknown";
	if (age < MIN_AGE) return "blocked";
	if (age < ADULT_AGE) return "restricted";
	return "full";
}

/** Convenience: evaluate a bracket straight from a DoB string. */
export function bracketFromDob(dob: string, now?: Date): AgeBracket {
	return ageBracket(computeAge(dob, now));
}

/** Whether a DoB bracket is allowed to proceed with account creation. */
export function isJoinable(bracket: AgeBracket): boolean {
	return bracket === "restricted" || bracket === "full";
}

/** Friendly, non-technical copy for each non-`full` bracket (surfaced under the DoB field). */
export const AGE_MESSAGES: Record<Exclude<AgeBracket, "full">, string> = {
	unknown: "Enter your date of birth to continue.",
	blocked:
		`You need to be at least ${MIN_AGE} to join Projective. Thanks for stopping by — come back when you're a little older.`,
	restricted:
		`Since you're under ${ADULT_AGE}, we'll set up a limited account. You can explore and build your profile, but buying services and selling work unlock automatically on your ${ADULT_AGE}th birthday.`,
};
