/**
 * Spinner — a small inline loading indicator (SVG arc), for use inside buttons, inline text, or list
 * rows where {@link ProgressSpinner}'s larger default footprint doesn't fit. `Loader` wraps it as a
 * block with an optional caption, for full-section/page loading states.
 */
import type { ComponentChildren, JSX } from "preact";
import "../styles/spinner.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../../fields/types/mod.ts";

// #region Spinner
export interface SpinnerProps {
	/** Diameter in px (default `20`, inline-text scale). */
	size?: number;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Accessible label (default `"Loading"`). */
	"aria-label"?: string;
	id?: string;
	class?: string;
}

/** Inline spinner — `role="progressbar"`/`aria-busy`, honours reduced-motion (static arc). */
export function Spinner(props: SpinnerProps): JSX.Element {
	const {
		size = 20,
		severity = "primary",
		"aria-label": ariaLabel = "Loading",
		id,
		class: className,
	} = props;
	const stroke = Math.max(2, Math.round(size / 8));
	const radius = (size - stroke) / 2;

	return (
		<span
			id={id}
			class={cx("ui-spinner", `ui-spinner--${severity}`, className)}
			role="progressbar"
			aria-label={ariaLabel}
			aria-busy="true"
			style={styleVars({ "--spinner-size": `${size}px` })}
		>
			<svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} class="ui-spinner__svg">
				<circle
					class="ui-spinner__track"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={stroke}
					fill="none"
					pathLength={100}
				/>
				<circle
					class="ui-spinner__arc"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={stroke}
					fill="none"
					stroke-linecap="round"
					stroke-dasharray="70 100"
					pathLength={100}
				/>
			</svg>
		</span>
	);
}
// #endregion

// #region Loader
export interface LoaderProps {
	/** Caption below the spinner, e.g. `"Loading projects…"`. */
	label?: ComponentChildren;
	/** Spinner diameter in px (default `28`). */
	size?: number;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	id?: string;
	class?: string;
}

/** Block-level loading wrapper: centered spinner + optional caption, for section/page-level waits. */
export function Loader(props: LoaderProps): JSX.Element {
	const { label, size = 28, severity = "primary", id, class: className } = props;

	return (
		<div id={id} class={cx("ui-loader", className)} role="status" aria-live="polite">
			<Spinner
				size={size}
				severity={severity}
				aria-label={typeof label === "string" ? label : "Loading"}
			/>
			{label !== undefined && <span class="ui-loader__label">{label}</span>}
		</div>
	);
}
// #endregion
