/**
 * ProgressRing — a determinate circular progress indicator (SVG). Unlike {@link ProgressSpinner}
 * (indeterminate, looping), the arc length reflects `value` directly and a centered label slot can
 * show the percentage or arbitrary content (via `children`/`labelTemplate`).
 */
import type { ComponentChildren, JSX } from "preact";
import "../styles/progress-spinner.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Severity } from "../../fields/types/mod.ts";

// #region Props
export interface ProgressRingProps {
	/** Completion percentage, `0`-`100`. */
	value: number;
	/** Diameter in px (default `64`). */
	size?: number;
	/** Stroke thickness in px (default `6`). */
	strokeWidth?: number;
	/** Semantic colour ramp (default `primary`). */
	severity?: Severity;
	/** Show the rounded percentage as the center label (ignored if `children`/`labelTemplate` given). */
	showValue?: boolean;
	/** Render-prop for fully custom center content, given the clamped `value`. */
	labelTemplate?: (value: number) => ComponentChildren;
	/** Static center content (overrides `showValue`, overridden by `labelTemplate`). */
	children?: ComponentChildren;
	/** Accessible label (default `"Progress"`). */
	"aria-label"?: string;
	id?: string;
	class?: string;
}
// #endregion

function clampPercent(v: number): number {
	return Math.min(100, Math.max(0, v));
}

export function ProgressRing(props: ProgressRingProps): JSX.Element {
	const {
		value,
		size = 64,
		strokeWidth = 6,
		severity = "primary",
		showValue = false,
		labelTemplate,
		children,
		"aria-label": ariaLabel = "Progress",
		id,
		class: className,
	} = props;

	const pct = clampPercent(value);
	const radius = (size - strokeWidth) / 2;
	const center: ComponentChildren = labelTemplate
		? labelTemplate(pct)
		: children ?? (showValue ? `${Math.round(pct)}%` : undefined);

	return (
		<span
			id={id}
			class={cx("ui-progress-ring", `ui-progress-ring--${severity}`, className)}
			role="progressbar"
			aria-label={ariaLabel}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={pct}
			style={styleVars({ "--ring-size": `${size}px` })}
		>
			<svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} class="ui-progress-ring__svg">
				<circle
					class="ui-progress-ring__track"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={strokeWidth}
					fill="none"
					pathLength={100}
				/>
				<circle
					class="ui-progress-ring__arc"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={strokeWidth}
					fill="none"
					pathLength={100}
					stroke-dasharray={100}
					stroke-dashoffset={100 - pct}
				/>
			</svg>
			{center !== undefined && <span class="ui-progress-ring__label">{center}</span>}
		</span>
	);
}
