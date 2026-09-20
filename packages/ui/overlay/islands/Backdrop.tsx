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
	/**
	 * Which of the two scrim tiers to draw (default `standard`).
	 *
	 * `standard` means "a modal is open". `heavy` means "the page beneath cannot be used right now"
	 * — the offline interstitial is the one surface that says so — and dims and blurs harder to make
	 * that legible before the copy is read. It is a TIER chosen by what the modal means, not a knob:
	 * the per-surface blur prop was removed for drift (§B.10.2) and this does not reintroduce it.
	 */
	intensity?: "standard" | "heavy";
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
 * Tint and blur are fixed by `--scrim-tint` / `--scrim-blur` and are deliberately NOT configurable
 * per call site: how hard the page dims is a property of "a modal is open", not of which surface
 * opened it. The one sanctioned step above that is the `heavy` {@link BackdropProps.intensity} tier,
 * which reads its own pair of tokens (`--scrim-tint-heavy` / `--scrim-blur-heavy`) and exists for a
 * modal whose subject is that the page beneath is unusable.
 */
export function Backdrop(props: BackdropProps): JSX.Element {
	const { visible, onClick, intensity = "standard", class: className } = props;
	return (
		<div
			class={cx("ui-backdrop", intensity === "heavy" && "ui-backdrop--heavy", className)}
			data-state={visible ? "open" : "closed"}
			aria-hidden="true"
			onClick={onClick}
		/>
	);
}
