/**
 * ProgressSpinner — an indeterminate circular loader (SVG stroke-dash sweep). Use for "working, no
 * known completion" states; see {@link ProgressRing} for a determinate circular equivalent. Under
 * reduced-motion the sweep collapses to a static partial ring.
 */
import type { JSX } from "preact";
import "../styles/progress-spinner.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../../fields/types/mod.ts";

// #region Props
export interface ProgressSpinnerProps {
	/** Diameter in px (default `48`). */
	size?: number;
	/** Stroke thickness in px (default `4`). */
	strokeWidth?: number;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Accessible label (default `"Loading"`). */
	"aria-label"?: string;
	id?: string;
	class?: string;
}
// #endregion

export function ProgressSpinner(props: ProgressSpinnerProps): JSX.Element {
	const {
		size = 48,
		strokeWidth = 4,
		severity = "primary",
		"aria-label": ariaLabel = "Loading",
		id,
		class: className,
	} = props;

	const radius = (size - strokeWidth) / 2;

	return (
		<span
			id={id}
			class={cx("ui-progress-spinner", `ui-progress-spinner--${severity}`, className)}
			role="progressbar"
			aria-label={ariaLabel}
			aria-busy="true"
			style={styleVars({ "--spinner-size": `${size}px` })}
		>
			{
				/* `pathLength={100}` normalises the dash units to a 0-100 scale regardless of the
				 radius, so the fixed `stroke-dasharray="75 100"` always reads as a 3/4 arc. */
			}
			<svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} class="ui-progress-spinner__svg">
				<circle
					class="ui-progress-spinner__track"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={strokeWidth}
					fill="none"
					pathLength={100}
				/>
				<circle
					class="ui-progress-spinner__arc"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={strokeWidth}
					fill="none"
					stroke-linecap="round"
					stroke-dasharray="75 100"
					pathLength={100}
				/>
			</svg>
		</span>
	);
}
