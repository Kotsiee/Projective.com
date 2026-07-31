import type { JSX } from "preact";
import "../styles/backdrop.css";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link Backdrop}. */
export interface BackdropProps {
	/** When `true` the scrim is opaque and interactive; `false` fades it out and lets clicks through. */
	visible: boolean;
	/** Invoked when the scrim itself is clicked (typically dismisses the owning overlay). */
	onClick?: (event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
	/** Extra class(es) merged onto the scrim. */
	class?: string;
}
// #endregion

/**
 * Backdrop — the severity-neutral dimming scrim behind a modal surface. Purely presentational
 * (`aria-hidden`); it fades via a token-duration transition driven by `[data-state]` and is
 * click-through while closed so it never blocks the page after an exit. Reduced-motion collapses the
 * fade globally through the duration tokens.
 *
 * Tint and blur are fixed by `--tint-heavy` / `--scrim-blur` and are deliberately NOT configurable:
 * how hard the page dims is a property of "a modal is open", not of which surface opened it.
 */
export function Backdrop(props: BackdropProps): JSX.Element {
	const { visible, onClick, class: className } = props;
	return (
		<div
			class={cx("ui-backdrop", className)}
			data-state={visible ? "open" : "closed"}
			aria-hidden="true"
			onClick={onClick}
		/>
	);
}
