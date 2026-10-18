import {
	ELIGIBILITY_NOTICES,
	type EligibilityBlockReason,
	isEligibilityReason,
} from "@projective/types/finance";

/**
 * apply-as — the apply modal's two pure rules (Teams work order C5): who it applies as by default, and
 * which refusals it states as its `InlineNotice` rather than as an error line.
 *
 * **The default applicant (Decision #154 flag (c)).** While the shell is acting as a team, the modal
 * opens on that team when the viewer may bind it to work (`bind_seat`, read from the team's own
 * allowance answer), and on "Yourself" otherwise: defaulting a member who cannot apply for the team
 * onto the team would open the modal on a refusal. A reader's own pick is never overridden (the modal
 * asks this only until they choose).
 *
 * **The eligibility refusals (B2, Decision #228 (E)).** `team_not_active`, `team_too_small` and
 * `missing_permission` are rules, not failures: the server's pre-flight answers them as a `422` tagged
 * `errors.allowance`, and the apply door — when a stale pre-flight let a request through — raises the
 * same sentence untagged. Either way the modal states it as its notice, in the words
 * `ELIGIBILITY_NOTICES` holds for every side.
 *
 * DOM-free and CSS-free, so `deno test` loads it directly.
 */

// #region Default applicant
/** The applicant picker's value for "apply as yourself"; anything else is a team id. */
export const APPLY_AS_SELF = "self";

/** What the default applicant is decided from. */
export interface ApplyAsDefaultInput {
	/** The team the session is acting as, or `null` when acting personally. */
	actingTeamId: string | null;
	/** The team ids the picker offers (the viewer's teams that are not archived). */
	offeredTeamIds: readonly string[];
	/** The viewer's `bind_seat` on the acting team, from its allowance read; `null` while unknown. */
	canBindSeat: boolean | null;
}

/**
 * The applicant the modal opens on: the acting team when the picker offers it and the viewer may bind
 * it, otherwise the viewer themself.
 */
export function applyAsDefault(input: ApplyAsDefaultInput): string {
	const { actingTeamId } = input;
	if (actingTeamId && input.offeredTeamIds.includes(actingTeamId) && input.canBindSeat === true) {
		return actingTeamId;
	}
	return APPLY_AS_SELF;
}
// #endregion

// #region Eligibility refusals
/** A refused application the modal states as its notice. */
export interface ApplyRefusal {
	reason: EligibilityBlockReason;
	/** The sentence — the server's, else the shared notice's. */
	text: string;
}

/** The parts of a `/api/projects/apply` answer a refusal is read from. */
export interface ApplyAnswer {
	ok: boolean;
	message?: string;
	errors?: Record<string, string>;
	details?: Record<string, string | number | boolean | null>;
}

/**
 * The eligibility refusal an apply answer carries, or `null` for success and for every other failure
 * (those stay the modal's error line): a reason tagged by the pre-flight (`errors.allowance` /
 * `details.blockReason`), or the door's own sentence, matched word for word.
 */
export function eligibilityRefusal(answer: ApplyAnswer): ApplyRefusal | null {
	if (answer.ok) return null;
	const message = answer.message?.trim() ?? "";
	const tagged = answer.errors?.allowance ?? answer.details?.blockReason;
	if (isEligibilityReason(tagged)) {
		return { reason: tagged, text: message || ELIGIBILITY_NOTICES[tagged] };
	}
	const matched = (Object.keys(ELIGIBILITY_NOTICES) as EligibilityBlockReason[])
		.find((reason) => ELIGIBILITY_NOTICES[reason] === message);
	return matched ? { reason: matched, text: ELIGIBILITY_NOTICES[matched] } : null;
}

/**
 * Whether the refusal still needs its own notice: not when the re-read allowance already states the
 * same reason (the modal would say one thing twice).
 */
export function showsRefusal(
	refusal: ApplyRefusal | null,
	preflightReason: string | undefined,
): refusal is ApplyRefusal {
	return refusal !== null && refusal.reason !== preflightReason;
}
// #endregion
