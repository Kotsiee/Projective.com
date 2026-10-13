/**
 * Age-gate — the Date-of-Birth guardrail shared by the client islands and `AuthBackendService`
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
/** The earliest plausible date of birth — the floor `org.users_public.dob` is CHECKed against. */
export const DOB_FLOOR = "1900-01-01";

/**
 * The zone an age is counted in when the person's own is unknown — the same fallback
 * `org.fn_age_years` uses, so every layer agrees on which day a birthday falls.
 */
export const AGE_FALLBACK_TIME_ZONE = "UTC";

/** The four possible evaluations of a supplied Date of Birth. */
export type AgeBracket = "unknown" | "blocked" | "restricted" | "full";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `timeZone` is an IANA zone this runtime resolves. */
export function isTimeZone(timeZone: string | null | undefined): timeZone is string {
	if (!timeZone) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

/**
 * The browser's IANA zone — what the join form sends, and what the database then counts this
 * person's birthdays in. Client-side only: on the server it would answer the server's own zone.
 */
export function browserTimeZone(): string {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return isTimeZone(zone) ? zone : AGE_FALLBACK_TIME_ZONE;
}

/** Today's calendar date (`YYYY-MM-DD`) in `timeZone`; an absent or unknown zone counts in UTC. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
	const zone = isTimeZone(timeZone) ? timeZone : AGE_FALLBACK_TIME_ZONE;
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: zone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Compute a whole-year age from an ISO `YYYY-MM-DD` date of birth, counted on today's date in the
 * person's own zone — the rule `org.fn_age_years` applies, so a birthday turns over at the same
 * moment in the form, the API and the database. A 29 February birthday turns over on 1 March in a
 * common year, as Postgres `age()` does.
 *
 * @param dob ISO date string from a native `<input type="date">` (empty ⇒ `null`).
 * @param timeZone The person's IANA zone; absent or unknown counts in {@link AGE_FALLBACK_TIME_ZONE}.
 * @param now Reference instant (injectable for deterministic tests).
 * @returns Whole years, or `null` when the input is empty / not a real date / in the future / before
 * {@link DOB_FLOOR}.
 */
export function computeAge(
	dob: string,
	timeZone?: string | null,
	now: Date = new Date(),
): number | null {
	if (!ISO_DATE.test(dob) || dob < DOB_FLOOR) return null;
	const [by, bm, bd] = dob.split("-").map(Number);
	const real = new Date(Date.UTC(by, bm - 1, bd));
	if (real.getUTCFullYear() !== by || real.getUTCMonth() !== bm - 1 || real.getUTCDate() !== bd) {
		return null;
	}
	const today = todayIn(timeZone, now);
	if (dob > today) return null;
	const [ty, tm, td] = today.split("-").map(Number);
	return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** Map a computed age to its capability bracket. */
export function ageBracket(age: number | null): AgeBracket {
	if (age === null) return "unknown";
	if (age < MIN_AGE) return "blocked";
	if (age < ADULT_AGE) return "restricted";
	return "full";
}

/** Convenience: evaluate a bracket straight from a DoB string, in the person's zone. */
export function bracketFromDob(dob: string, timeZone?: string | null, now?: Date): AgeBracket {
	return ageBracket(computeAge(dob, timeZone, now));
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

/**
 * The SQLSTATEs the database raises for these rules (Decision #190), so a service maps a refusal
 * without matching on message text.
 */
export const AGE_SQLSTATE = {
	/** `org.fn_check_dob` — under {@link MIN_AGE}; the account is not provisioned. */
	underMinimum: "PM422",
	/** `org.fn_assert_adult` — a restricted (13–17) account reached a buy/sell door. */
	restricted: "PM403",
} as const;

/** The reason key a restricted refusal carries (`details.reason` / a field error value). */
export const AGE_RESTRICTED_REASON = "age_restricted";

/** The 403 copy every buy/sell door answers a restricted account with. */
export const RESTRICTED_REFUSAL =
	`Buying services and selling work unlock on your ${ADULT_AGE}th birthday. Until then you can explore and build your profile.`;

/** What a restricted account is told when it creates a project (Decision #192). */
export const PERSONAL_PROJECT_NOTE =
	`Projects you create stay private to you until you're ${ADULT_AGE}: no members, hiring or payments.`;

/** Why a direct message involving an under-18 account was refused (Decision #208). */
export const DM_SHIELD_REFUSAL =
	"People under 18 can message only people they follow who follow them back.";

/** The `details.reason` a join refused for an under-13 date of birth carries. */
export const UNDER_MINIMUM_REASON = "under_minimum";

/**
 * The HttpOnly session cookie the join route sets once it has refused an under-13 date of birth, and
 * refuses every further individual sign-up while it lasts (Decision #208). It carries no data.
 */
export const JOIN_AGE_LOCK_COOKIE = "pj_join_age_lock";

/** The join-form copy for a date of birth under {@link MIN_AGE}. */
export const UNDER_MINIMUM_REFUSAL = `You need to be at least ${MIN_AGE} to join Projective.`;

/**
 * The Dev Context Switcher's override of the session's restriction: `minor` acts as a 13–17 account,
 * `adult` as an unrestricted one. Absent = follow the token. The API routes' mirror honours it in
 * development only; the database never reads it.
 */
export type AgeOverride = "minor" | "adult";

/** The cookie that carries {@link AgeOverride}. */
export const AGE_OVERRIDE_COOKIE = "pj.dev.age";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parseAgeOverride(raw: string | null | undefined): AgeOverride | null {
	const value = raw?.trim();
	return value === "minor" || value === "adult" ? value : null;
}
