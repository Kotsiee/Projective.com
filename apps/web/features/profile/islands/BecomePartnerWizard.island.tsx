import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { Alert } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { MAX_STARTER_SKILLS, type StarterSkillOption } from "@projective/types/user";
import { unlockFreelancer } from "../core/partner-service.ts";
import "../styles/become-partner.css";

/**
 * BecomePartnerWizard — the `/become-partner` conversion surface (`PRODUCT_SPEC.md` §Additive,
 * Unlockable Personas): one decision (the starter skills) and one action ("Unlock Freelancer Suite").
 *
 * Laid out on the §B.4 separation toolkit, nothing boxed: the pitch sits on the canvas, what unlocks
 * is a plain list carried by type and spacing, and the one region a person acts in steps to the solid
 * `--surface-1` tone. The skill pills are the only contoured things on the page, because they are the
 * only things that can be pressed (§B.11.1).
 *
 * Dumb by contract: the skills arrive as props from the server controller, and the unlock is the
 * `partner-service` sequence (convert → re-mint the session → hard navigation to `/[handle]/edit`).
 * While that runs the action stays busy through the navigation — flipping it back to idle for the last
 * frames would offer a control that can no longer do anything.
 */

// #region Props
export interface BecomePartnerWizardProps {
	/** The person already holds a seller profile — show the way forward, not a form. */
	alreadySeller: boolean;
	/** Their profile editor (`/[handle]/edit`), when the person's handle is known. */
	editPath: string | null;
	/** The `org.skills` taxonomy, by label. */
	skills: StarterSkillOption[];
	/** Why the taxonomy could not be read, or `null`. */
	skillsError: string | null;
}
// #endregion

// #region Static copy
/** What the freelancer suite adds — the surfaces the conversion un-gates in the chrome. */
const UNLOCKS: ReadonlyArray<{ title: string; body: string }> = [
	{ title: "Services and products", body: "Publish what you sell and take orders from buyers." },
	{ title: "Teams", body: "Form a team with other freelancers and take on larger work together." },
	{ title: "Payouts", body: "Get paid into your wallet as stages are approved and released." },
];
// #endregion

export default function BecomePartnerWizard(props: BecomePartnerWizardProps): JSX.Element {
	const { alreadySeller, editPath, skills, skillsError } = props;
	const selected = useSignal<string[]>([]);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const unlocked = useSignal(false);
	const count = useComputed(() => selected.value.length);
	const atLimit = useComputed(() => count.value >= MAX_STARTER_SKILLS);

	function toggle(slug: string) {
		if (busy.value) return;
		const current = selected.value;
		if (current.includes(slug)) {
			selected.value = current.filter((s) => s !== slug);
		} else if (current.length < MAX_STARTER_SKILLS) {
			selected.value = [...current, slug];
		}
		error.value = null;
	}

	async function submit(event: JSX.TargetedEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy.value || count.value === 0) return;
		busy.value = true;
		error.value = null;
		const outcome = await unlockFreelancer({ skills: selected.value });
		if (outcome.ok) {
			globalThis.location.assign(outcome.destination);
			return;
		}
		unlocked.value = outcome.unlocked === true;
		error.value = outcome.fieldError ? `${outcome.message} ${outcome.fieldError}` : outcome.message;
		busy.value = false;
	}

	return (
		<div class="bp">
			<header class="bp__intro">
				<p class="bp__eyebrow">Become a Partner</p>
				<h1 id="bp-title" class="bp__title">Sell your skills on Projective</h1>
				<p class="bp__lede">
					Add a freelancer profile to the account you already have. Your name, reviews and wallet
					stay the same, and you can switch back to buying at any time from the account menu.
				</p>
			</header>

			<section class="bp__unlocks" aria-labelledby="bp-unlocks-title">
				<h2 id="bp-unlocks-title" class="bp__section-title">What you unlock</h2>
				<ul class="bp__unlock-list">
					{UNLOCKS.map((item) => (
						<li key={item.title} class="bp__unlock">
							<span class="bp__unlock-title">{item.title}</span>
							<span class="bp__unlock-body">{item.body}</span>
						</li>
					))}
				</ul>
				<p class="bp__meta">Free · no rate to set · your client account is unchanged</p>
			</section>

			{alreadySeller
				? (
					<section class="bp__panel" aria-labelledby="bp-done-title">
						<h2 id="bp-done-title" class="bp__section-title">Your freelancer suite is unlocked</h2>
						<p class="bp__hint">
							Finish your profile — a photo, a headline and story, and at least three skills — to go
							live and start selling.
						</p>
						{editPath
							? (
								<a
									class="ui-button ui-button--primary ui-button--filled ui-button--size-lg bp__action"
									href={editPath}
								>
									Set up your profile
								</a>
							)
							: null}
					</section>
				)
				: (
					<form class="bp__panel" onSubmit={submit} aria-labelledby="bp-skills-title" noValidate>
						<div class="bp__panel-head">
							<h2 id="bp-skills-title" class="bp__section-title">Choose your starter skills</h2>
							<p class="bp__count" aria-live="polite">
								<span class="bp__count-figure">{count.value}</span> of {MAX_STARTER_SKILLS} chosen
							</p>
						</div>
						<p id="bp-skills-hint" class="bp__hint">
							Buyers find you by these. Pick up to{" "}
							{MAX_STARTER_SKILLS}; you can change them on your profile later.
						</p>

						{skillsError
							? <Alert severity="warning" title="Skills unavailable" description={skillsError} />
							: (
								<div
									class="bp__skills"
									role="group"
									aria-labelledby="bp-skills-title"
									aria-describedby="bp-skills-hint"
								>
									{skills.map((skill) => {
										const on = selected.value.includes(skill.slug);
										const locked = !on && atLimit.value;
										return (
											<button
												key={skill.slug}
												type="button"
												class="bp__skill"
												aria-pressed={on}
												aria-disabled={locked || busy.value}
												onClick={() => !locked && toggle(skill.slug)}
											>
												{skill.label}
											</button>
										);
									})}
								</div>
							)}

						{atLimit.value
							? (
								<p class="bp__hint" role="status">
									That's {MAX_STARTER_SKILLS} — remove one to choose another.
								</p>
							)
							: null}

						{error.value
							? (
								<Alert
									severity={unlocked.value ? "warning" : "danger"}
									title={unlocked.value ? "Almost there" : "Not unlocked"}
									description={error.value}
									actions={unlocked.value
										? (
											<Button
												type="button"
												variant="outlined"
												size="sm"
												label="Reload"
												onClick={() => globalThis.location.reload()}
											/>
										)
										: undefined}
								/>
							)
							: null}

						<div class="bp__actions">
							<Button
								type="submit"
								size="lg"
								label={busy.value ? "Unlocking…" : "Unlock Freelancer Suite"}
								loading={busy.value}
								disabled={count.value === 0 || skillsError !== null}
								aria-describedby={count.value === 0 ? "bp-skills-hint" : undefined}
							/>
						</div>
					</form>
				)}
		</div>
	);
}
