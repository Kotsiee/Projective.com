import type { JSX } from "preact";
import type { AccountSetup } from "@projective/types/user";
import { VERIFICATION_STAMP_META } from "@projective/types/org";
import { ProgressBar } from "@projective/ui/feedback";
import { VerificationStampBadge } from "@projective/ui/display";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import {
	SETUP_ACTION_LABEL,
	SETUP_ACTION_REASON,
	setupActionHref,
	setupChecklist,
	setupStepHref,
} from "@web/features/shell/core/account-setup.ts";

/** Props for {@link AccountSetupNudge}. */
export interface AccountSetupNudgeProps {
	/** The setup the popover renders (the real read, or a dev simulation of it). */
	setup: AccountSetup;
	/** The PERSON's handle, without the `@`. */
	handle: string;
	/** Whether the checklist is unfolded. */
	open: boolean;
	onToggle: () => void;
	/** Closes the surface hosting the nudge before a link navigates. */
	onNavigate: () => void;
	/** Plays the crest's one-shot stamp while a milestone is celebrated. */
	celebrate?: boolean;
}

/**
 * AccountSetupNudge — the account popover's setup block (Decision #155). Below 100% it is the score,
 * a slim progress track and an inline checklist; at 100% the percentage gives way to the person's
 * verification status. Beneath either sits the ONE next step `org.fn_compute_profile_setup_progress`
 * suggests, as a filled call to action — except the freelancer unlock, which the popover already
 * offers as a destination and is never offered twice.
 */
export function AccountSetupNudge(
	{ setup, handle, open, onToggle, onNavigate, celebrate = false }: AccountSetupNudgeProps,
): JSX.Element | null {
	const { progress, verificationStamp } = setup;
	const complete = progress.score >= 100;
	const checklist = setupChecklist(progress);
	const remaining = checklist.filter((line) => !line.done).length;
	const action = progress.nextSuggestedAction === "become_partner"
		? null
		: progress.nextSuggestedAction;
	const status = verificationStamp === "none" ? null : VERIFICATION_STAMP_META[verificationStamp];
	if (complete && !action && !status) return null;

	return (
		<div class="shell-setup">
			{complete
				? status
					? (
						<p class="shell-setup__status">
							<VerificationStampBadge
								stamp={verificationStamp}
								size="xs"
								mode="decorative"
								celebrate={celebrate}
							/>
							<span>{status.label}</span>
						</p>
					)
					: null
				: (
					<>
						<button
							type="button"
							class="shell-setup__head"
							aria-expanded={open}
							aria-controls="shell-setup-steps"
							onClick={onToggle}
						>
							<span class="shell-setup__title">
								Profile setup <span class="shell-setup__pct">{progress.score}%</span>
							</span>
							<span class="shell-setup__hint">
								{remaining} {remaining === 1 ? "step" : "steps"} left
							</span>
							<NavIcon name="chevron" class="shell-setup__chevron" />
						</button>
						<ProgressBar
							class="shell-setup__bar"
							value={progress.score}
							aria-label={`Profile setup, ${progress.score}% complete`}
						/>
						{open
							? (
								<ul class="shell-setup__steps" id="shell-setup-steps">
									{checklist.map((line) => (
										<li key={line.key}>
											{line.done
												? (
													<span class="shell-setup__step" data-done="true">
														<NavIcon name="check" class="shell-setup__mark" />
														<span>{line.label}</span>
														<span class="ui-visually-hidden">(done)</span>
													</span>
												)
												: (
													<a
														class="shell-setup__step"
														href={setupStepHref(line.key, handle)}
														onClick={onNavigate}
													>
														<span
															class="shell-setup__mark shell-setup__mark--todo"
															aria-hidden="true"
														/>
														<span>{line.label}</span>
													</a>
												)}
										</li>
									))}
								</ul>
							)
							: null}
					</>
				)}
			{action
				? (
					<div class="shell-setup__next">
						{SETUP_ACTION_REASON[action]
							? <p class="shell-setup__reason">{SETUP_ACTION_REASON[action]}</p>
							: null}
						<a
							class="ui-button ui-button--primary ui-button--filled ui-button--size-sm ui-button--fluid shell-setup__cta"
							href={setupActionHref(action, handle)}
							onClick={onNavigate}
						>
							<span class="ui-button__label">{SETUP_ACTION_LABEL[action]}</span>
						</a>
					</div>
				)
				: null}
		</div>
	);
}
