import { kindCopy, type VerificationState, type WorkspaceKind } from "@projective/types/workspace";

/**
 * verification-lock-copy — the pure wording of `VerificationLock`'s next step and link, kept apart
 * from the component so every kind × state × right is testable under `deno test`.
 */

// #region Next step
/**
 * The next step, always named — none of these is a dead end:
 *   - **Pending** — the check is with the provider, so nobody has to act. A business's billing holder
 *     is pointed at the Verification module, which lists what is still due (BU4); everyone else is
 *     told nothing is needed from them. No duration is promised, because no source document states
 *     one, and a team's module is not built yet, so it is never described as listing anything.
 *   - **Somebody else's** — the viewer cannot open Verification, so the step names WHO can. A
 *     business's KYB is the billing right's (Decision #230 (d)), which only the owner holds or grants,
 *     so the owner is who to ask.
 *   - **Actionable** — the viewer can finish it, so the step is the link beside this text.
 */
export function lockNextStep(
	kind: WorkspaceKind,
	state: VerificationState,
	canManage: boolean,
): string {
	const copy = kindCopy(kind);
	if (state === "pending") {
		return kind === "business" && canManage
			? "The Verification page shows anything still outstanding."
			: "Nothing else is needed from you meanwhile.";
	}
	if (!canManage) {
		return kind === "business"
			? "Ask the owner to verify the business."
			: `An owner or admin can finish ${copy.verification} from the ${copy.noun}'s Verification page.`;
	}
	return kind === "team"
		? "Everything else keeps working — only the payout itself waits on this."
		: "You can set limits and compose spend rules now; only moving money waits on this.";
}
// #endregion

// #region Link
/** The link's label — an instruction, never a bare "Continue". */
export function lockLinkLabel(kind: WorkspaceKind, state: VerificationState): string {
	if (state === "pending") return "See what's outstanding";
	return `Finish ${kindCopy(kind).verification}`;
}
// #endregion
