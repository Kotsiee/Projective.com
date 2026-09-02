import type { ComponentChildren, JSX, VNode } from "preact";
import { type FieldStatus, FormControl, useFieldValidation } from "@projective/ui/fields";
import {
	FIELD_TIER_MEANING,
	type FieldTier,
	fieldTier,
	type ProjectWizardField,
} from "../../types/projects-types.ts";
import { problemFor, wizardDraft, wizardProblems, wizardReveal } from "../../core/wizard-state.ts";

/**
 * WizardField — the one place the creation wizard decides whether a control paints, and which of the
 * two colours it is allowed to use.
 *
 * Every control on the surface goes through here, because "when does a field turn red" is an
 * accessibility decision (`required` and `invalid` also set `aria-invalid`) and twenty-five controls
 * answering it privately is twenty-five chances to announce an error before the reader has had a
 * turn. The rule itself lives in `@projective/ui/fields` — {@link useFieldValidation} — and this
 * wrapper supplies only the wizard's problem source and its tier-to-status mapping.
 *
 * **Two statuses, never five.** A `T1` blocker paints `required` (the RED creation gate) and a `T2`
 * paints `gate` (the AMBER publishing gate); those are the two ramps the theme has token backing
 * for. `T3`–`T5` paint NOTHING — they contribute hint copy and nothing else, which is the whole of
 * what the tier taxonomy is allowed to drive on screen.
 *
 * **Touch is tracked on the WRAPPER, not on the control.** Only `InputText` declares `onFocus` /
 * `onBlur`; `Select`, `Chips`, `MultiSelect`, `InputNumber`, `SelectButton`, `ToggleSwitch`,
 * `DatePicker` and `RichTextEditor` all take the shared field props, which carry neither. A policy
 * that depended on each control forwarding a handler would therefore hold for exactly one of them
 * and silently fail for the rest. `focusin`/`focusout` bubble, so one pair on the wrapper answers
 * for whatever it contains — including a control whose focusable element is nested three levels
 * down.
 *
 * **Two message channels, deliberately.** A blocker's message is an `error` on {@link FormControl},
 * so it announces through `role="alert"` and reads as a refusal. A gate's message is a `hint`, which
 * renders unconditionally — `FormControl` surfaces `error` only for `invalid`/`required`, so a gate
 * message routed through `error` would paint the control amber and then say nothing about why.
 */

// #region Shapes
/** What a wizard control is handed once its label, ids and verdict have been resolved. */
export interface WizardControlArgs {
	/** Wire onto the control's `id`. */
	id: string;
	/** Wire onto the control's `aria-describedby`. */
	describedBy: string | undefined;
	/** The CONTROL's status — cleared while the field holds focus, so the focus ring stands alone. */
	status: FieldStatus;
}

export interface WizardFieldProps {
	/** Which payload field this control writes — the key its tier and its problem are looked up by. */
	field: ProjectWizardField;
	/** The stage it belongs to, for a per-stage control; omitted for a project-level one. */
	stageKey?: string | null;
	/** Visible label. */
	label: string;
	/** Advisory copy shown while nothing is outstanding. */
	hint?: string;
	/** Override the required marker; defaults to whether the tier blocks the step. */
	required?: boolean;
	children: (args: WizardControlArgs) => VNode;
}
// #endregion

// #region Tier copy
/**
 * The hint a tier contributes, ahead of the caller's own.
 *
 * `T1` and `T2` say nothing here: their status ramp and their message already state how badly the
 * field is wanted, and a word repeating it would be a third channel for one fact. `T3`–`T5` have no
 * ramp at all, so the word IS the signal — rendered as inline middot-separated prose rather than as
 * a pill, because a pill is a promise of interactivity and "Recommended" cannot be pressed.
 */
export function tierHint(tier: FieldTier, hint?: string): string | undefined {
	if (tier === "T1" || tier === "T2") return hint;
	const meaning = FIELD_TIER_MEANING[tier];
	return hint ? `${meaning} · ${hint}` : meaning;
}
// #endregion

// #region The wrapper
export function WizardField(props: WizardFieldProps): JSX.Element {
	const stageKey = props.stageKey ?? null;
	const tier = fieldTier(props.field, wizardDraft.value.format);
	const blocking = tier === "T1";
	const gating = tier === "T2";

	const validation = useFieldValidation({
		// A predicate rather than a value, so it subscribes to the problem list and re-runs whenever
		// the answer it is judging changes rather than once at mount.
		problem: () =>
			blocking || gating ? problemFor(wizardProblems.value, props.field, stageKey) : null,
		reveal: wizardReveal,
		problemStatus: blocking ? "required" : "gate",
	});

	const message = validation.message.value;
	const hint = tierHint(tier, props.hint);

	return (
		<div
			class="pwz-field"
			onFocusIn={validation.handlers.onFocus}
			onFocusOut={validation.handlers.onBlur}
		>
			<FormControl
				label={props.label}
				required={props.required ?? blocking}
				status={validation.hintStatus.value}
				error={blocking ? message ?? undefined : undefined}
				hint={blocking ? hint : message ?? hint}
			>
				{({ id, describedBy }) =>
					props.children({ id, describedBy, status: validation.status.value })}
			</FormControl>
		</div>
	);
}
// #endregion

// #region Layout primitives
/**
 * One row of the step panel — two controls side by side above the fold, stacked below it.
 *
 * A grid rather than a flex row so a control that grows its message does not drag its neighbour's
 * baseline with it.
 */
export function WizardRow(props: { children: ComponentChildren }): JSX.Element {
	return <div class="pwz-row">{props.children}</div>;
}

/**
 * A sentence explaining what the surface is about to do on the author's behalf.
 *
 * Never boxed (§B.4): separation is spacing and a single hairline, and prose in a card is the
 * card-in-card the design system forbids.
 */
export function WizardNote(props: { children: ComponentChildren }): JSX.Element {
	return <p class="pwz-note">{props.children}</p>;
}

/** One labelled group of controls inside a step. Separated by spacing, never a box. */
export function WizardGroup(
	props: { title: string; hint?: string; children: ComponentChildren },
): JSX.Element {
	return (
		<section class="pwz-group">
			<div class="pwz-group__head">
				<h3 class="pwz-group__title">{props.title}</h3>
				{props.hint && <p class="pwz-group__hint">{props.hint}</p>}
			</div>
			<div class="pwz-group__body">{props.children}</div>
		</section>
	);
}
// #endregion
