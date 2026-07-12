import type { ComponentChildren, JSX } from "preact";
import "../styles/kbd.css";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link Kbd}. */
export interface KbdProps {
	/** Keys rendered as individual chips joined by a combiner (e.g. `["Ctrl", "K"]`). */
	keys?: string[];
	/** Combiner rendered between chips (default `+`). */
	separator?: string;
	/** Size ramp (default `md`). */
	size?: "sm" | "md";
	/** Raw content when not using `keys` (rendered as a single chip). */
	children?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * Kbd — a keyboard-shortcut hint. Renders each key as a `<kbd>` chip joined by a `+` combiner, or a
 * single chip from `children`. Purely presentational; the surrounding control owns the accessible
 * name, so the combiner glyph is `aria-hidden` to avoid noisy screen-reader output.
 */
export function Kbd(props: KbdProps): JSX.Element {
	const { keys, separator = "+", size = "md", children, class: className } = props;

	return (
		<span class={cx("ui-kbd", `ui-kbd--${size}`, className)}>
			{keys
				? keys.map((key, i) => (
					<>
						{i > 0 && <span class="ui-kbd__sep" aria-hidden="true">{separator}</span>}
						<kbd class="ui-kbd__key">{key}</kbd>
					</>
				))
				: <kbd class="ui-kbd__key">{children}</kbd>}
		</span>
	);
}
