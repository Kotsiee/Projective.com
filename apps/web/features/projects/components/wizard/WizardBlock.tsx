import type { ComponentChildren, JSX } from "preact";
import { useId } from "@projective/ui/fields";
import { fieldTier, type ProjectWizardField } from "../../types/projects-types.ts";
import { tierHint } from "./WizardField.tsx";
import { wizardDraft } from "../../core/wizard-state.ts";

/**
 * WizardBlock — a labelled region for a COMPOSITE control, where {@link WizardField} would be wrong.
 *
 * `FormControl` renders a real `<label for={id}>`, which is correct for every control that exposes
 * one focusable element and takes an `id`. A step list, a role list or a chip cluster does not: it
 * has several focusable elements and no single thing the label can point at, and a `for` aimed at an
 * id nothing carries is a label that resolves to nothing — a broken association a type-checker
 * cannot see.
 *
 * So the label here is a `<span>` and the region is a `role="group"` named by it, which is the
 * pattern a composite actually wants. It reuses the package's own `ui-field-label` / `ui-field-hint`
 * classes rather than restating their type ramp, so a block sits in a column of `FormControl`s
 * without announcing that it is a different kind of thing.
 *
 * It carries the same tier COPY as a tiered field — `T3`–`T5` contribute their meaning as prose —
 * but never a status ramp: nothing composite here can be outstanding in a way one outline could
 * describe.
 */

// #region Props
export interface WizardBlockProps {
	/** The payload field this region writes, when it has one — supplies the tier's hint copy. */
	field?: ProjectWizardField;
	/** Visible label. Rendered as a `<span>` and used as the region's accessible name. */
	label: string;
	/** Advisory copy shown beneath the region. */
	hint?: string;
	children: ComponentChildren;
}
// #endregion

export function WizardBlock(props: WizardBlockProps): JSX.Element {
	const rootId = useId(undefined, "wizblock");
	const labelId = `${rootId}-label`;
	const hintId = `${rootId}-hint`;
	const hint = props.field
		? tierHint(fieldTier(props.field, wizardDraft.value.format), props.hint)
		: props.hint;

	return (
		<div class="ui-form-control pwz-field">
			<span class="ui-field-label" id={labelId}>{props.label}</span>
			<div
				class="ui-form-control__control"
				role="group"
				aria-labelledby={labelId}
				aria-describedby={hint ? hintId : undefined}
			>
				{props.children}
			</div>
			<p id={hintId} class="ui-field-hint">{hint}</p>
		</div>
	);
}
