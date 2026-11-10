import type { JSX } from "preact";
import type { Ref } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import { FormControl, type Option, SelectButton } from "@projective/ui/fields";
import {
	PROJECT_TYPE_HINT,
	PROJECT_TYPE_LABEL,
	ProjectTypeChoice,
} from "../types/projects-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ProjectCreateTypeCards — the type control in both of {@link ProjectCreateModal}'s pacings (a
 * segmented control on the single screen, glyph cards on the profile's type step), and the
 * read-only invited-freelancer row. Pure renderers: every choice is handed back to the modal, which
 * owns the form state and the step it is on.
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

const TYPE_OPTIONS: Option[] = TYPE_CARDS.map((value) => ({
	value,
	label: PROJECT_TYPE_LABEL[value],
}));

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
				class="pjc__types"
				role="group"
				aria-label="Project type"
			>
				{TYPE_CARDS.map((value) => (
					<button
						key={value}
						type="button"
						data-type={value}
						class="pjc__type"
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
			{error && <p class="ui-field-hint ui-field-hint--error" role="alert">{error}</p>}
		</>
	);
}
// #endregion

// #region The single flow's segmented control
/** Props for {@link TypeSelect}. */
export interface TypeSelectProps {
	picked: ProjectTypeChoice;
	onPick: (value: ProjectTypeChoice) => void;
	error?: string;
}

/** The type as one field among the others on the single-screen flow; its sentence sits behind "?". */
export function TypeSelect({ picked, onPick, error }: TypeSelectProps): JSX.Element {
	return (
		<FormControl
			label="Project type"
			hint={PROJECT_TYPE_HINT[picked]}
			status={error ? "invalid" : "default"}
			error={error}
		>
			{({ describedBy }) => (
				<SelectButton
					aria-label="Project type"
					aria-describedby={describedBy}
					options={TYPE_OPTIONS}
					value={picked}
					onValueChange={(next) => {
						const parsed = ProjectTypeChoice.safeParse(next);
						if (parsed.success) onPick(parsed.data);
					}}
					status={error ? "invalid" : "default"}
					fluid
				/>
			)}
		</FormControl>
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
			<span class="ui-field-label" id={INVITE_ID}>Invited freelancer</span>
			<div class="pjc__invitee" aria-labelledby={INVITE_ID}>
				<UserAvatar image={avatar ?? undefined} label={name} shape="circle" size="sm" />
				<span class="pjc__invitee-text">
					<span class="pjc__invitee-name">{name}</span>
					<span class="pjc__invitee-handle">{handle}</span>
				</span>
			</div>
		</div>
	);
}
// #endregion
