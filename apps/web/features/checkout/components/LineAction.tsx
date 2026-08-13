import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";

/**
 * LineAction — the quiet Remove / Save-for-later control, everywhere on the basket surface.
 *
 * ## Why this exists rather than `@projective/ui`'s `Button`
 *
 * These two verbs appear at four levels of the same page — on a product row, on a shelf card, on an
 * engagement's header, and again on every ticket or session inside it. The package's `text` Button
 * carries the field ramp's inline padding and minimum height, which is correct for a control that
 * stands alone and wrong for one that has to sit optically flush under the text it acts on: at four
 * nesting depths the accumulated padding was the difference between a tidy sub-action and a row of
 * floating chips. The design asks for a **text link with a glyph, zero padding, and colour as the only
 * hover channel**, which is a different control, so it is a different component rather than a Button
 * fought with overrides.
 *
 * ## What it still has to get right
 *
 * - **A real `<button>`.** It is an action, not a navigation, so it is focusable, Enter/Space
 *   activated and announced as a button for free.
 * - **The accessible name CONTAINS the visible words.** `aria-label` is composed as
 *   `"{label} — {subject}"`, never a rewording, so speech control can address the control a reader can
 *   see (WCAG 2.5.3 "label in name"). Passing a `subject` is what disambiguates four identical
 *   "Remove"s on one screen.
 * - **A 24px hit target without 24px of padding.** Zero padding is the design requirement, so the
 *   target is restored with a `::after` overlay (`.ui-hit`, the package's own answer to this exact
 *   trade) rather than by growing the box and breaking the flush alignment.
 * - **Colour transitions, nothing else.** No transform, no background — a frozen animation clock
 *   leaves a fully legible control.
 */

// #region Props
/** Props for {@link LineAction}. */
export interface LineActionProps {
	/** The visible words. Also the first half of the accessible name. */
	label: string;
	icon: IconName;
	/** What the action acts ON — a line title, an engagement name. Disambiguates repeated verbs. */
	subject: string;
	/** Whether a write is in flight for the thing this acts on. */
	disabled?: boolean;
	/** Paints the control on the danger ramp on hover. Removal is the only destructive verb here. */
	danger?: boolean;
	/** Steps the control down a type size, for the sub-actions beneath a ticket or session row. */
	compact?: boolean;
	onClick: () => void;
}
// #endregion

export function LineAction(props: LineActionProps): JSX.Element {
	return (
		<button
			type="button"
			class="bsk-act ui-hit"
			data-danger={props.danger ? "true" : undefined}
			data-compact={props.compact ? "true" : undefined}
			disabled={props.disabled}
			aria-label={`${props.label} — ${props.subject}`}
			onClick={props.onClick}
		>
			<Icon name={props.icon} size={props.compact ? "2xs" : "xs"} />
			<span class="bsk-act__label">{props.label}</span>
		</button>
	);
}

// #region Presets
/**
 * The two verbs, spelled once.
 *
 * Every call site on this surface uses these rather than passing its own strings, because the labels
 * are half of each control's accessible name and four spellings of "Save for later" is four different
 * things to say to a voice-control user.
 */
export function RemoveAction(
	props: { subject: string; disabled?: boolean; compact?: boolean; onClick: () => void },
): JSX.Element {
	return (
		<LineAction
			label="Remove"
			icon="trash"
			danger
			subject={props.subject}
			disabled={props.disabled}
			compact={props.compact}
			onClick={props.onClick}
		/>
	);
}

/** Park a line, or bring it back. One control, two directions, so the glyph follows the verb. */
export function ParkAction(
	props: {
		subject: string;
		parked?: boolean;
		disabled?: boolean;
		compact?: boolean;
		onClick: () => void;
	},
): JSX.Element {
	return (
		<LineAction
			label={props.parked ? "Move to basket" : "Save for later"}
			icon={props.parked ? "basket" : "bookmark"}
			subject={props.subject}
			disabled={props.disabled}
			compact={props.compact}
			onClick={props.onClick}
		/>
	);
}
// #endregion
