import type { ComponentChildren, JSX } from "preact";
import { HintPopover } from "@projective/ui/feedback";

/** Props for {@link FieldHead}. */
export interface FieldHeadProps {
	label: string;
	/** The control's id, so the label is a real `<label for>`; omit for a group the control names itself. */
	htmlFor?: string;
	/** Hide the visible label from assistive tech when the control carries the same `aria-label`. */
	decorative?: boolean;
	/** What the field means, behind a "?" beside the label (Decision #305). */
	hint?: ComponentChildren;
	/** The id the control's `aria-describedby` points at; the hint stays in the DOM under it. */
	hintId?: string;
	/** Trailing controls in the row: a counter, a switch. */
	children?: ComponentChildren;
}

/**
 * FieldHead — an Edit field's label row: the label, its `HintPopover` "?" and any trailing control,
 * with the hint kept visually hidden under `hintId` so the description always resolves. Live
 * feedback — a figure, a refusal, an empty state — stays a visible line under the control instead.
 */
export function FieldHead(props: FieldHeadProps): JSX.Element {
	const { label, htmlFor, decorative, hint, hintId, children } = props;
	return (
		<>
			<div class="cat-sec__labelrow">
				<span class="cat-sec__labelgroup">
					{htmlFor
						? <label class="cat-sec__label" for={htmlFor}>{label}</label>
						: (
							<span class="cat-sec__label" aria-hidden={decorative ? "true" : undefined}>
								{label}
							</span>
						)}
					{hint && <HintPopover label={`About ${label.toLowerCase()}`}>{hint}</HintPopover>}
				</span>
				{children}
			</div>
			{hint && hintId && <span id={hintId} class="ui-visually-hidden">{hint}</span>}
		</>
	);
}

/**
 * ToggleHint — a switch whose own label names it, with its explanation behind a "?" beside it and
 * kept visually hidden under `hintId` for the switch's `aria-describedby`.
 */
export function ToggleHint(
	props: { label: string; hint: ComponentChildren; hintId: string; children: ComponentChildren },
): JSX.Element {
	return (
		<>
			<div class="cat-sec__togglerow">
				{props.children}
				<HintPopover label={`About ${props.label.toLowerCase()}`}>{props.hint}</HintPopover>
			</div>
			<span id={props.hintId} class="ui-visually-hidden">{props.hint}</span>
		</>
	);
}
