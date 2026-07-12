import type { ComponentChildren, JSX } from "preact";
import "../styles/float-label.css";
import { cx } from "../../core/cx.ts";

export type FloatLabelVariant = "over" | "in" | "on";

export interface FloatLabelProps {
	/** The label text, associated to the wrapped control via `for`. */
	label: string;
	/** Id of the control the label describes (must match the input's `id`). */
	for: string;
	/**
	 * Float behaviour (PrimeNG parity):
	 *  - `over` — label rests over the input, floats up on focus/fill (default).
	 *  - `in`   — label sits inside the field, shrinks to the top on focus/fill.
	 *  - `on`   — label rides on the top border when floated.
	 */
	variant?: FloatLabelVariant;
	class?: string;
	children?: ComponentChildren;
}

/**
 * FloatLabel — floating-label mechanics via pure CSS. Wrap a control and its label floats from the
 * placeholder position to the top when the control is focused or non-empty. Uses the `:focus-within`
 * + `:placeholder-shown` sibling trick so no client JS is required; the control must render a
 * placeholder of `" "` for the empty-state detection (its own placeholder should be omitted).
 */
export function FloatLabel(props: FloatLabelProps): JSX.Element {
	const { label, for: htmlFor, variant = "over", class: className, children } = props;
	return (
		<span class={cx("ui-float-label", `ui-float-label--${variant}`, className)}>
			{children}
			<label class="ui-float-label__label" for={htmlFor}>{label}</label>
		</span>
	);
}
