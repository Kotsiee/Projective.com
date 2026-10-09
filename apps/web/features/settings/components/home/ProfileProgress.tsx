import type { JSX } from "preact";
import { ProgressBar } from "@projective/ui/feedback";
import type { SettingsAttentionFacts } from "@projective/types/settings";
import {
	SETUP_ACTION_LABEL,
	SETUP_ACTION_REASON,
	setupActionHref,
} from "@features/shell/core/setup-actions.ts";

/** Props for {@link ProfileProgress}. */
export interface ProfileProgressProps {
	profile: NonNullable<SettingsAttentionFacts["profile"]>;
}

/**
 * ProfileProgress — the hub's profile completeness tracker: the score
 * `org.fn_compute_profile_setup_progress` computes, as a bar, and ONE filled call to action straight
 * to the next step it suggests. The freelancer unlock is a choice, not a missing step, so it is never
 * offered here (it lives under Account → Freelancer or client).
 */
export function ProfileProgress({ profile }: ProfileProgressProps): JSX.Element {
	const complete = profile.score >= 100;
	const next = profile.nextAction && profile.nextAction !== "become_partner"
		? profile.nextAction
		: null;
	return (
		<section class="stg-progress" aria-labelledby="stg-progress-title">
			<div class="stg-progress__head">
				<h2 id="stg-progress-title" class="stg-block__title">Profile</h2>
				<span class="stg-progress__score">
					{complete ? "Complete" : `${profile.score}% set up`}
					{!complete
						? (
							<span class="stg-progress__left">
								{" · "}
								{profile.pendingSteps} {profile.pendingSteps === 1 ? "step" : "steps"} left
							</span>
						)
						: null}
				</span>
			</div>
			<ProgressBar
				class="stg-progress__bar"
				value={profile.score}
				severity={complete ? "success" : "primary"}
				aria-label={`Profile ${profile.score}% set up`}
			/>
			{next && SETUP_ACTION_REASON[next]
				? <p class="stg-progress__reason">{SETUP_ACTION_REASON[next]}</p>
				: null}
			{next
				? (
					<a
						class="ui-button ui-button--primary ui-button--filled ui-button--size-sm stg-progress__cta"
						href={setupActionHref(next, profile.handle)}
					>
						<span class="ui-button__label">{SETUP_ACTION_LABEL[next]}</span>
					</a>
				)
				: null}
		</section>
	);
}
