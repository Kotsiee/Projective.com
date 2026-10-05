import type { JSX } from "preact";
import type { Ref } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	PROJECT_TYPE_HINT,
	PROJECT_TYPE_LABEL,
	ProjectTypeChoice,
} from "../types/projects-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ProjectCreateTypeCards — the type control in both of {@link ProjectCreateModal}'s pacings, and the
 * read-only invited-freelancer row. Pure renderers: every choice and keystroke is handed back to the
 * modal, which owns the form state and the step it is on.
 */

// #region Vocabulary
/** The glyph each type leads with — the registry's own, never a hand-authored `<svg>` (§B.7). */
const TYPE_ICON: Record<ProjectTypeChoice, IconName> = {
	task: "ticket",
	one_off: "submission",
	pipeline: "stages",
};

/** The three cards, derived from the SSOT enum's own members rather than restated. */
export const TYPE_CARDS: readonly ProjectTypeChoice[] = ProjectTypeChoice.options;

/**
 * The type control is a `radiogroup`, which is not a labelable element, so it carries an
 * `aria-labelledby` pointing at its visible heading rather than a `<label for>` that would resolve to
 * nothing (WCAG 2.5.3 holds either way).
 */
const TYPE_LABEL_ID = "pjc-type-label";
const TYPE_HINT_ID = "pjc-type-hint";
const INVITE_ID = "pjc-invite";
// #endregion

// #region The stepped flow's first screen
/** Props for {@link TypeStepCards}. */
export interface TypeStepCardsProps {
	/** The group wrapper — the focus trap's initial scope in `stepped`. */
	cardsRef: Ref<HTMLDivElement>;
	picked: ProjectTypeChoice | null;
	onPick: (value: ProjectTypeChoice) => void;
	/** A field-keyed refusal from the write, if the server named `format`. */
	error?: string;
}

/**
 * The type step. Plain buttons in a `group`, NOT a radiogroup, and the distinction is load-bearing: a
 * radiogroup's selection follows focus, so arrowing across the cards would advance the step on every
 * key — and the shared Enter rule treats an already-chosen radio as "move to the next control", which
 * on the card the reader just stepped Back to would be a dead press. As buttons, Enter and Space are
 * the browser's own activation, and activation is exactly what this step means.
 */
export function TypeStepCards(
	{ cardsRef, picked, onPick, error }: TypeStepCardsProps,
): JSX.Element {
	return (
		<>
			<div
				ref={cardsRef}
				class="pjc__types pjc__types--list"
				role="group"
				aria-label="Project type"
			>
				{TYPE_CARDS.map((value) => (
					<button
						key={value}
						type="button"
						data-type={value}
						class="pjc__type pjc__type--row"
						aria-current={value === picked ? "true" : undefined}
						onClick={() => onPick(value)}
					>
						<span class="pjc__type-glyph" aria-hidden="true">
							<Icon name={TYPE_ICON[value]} size="xl" />
						</span>
						<span class="pjc__type-text">
							<span class="pjc__type-label">{PROJECT_TYPE_LABEL[value]}</span>
							<span class="pjc__type-hint">{PROJECT_TYPE_HINT[value]}</span>
						</span>
					</button>
				))}
			</div>
			{error && <p class="pjc__hint pjc__hint--error">{error}</p>}
		</>
	);
}
// #endregion

// #region The single flow's radiogroup
/** Props for {@link TypeRadioGroup}. */
export interface TypeRadioGroupProps {
	picked: ProjectTypeChoice | null;
	/** Whose hint shows while nothing is picked. */
	fallback: ProjectTypeChoice;
	onPick: (value: ProjectTypeChoice) => void;
	onCardKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number) => void;
	error?: string;
}

/** The type as one field among the others, on the single-screen flow. */
export function TypeRadioGroup(
	{ picked, fallback, onPick, onCardKeyDown, error }: TypeRadioGroupProps,
): JSX.Element {
	return (
		<div class="pjc__field">
			<span class="pjc__label" id={TYPE_LABEL_ID}>Project type</span>
			<div
				class="pjc__types"
				role="radiogroup"
				aria-labelledby={TYPE_LABEL_ID}
				aria-describedby={TYPE_HINT_ID}
			>
				{TYPE_CARDS.map((value, index) => {
					const active = value === picked;
					return (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={active}
							data-type={value}
							class="pjc__type"
							// Roving tabindex: one stop for the whole group, on the chosen card, so Tab
							// steps past the control rather than through it.
							tabIndex={active ? 0 : -1}
							onClick={() => onPick(value)}
							onKeyDown={(e) => onCardKeyDown(e, index)}
						>
							<span class="pjc__type-glyph" aria-hidden="true">
								<Icon name={TYPE_ICON[value]} size="lg" />
							</span>
							<span class="pjc__type-label">{PROJECT_TYPE_LABEL[value]}</span>
						</button>
					);
				})}
			</div>
			<p class="pjc__hint" id={TYPE_HINT_ID}>
				{error ?? PROJECT_TYPE_HINT[picked ?? fallback]}
			</p>
		</div>
	);
}
// #endregion

// #region Invited freelancer
/** Props for {@link InvitedFreelancerField}. */
export interface InvitedFreelancerFieldProps {
	name: string;
	handle: string;
	avatar?: string | null;
}

/**
 * The invited freelancer is CONTEXT, not a control: the modal was opened from this person's profile,
 * so there is no choice left to offer and a picker would only invite the client to contradict the
 * page they came from. It is rendered read-only for the same reason the checkout prints what you are
 * buying — the commitment being made should be legible at the moment it is made.
 */
export function InvitedFreelancerField(
	{ name, handle, avatar }: InvitedFreelancerFieldProps,
): JSX.Element {
	return (
		<div class="pjc__field">
			<span class="pjc__label" id={INVITE_ID}>Invited freelancer</span>
			<div class="pjc__invitee" aria-labelledby={INVITE_ID}>
				<UserAvatar image={avatar ?? undefined} label={name} shape="circle" size="sm" />
				<span class="pjc__invitee-text">
					<span class="pjc__invitee-name">{name}</span>
					<span class="pjc__invitee-handle">{handle}</span>
				</span>
			</div>
			<p class="pjc__hint">
				They are invited from the project's roster once it has a scope and a price.
			</p>
		</div>
	);
}
// #endregion
