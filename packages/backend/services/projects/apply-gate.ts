import {
	type AllowanceBlockReason,
	allowanceNotice,
	allowanceNoticeText,
	type ProposalAllowanceStatus,
	TEAM_NOT_ACTIVE_NOTICE,
} from "@projective/types/finance";
import { fail, type ServiceResult } from "../ServiceResult.ts";
import type { WriteRefusal } from "./live-writes.ts";

/**
 * apply-gate — the pure halves of the application pre-flight: the `422` a refusing allowance status
 * answers with, and the same envelope for the database's own `team_not_active` refusal, so a request
 * that slips past the pre-flight (a stale read, a status flipped mid-flight) is told in the same words
 * and the same shape.
 *
 * The envelope is `errors.allowance` + `details.blockReason`, the machine reason the apply modal reads.
 * Eligibility reasons (`missing_permission`, `team_not_active`, `team_too_small`) always refuse; the
 * meters refuse only while `proposal_allowance_enforced` is on (Decisions #58, #154, #228 (E)).
 */

// #region Pre-flight
/** The `422` a refusing status answers with, or `null` when the application may proceed. */
export function allowanceRefusal<T>(status: ProposalAllowanceStatus): ServiceResult<T> | null {
	if (status.canApply || !status.blockReason) return null;
	const notice = allowanceNotice(status);
	return fail<T>(422, {
		message: notice
			? allowanceNoticeText(notice, Date.parse(status.serverNow))
			: "You can't apply right now.",
		errors: { allowance: status.blockReason },
		details: {
			blockReason: status.blockReason,
			weeklyRemaining: status.weeklyRemaining,
			weeklyGranted: status.weeklyGranted,
			bufferUnits: status.bufferUnits,
			bufferCap: status.bufferCap,
			nextBufferRefillAt: status.nextBufferRefillAt,
			weeklyResetsAt: status.weeklyResetsAt,
		},
	});
}
// #endregion

// #region Database backstop
/** The message prefix `projects.fn_assert_team_can_apply` raises for an unpublished team. */
export const TEAM_NOT_ACTIVE_PREFIX = "team_not_active:";

const TEAM_NOT_ACTIVE: AllowanceBlockReason = "team_not_active";

/**
 * The pre-flight's envelope for the door's `team_not_active` refusal (`23514`), or `null` for any other
 * error. Its sentence is the notice's, not the raw `team_not_active: …` message.
 */
export function teamNotActiveRefusal(
	error: { code?: string; message: string },
): WriteRefusal | null {
	if (error.code !== "23514" || !error.message.startsWith(TEAM_NOT_ACTIVE_PREFIX)) return null;
	return {
		status: 422,
		message: TEAM_NOT_ACTIVE_NOTICE,
		errors: { allowance: TEAM_NOT_ACTIVE },
		details: { blockReason: TEAM_NOT_ACTIVE },
	};
}
// #endregion
