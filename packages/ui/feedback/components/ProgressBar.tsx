/**
 * ProgressBar — a linear progress track. `mode="determinate"` (default) shows a `value` (0-100)
 * fill, optionally with a numeric label (`showValue`); `mode="indeterminate"` shows a looping token
 * animation with no known completion. Zero-JS server component — `value` is a plain prop, not a
 * signal; wrap it in a signal-backed parent if you need it to animate live.
 */
import type { JSX } from "preact";
import "../styles/progress-bar.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../../fields/types/mod.ts";

// #region Props
export type ProgressBarMode = "determinate" | "indeterminate";

export interface ProgressBarProps {
	/** Completion percentage, `0`-`100`. Ignored (and required) only for `determinate` mode. */
	value?: number;
	/** Track mode (default `determinate`). */
	mode?: ProgressBarMode;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Render the numeric percentage inside the track (determinate only). */
	showValue?: boolean;
	/** Accessible label for the track when no visible caption is nearby. */
	"aria-label"?: string;
	id?: string;
	class?: string;
}
// #endregion

/** Clamp to the valid `[0, 100]` percentage range. */
function clampPercent(v: number): number {
	return Math.min(100, Math.max(0, v));
}

export function ProgressBar(props: ProgressBarProps): JSX.Element {
	const {
		value = 0,
		mode = "determinate",
		severity = "primary",
		showValue = false,
		"aria-label": ariaLabel,
		id,
		class: className,
	} = props;

	const pct = clampPercent(value);
	const indeterminate = mode === "indeterminate";

	return (
		<div
			id={id}
			class={cx(
				"ui-progressbar",
				`ui-progressbar--${severity}`,
				indeterminate && "ui-progressbar--indeterminate",
				className,
			)}
			role="progressbar"
			aria-label={ariaLabel}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={indeterminate ? undefined : pct}
			aria-busy={indeterminate || undefined}
		>
			<div
				class="ui-progressbar__track"
				style={indeterminate ? undefined : styleVars({ "--progressbar-value": `${pct}%` })}
			>
				{indeterminate && <div class="ui-progressbar__indicator" />}
			</div>
			{showValue && !indeterminate && <span class="ui-progressbar__label">{Math.round(pct)}%</span>}
		</div>
	);
}
