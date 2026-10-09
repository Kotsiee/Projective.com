import {
	type ProfileSetupProgress,
	SETUP_STEP_ORDER,
	type SetupAction,
	type SetupStepKey,
} from "@projective/types/org";

/**
 * setup-actions — where each profile setup step and suggested next action is completed, and the words
 * that name them. DOM-free and dependency-light, so the account popover, the Settings hub's progress
 * tracker and the pure attention rule all route a step the same way. The completeness RULE itself is
 * `org.fn_compute_profile_setup_progress` (Decision #155); this module only names and routes its answer.
 */

// #region Step + action routes
/** The checklist's line for each setup step, read the same whether it is done or pending. */
export const SETUP_STEP_LABEL: Readonly<Record<SetupStepKey, string>> = {
	account: "Complete your account details",
	email_verified: "Confirm your email address",
	skills: "Choose your skills or interests",
	avatar: "Add a profile photo",
	profile_copy: "Write your headline and story",
	working_hours: "Publish your working hours",
};

/** The call to action for each suggested next step. */
export const SETUP_ACTION_LABEL: Readonly<Record<SetupAction, string>> = {
	verify_email: "Confirm your email",
	verify_identity: "Verify your identity",
	add_payout: "Add a payout account",
	add_photo: "Add a profile photo",
	write_profile: "Write your headline and story",
	publish_hours: "Publish your working hours",
	add_skills: "Choose your skills",
	complete_account: "Finish your account details",
	become_partner: "Become a Freelancer",
};

/** Why the earning-gate actions come first — said once, beside the call to action. */
export const SETUP_ACTION_REASON: Readonly<Partial<Record<SetupAction, string>>> = {
	verify_identity: "Clients can hire you once your identity is verified.",
	add_payout: "A verified payout account lets escrow be released to you.",
	become_partner: "Offer your skills alongside hiring.",
};

/** Where a checklist step is completed. `handle` is the PERSON's (no `@`). */
export function setupStepHref(step: SetupStepKey, handle: string): string {
	switch (step) {
		case "email_verified":
			return "/settings/account#emails";
		case "working_hours":
			return `/${handle}/edit/availability`;
		default:
			return `/${handle}/edit`;
	}
}

/** Where a suggested next action is taken. `handle` is the PERSON's (no `@`). */
export function setupActionHref(action: SetupAction, handle: string): string {
	switch (action) {
		case "verify_email":
			return "/settings/account#emails";
		case "verify_identity":
			return "/settings/verification#identity-check";
		case "add_payout":
			return "/settings/verification#payouts";
		case "publish_hours":
			return `/${handle}/edit/availability`;
		case "become_partner":
			return "/become-partner";
		default:
			return `/${handle}/edit`;
	}
}

/** One checklist line: the step, its label and whether it is done, in checklist order. */
export interface SetupChecklistLine {
	key: SetupStepKey;
	label: string;
	done: boolean;
}

/** The whole checklist for a progress answer, done and pending, in checklist order. */
export function setupChecklist(progress: ProfileSetupProgress): SetupChecklistLine[] {
	const done = new Set(progress.completedKeys);
	return SETUP_STEP_ORDER.map((key) => ({
		key,
		label: SETUP_STEP_LABEL[key],
		done: done.has(key),
	}));
}
// #endregion
