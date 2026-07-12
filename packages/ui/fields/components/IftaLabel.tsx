import type { ComponentChildren, JSX } from "preact";
import "../styles/ifta-label.css";
import { cx } from "../../core/cx.ts";

export interface IftaLabelProps {
	/** Label text, associated to the control via `for`. */
	label: string;
	/** Id of the control the label describes. */
	for: string;
	class?: string;
	children?: ComponentChildren;
}

/**
 * IftaLabel — "in-field top-aligned" label (PrimeNG parity). The label sits permanently at the top
 * inside the field's border, with the input value below it. Unlike FloatLabel it never animates: the
 * label is always compact and top-aligned, giving a denser two-line field. Pure CSS; the wrapped
 * control should use extra top padding (handled here via a scoped custom property).
 */
export function IftaLabel(props: IftaLabelProps): JSX.Element {
	const { label, for: htmlFor, class: className, children } = props;
	return (
		<span class={cx("ui-ifta-label", className)}>
			{children}
			<label class="ui-ifta-label__label" for={htmlFor}>{label}</label>
		</span>
	);
}
