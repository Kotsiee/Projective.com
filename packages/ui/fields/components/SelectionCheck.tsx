import type { JSX } from "preact";
import "../styles/selection-check.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";

/** Props for {@link SelectionCheck}. */
export interface SelectionCheckProps {
	/** Whether the thing it marks is selected. */
	checked: boolean;
	/** `md` (default) is 20px, for a tile corner; `sm` is 16px, for a list row. */
	size?: "sm" | "md";
	class?: string;
}

/**
 * SelectionCheck — the circular selected-state mark: a hollow `--outline` ring when unselected, a
 * solid `--primary` disc with an `--on-primary` tick when selected. Decorative (`aria-hidden`); the
 * control that wraps it owns the name and the state (`role="checkbox"` + `aria-checked`, or
 * `aria-pressed`). A consumer may hide the unselected ring until hover, focus or an active selection.
 */
export function SelectionCheck(
	{ checked, size = "md", class: className }: SelectionCheckProps,
): JSX.Element {
	return (
		<span
			class={cx("ui-selection-check", `ui-selection-check--${size}`, className)}
			data-checked={checked ? "true" : undefined}
			aria-hidden="true"
		>
			<Icon name="check" class="ui-selection-check__tick" />
		</span>
	);
}
